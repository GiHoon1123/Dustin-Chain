import {
  Common,
  createCustomCommon,
  Hardfork,
  Mainnet,
  StateManagerInterface,
} from '@ethereumjs/common';
import { createMPT } from '@ethereumjs/mpt';
import { createLegacyTx, createTxFromRLP } from '@ethereumjs/tx';
import { createVM, runTx, VM } from '@ethereumjs/vm';
// NOTE: @ethereumjs/tx v10에는 TransactionFactory가 없어 임시로 미사용 처리
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { AccountService } from '../account/account.service';
import { CHAIN_ID, EMPTY_ROOT } from '../common/constants/blockchain.constants';
import { CryptoService } from '../common/crypto/crypto.service';
import { Address, Hash } from '../common/types/common.types';
import { CustomStateManager } from '../state/custom-state-manager';
import { StateManager } from '../state/state-manager';
import { IBlockRepository } from '../storage/repositories/block.repository.interface';
import { IStateRepository } from '../storage/repositories/state.repository.interface';
import { TransactionReceipt } from '../transaction/entities/transaction-receipt.entity';
import { Transaction } from '../transaction/entities/transaction.entity';
import { TransactionPool } from '../transaction/pool/transaction.pool';
import { Block } from './entities/block.entity';

interface GenesisConfig {
  config: {
    chainId: number;
    blockTime: number;
    epochSize: number;
  };
  timestamp: string;
  extraData: string;
  alloc: {
    [address: string]: {
      balance: string;
    };
  };
}

/**
 * Block Service
 *
 * 블록 생성 및 관리
 *
 * 역할:
 * - Genesis Block 생성
 * - 블록 생성 (트랜잭션 실행 포함)
 * - 블록 검증
 * - 블록 조회
 *
 * 이더리움:
 * - Execution Layer 역할 (트랜잭션 실행, 상태 변경)
 * - Consensus Layer와 연동 (Validator가 블록 제안)
 *
 * NestJS Lifecycle:
 * - onApplicationBootstrap: 모든 모듈의 onModuleInit이 완료된 후 실행
 * - BlockLevelDBRepository.onModuleInit()이 먼저 완료되어 DB가 열린 상태 보장
 */
// VM 실행 결과 요약 타입 (Receipt 매핑용)
interface ExecutionResultSummary {
  status: 1 | 0;
  gasUsed: bigint;
  contractAddress: Address | null;
  logs: { address: Address; topics: Hash[]; data: string }[];
  logsBloom: string;
}

@Injectable()
export class BlockService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BlockService.name);

  // EVM 실행 엔진 인스턴스 (초기 통합)
  private vm: VM | null = null;

  // Common 객체 (체인 파라미터)
  private readonly common: Common;

  /**
   * Genesis Proposer
   *
   * 이더리움:
   * - Genesis Block Proposer
   */
  private GENESIS_PROPOSER: Address = '';

  constructor(
    @Inject(IBlockRepository)
    private readonly repository: IBlockRepository,
    @Inject(IStateRepository)
    private readonly stateRepository: IStateRepository,
    private readonly cryptoService: CryptoService,
    private readonly accountService: AccountService,
    private readonly txPool: TransactionPool,
    private readonly stateManager: StateManager,
    private readonly evmState: CustomStateManager,
  ) {
    // Common 객체 초기화 (체인 파라미터)
    this.common = createCustomCommon(
      {
        chainId: CHAIN_ID,
      },
      Mainnet,
      {
        hardfork: Hardfork.Cancun,
      },
    );
  }

  /**
   * 애플리케이션 부트스트랩
   *
   * NestJS Lifecycle:
   * 1. onModuleInit (모든 모듈) - BlockLevelDBRepository DB 열기, StateLevelDBRepository DB 열기
   * 2. onApplicationBootstrap (모든 모듈) - Genesis Block 체크/생성, State 복원
   *
   * 이 시점에는 모든 LevelDB가 이미 열린 상태 보장
   */
  async onApplicationBootstrap(): Promise<void> {
    // this.logger.log('Checking Genesis Block...');
    await this.createGenesisBlock();

    // State 복원
    await this.restoreState();

    // VM 초기화 (VM 10.x: createVM 사용)
    try {
      // VM 10.x: createVM으로 생성 (async 초기화)
      // State 접근은 CustomStateManager를 주입
      // 타입 호환성을 위해 단언 사용 (Address 타입이 다름)
      this.vm = await createVM({
        stateManager: this.evmState as unknown as StateManagerInterface,
        common: this.common,
      });

      // ⚠️ VM 버그 수정: VM._generateAddress에서 acc.nonce - 1을 계산하는데,
      // nonce가 0이면 -1이 되어 bigIntToBytes(-1)에서 에러 발생
      // 해결: VM.evm._generateAddress를 패치하여 음수를 0으로 처리

      (this.vm.evm as any)._generateAddress = async function (message: any) {
        let acc = await this.stateManager.getAccount(message.caller);
        if (!acc) {
          const { Account } = require('@ethereumjs/util');

          acc = new Account();
        }
        let newNonce = acc.nonce - 1n;
        // 음수인 경우 0으로 처리 (첫 컨트랙트 배포 시 nonce=0이면 -1이 됨)
        if (newNonce < 0n) {
          newNonce = 0n;
        }
        const util = require('@ethereumjs/util');
        let addr: Uint8Array;
        if (message.salt) {
          addr = util.generateAddress2(
            message.caller.bytes,
            message.salt,
            message.code,
          );
        } else {
          addr = util.generateAddress(
            message.caller.bytes,
            util.bigIntToBytes(newNonce),
          );
        }
        return new util.Address(addr);
      }.bind(this.vm.evm);
      // this.logger.debug('[VM] _generateAddress 패치 적용 완료');
      this.logger.log(
        `VM initialized for execution (chainId=${this.common.chainId()})`,
      );
    } catch (e: unknown) {
      this.logger.error(`Failed to initialize VM: ${String(e)}`);
      // VM 없이도 기존 경로로 동작하도록 계속 진행
    }
  }

  /**
   * State 복원 (서버 재시작 시)
   *
   * 동작:
   * 1. 최신 블록 조회
   * 2. 최신 블록의 stateRoot로 State Trie 연결
   * 3. 이제 모든 계정 상태 복원 완료
   *
   * 이더리움에서:
   * - 최신 블록의 stateRoot로 State Trie 연결
   * - LevelDB에서 해당 root의 노드들을 자동으로 로드
   * - 모든 계정 상태가 복원됨
   */
  private async restoreState(): Promise<void> {
    try {
      const latestBlock = await this.repository.findLatest();

      if (!latestBlock) {
        // this.logger.log(
        //   'No blocks found - State will be initialized from Genesis',
        // );
        return;
      }

      // 최신 블록의 stateRoot로 State Trie 연결
      await this.stateRepository.setStateRoot(latestBlock.stateRoot);

      // this.logger.log(
      //   `State restored from block #${latestBlock.number} (stateRoot: ${latestBlock.stateRoot})`,
      // );
    } catch (error: unknown) {
      this.logger.error('Failed to restore state:', error);
      throw error;
    }
  }

  /**
   * Genesis Block 생성
   *
   * 이더리움:
   * - 블록 번호: 0
   * - parentHash: 0x0000...0000
   * - genesis.json의 alloc 계정들에 잔액 할당
   */
  async createGenesisBlock(): Promise<Block> {
    const existing = await this.repository.findByNumber(0);
    if (existing) {
      // this.logger.log('Genesis Block already exists');
      return existing;
    }

    // this.logger.log('Creating Genesis Block...');

    // genesis.json 로드
    const genesis = this.loadGenesisConfig();

    // alloc 계정들 초기화
    const addresses = Object.keys(genesis.alloc);
    for (const [address, data] of Object.entries(genesis.alloc)) {
      await this.accountService.addBalance(address, BigInt(data.balance));
    }

    // 첫 번째 계정을 Genesis Proposer로 설정
    this.GENESIS_PROPOSER = addresses[0];

    // this.logger.log(
    //   `Initialized ${addresses.length} genesis accounts from genesis.json`,
    // );

    const timestamp = Date.now();
    const parentHash = '0x' + '0'.repeat(64);

    const stateRoot = this.calculateStateRoot();
    const transactionsRoot = await this.calculateTransactionsRoot([]);
    const receiptsRoot = await this.calculateReceiptsRoot([]);

    const hash = this.calculateBlockHash(
      0,
      parentHash,
      timestamp,
      this.GENESIS_PROPOSER,
      transactionsRoot,
      receiptsRoot,
      stateRoot,
    );

    const genesisBlock = new Block(
      0,
      parentHash,
      timestamp,
      this.GENESIS_PROPOSER,
      [],
      stateRoot,
      transactionsRoot,
      receiptsRoot,
      hash,
    );

    // ✅ 저널의 Genesis 계정들을 LevelDB에 커밋
    await this.stateManager.commitBlock();
    // this.logger.log('Genesis accounts committed to LevelDB');

    // 블록 저장
    await this.repository.save(genesisBlock);

    this.logger.log(`Genesis Block created: ${hash}`);

    return genesisBlock;
  }

  /**
   * genesis.json 로드
   *
   * 이더리움:
   * - Genesis Block 초기 설정 파일
   */
  private loadGenesisConfig(): GenesisConfig {
    const possiblePaths = [
      path.resolve(process.cwd(), 'genesis.json'),
      path.resolve(__dirname, '../../genesis.json'),
      path.resolve(__dirname, '../../../genesis.json'),
    ];

    for (const filePath of possiblePaths) {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(content) as GenesisConfig;
      }
    }

    throw new Error('genesis.json not found');
  }

  /**
   * 새 블록 생성
   *
   * 이더리움:
   * 1. Mempool에서 트랜잭션 선택 (Gas Price 기준)
   * 2. 트랜잭션 실행 (EVM)
   * 3. 상태 변경 (계정 잔액, nonce 등)
   * 4. Proposer에게 보상
   * 5. 블록 생성 및 저장
   *
   * 우리:
   * - Mempool에서 모든 pending 트랜잭션 가져옴
   * - 트랜잭션 실행 (송금, nonce 증가)
   * - 블록 생성 (보상은 BlockProducer에서 처리)
   *
   * @param proposer - 블록 생성자 주소 (ValidatorService에서 선택)
   * @returns 생성된 블록
   */
  async createBlock(proposer: Address): Promise<Block> {
    // 1. 이전 블록 가져오기
    const latestBlock = await this.repository.findLatest();
    if (!latestBlock) {
      throw new Error('Genesis Block must be created first');
    }

    const blockNumber = latestBlock.number + 1;
    const parentHash = latestBlock.hash;
    const timestamp = Date.now();

    // 2. Mempool에서 pending 트랜잭션 가져오기
    const pendingTxs = this.txPool.getPending();

    // this.logger.log(
    //   `Creating Block #${blockNumber} with ${pendingTxs.length} transactions`,
    // );

    // 3. 트랜잭션 실행 및 Receipt 생성
    const executedTxs: Transaction[] = [];
    const receipts: TransactionReceipt[] = [];
    let cumulativeGasUsed = BigInt(0);

    for (let i = 0; i < pendingTxs.length; i++) {
      const tx = pendingTxs[i];
      let status: 1 | 0 = 1; // 기본 성공 가정
      let gasUsed = BigInt(21000); // 기본값 (VM 미사용 시)
      let contractAddress: Address | null = null;
      let logs: { address: Address; topics: Hash[]; data: string }[] = [];
      let logsBloom = '0x' + '0'.repeat(512);

      try {
        const exec = await this.executeTransaction(tx);
        if (exec) {
          status = exec.status;
          gasUsed = exec.gasUsed;
          contractAddress = exec.contractAddress;
          logs = exec.logs;
          logsBloom = exec.logsBloom;
        }
        // this.logger.debug(`Transaction executed: ${tx.hash}`);
      } catch (error: unknown) {
        // 트랜잭션 실행 실패 (잔액 부족, nonce 불일치 등)
        // 이더리움 표준: 실패해도 블록에 포함하고 Gas는 차감
        this.logger.warn(
          `Transaction execution failed: ${tx.hash} - ${String(error)}`,
        );
        status = 0; // 실패

        // Gas fee 차감 (실패해도 차감) - VM 미사용 경로에서만 필요
        if (!this.vm) {
          try {
            await this.accountService.subtractBalance(tx.from, gasUsed);
            await this.accountService.incrementNonce(tx.from);
          } catch (gasError: unknown) {
            this.logger.error(
              `Failed to deduct gas fee for failed tx ${tx.hash}: ${String(
                gasError,
              )}`,
            );
          }
        }
      }

      // 이더리움 표준: 성공/실패 관계없이 모두 블록에 포함
      executedTxs.push(tx);
      this.txPool.remove(tx.hash);

      // Receipt 생성
      cumulativeGasUsed += gasUsed;
      const receipt = new TransactionReceipt(
        tx.hash,
        i, // transactionIndex
        '', // blockHash (나중에 설정)
        blockNumber,
        tx.from,
        tx.to,
        status,
        gasUsed,
        cumulativeGasUsed,
      );
      receipt.contractAddress = contractAddress;
      // 로그를 Receipt.Log 타입으로 보강
      const enrichedLogs = logs.map((l, idx) => ({
        address: l.address,
        topics: l.topics,
        data: l.data,
        blockNumber,
        transactionHash: tx.hash,
        transactionIndex: i,
        blockHash: '',
        logIndex: idx,
        removed: false,
      }));
      receipt.logs = enrichedLogs;
      receipt.logsBloom = logsBloom;
      receipts.push(receipt);
    }

    // 4. (보상은 BlockProducer에서 처리)

    // 5. State Root 계산
    const stateRoot = this.calculateStateRoot();

    // 6. Transactions Root 계산
    const transactionsRoot = await this.calculateTransactionsRoot(executedTxs);

    // 7. Receipts Root 계산
    const receiptsRoot = await this.calculateReceiptsRoot(receipts);

    // 8. Block Hash 계산
    const hash = this.calculateBlockHash(
      blockNumber,
      parentHash,
      timestamp,
      proposer,
      transactionsRoot,
      receiptsRoot,
      stateRoot,
    );

    // 9. Block 생성
    const block = new Block(
      blockNumber,
      parentHash,
      timestamp,
      proposer,
      executedTxs,
      stateRoot,
      transactionsRoot,
      receiptsRoot,
      hash,
    );

    // 10. Receipt에 blockHash 설정
    for (const receipt of receipts) {
      receipt.blockHash = hash;
    }

    // 11. Receipt를 Block에 임시 저장 (나중에 saveBlock에서 사용)
    type BlockWithReceipts = Block & { receipts?: TransactionReceipt[] };
    (block as BlockWithReceipts).receipts = receipts;

    // 12. 저장하지 않음! (BlockProducer에서 2/3 확인 후 저장)
    // 블록 객체만 반환

    // this.logger.log(
    //   `Block #${blockNumber} created (not saved yet): ${hash} (${executedTxs.length} txs, ${receipts.length} receipts)`,
    // );

    return block;
  }

  /**
   * 블록 저장
   *
   * BlockProducer에서 2/3 확인 후 호출
   *
   * @param block - 저장할 블록
   */
  async saveBlock(block: Block): Promise<void> {
    await this.repository.save(block);

    // Receipt 저장 (Block에 임시로 저장된 receipts)
    type BlockWithReceipts = Block & { receipts?: TransactionReceipt[] };
    const receipts = (block as BlockWithReceipts).receipts;
    if (receipts && receipts.length > 0) {
      const repoWithReceipts = this.repository as unknown as {
        saveReceipt: (r: TransactionReceipt) => Promise<void>;
      };
      for (const receipt of receipts) {
        if ('saveReceipt' in this.repository) {
          await repoWithReceipts.saveReceipt(receipt);
        }
      }
      // this.logger.debug(
      //   `${receipts.length} receipts saved for block #${block.number}`,
      // );
    }

    this.logger.log(`Block #${block.number} saved: ${block.hash}`);
  }

  /**
   * BigInt를 RLP 버퍼로 변환 (빅엔디안 바이트 배열)
   */
  private toRlpBuffer(value: bigint): Buffer {
    if (value === 0n) {
      return Buffer.alloc(0);
    }
    const hex = value.toString(16);
    const hexPadded = hex.length % 2 === 0 ? hex : '0' + hex;
    return Buffer.from(hexPadded, 'hex');
  }

  /**
   * RLP 버퍼에서 BigInt 추출 (빅엔디안 바이트 배열)
   */
  private fromRlpBuffer(buffer: Buffer | Uint8Array): bigint {
    if (!buffer || buffer.length === 0) {
      return 0n;
    }
    const hex = Buffer.from(buffer).toString('hex');
    return hex ? BigInt('0x' + hex) : 0n;
  }

  /**
   * 트랜잭션 실행
   *
   * 이더리움:
   * - EVM에서 실행
   * - Gas 차감
   * - 상태 변경 (잔액, 스토리지 등)
   *
   * 우리:
   * - 송금 (from -> to)
   * - nonce 증가
   *
   * @param tx - 실행할 트랜잭션
   */
  private async executeTransaction(
    tx: Transaction,
  ): Promise<ExecutionResultSummary | void> {
    // VM이 있으면: 모든 트랜잭션을 runTx로 실행 (배포/호출/송금 공통)
    // - 이유: 가스/리버트/로그/스토리지/코드 저장 등 EVM 규칙을 일관 적용하기 위함
    if (this.vm) {
      // EVM이 기대하는 Buffer 타입으로 정규화
      const toBytes = tx.to ? this.cryptoService.hexToBytes(tx.to) : undefined;
      const toBuffer = toBytes ? Buffer.from(toBytes) : undefined;
      const dataBytes =
        typeof tx.data === 'string'
          ? this.cryptoService.hexToBytes(tx.data)
          : (tx.data as unknown as Uint8Array);
      const dataBuffer = Buffer.from(dataBytes ?? new Uint8Array());

      // 트랜잭션을 RLP로 직렬화해서 원본 서명을 유지
      // 이더리움 Legacy 트랜잭션 RLP 형식: [nonce, gasPrice, gasLimit, to, value, data, v, r, s]
      const gasPrice =
        typeof tx.gasPrice === 'bigint' ? tx.gasPrice : BigInt(tx.gasPrice);
      const gasLimit =
        typeof tx.gasLimit === 'bigint' ? tx.gasLimit : BigInt(tx.gasLimit);
      const value = typeof tx.value === 'bigint' ? tx.value : BigInt(tx.value);

      // RLP 배열 구성 (Buffer 배열)
      // 이더리움 Legacy 트랜잭션 RLP 형식: [nonce, gasPrice, gasLimit, to, value, data, v, r, s]
      const rlpArray = [
        this.toRlpBuffer(BigInt(tx.nonce)), // nonce
        this.toRlpBuffer(gasPrice), // gasPrice
        this.toRlpBuffer(gasLimit), // gasLimit
        toBuffer || Buffer.alloc(0), // to (null이면 빈 버퍼)
        this.toRlpBuffer(value), // value
        dataBuffer, // data
        this.toRlpBuffer(BigInt(tx.v)), // v
        Buffer.from(this.cryptoService.hexToBytes(tx.r)), // r
        Buffer.from(this.cryptoService.hexToBytes(tx.s)), // s
      ];

      // RLP 인코딩
      const rlpEncoded = this.cryptoService.rlpEncode(rlpArray);

      // 트랜잭션의 v 값에서 chainId 추출 (EIP-155)
      let txChainId: number;
      if (tx.v >= 35) {
        txChainId = Math.floor((Number(tx.v) - 35) / 2);
        if (
          txChainId > 0 &&
          (txChainId * 2 + 35 === Number(tx.v) ||
            txChainId * 2 + 36 === Number(tx.v))
        ) {
          // this.logger.debug(
          //   `[VM] Extracted chainId from tx.v=${tx.v}: ${txChainId}`,
          // );
        } else {
          txChainId = CHAIN_ID;
        }
      } else {
        txChainId = CHAIN_ID;
      }

      // Common 객체 생성
      const txCommon =
        txChainId === Number(this.common.chainId())
          ? this.common
          : createCustomCommon(
              {
                chainId: txChainId,
              },
              Mainnet,
              {
                hardfork: Hardfork.Cancun,
              },
            );

      // RLP로 인코딩된 트랜잭션을 createTxFromRLP로 파싱
      const rlpBuffer = Buffer.from(rlpEncoded);
      const ethTx = createTxFromRLP(rlpBuffer, { common: txCommon });

      // 트랜잭션에서 발신자 주소 추출 및 검증
      const ethTxWithSender = ethTx as unknown as {
        getSenderAddress?: () => Address | Buffer | Uint8Array;
        hash?: () => Buffer | Uint8Array;
      };

      if (ethTxWithSender.getSenderAddress) {
        try {
          const senderResult = ethTxWithSender.getSenderAddress();
          let senderAddress: string;
          if (typeof senderResult === 'string') {
            senderAddress = senderResult;
          } else if (
            senderResult &&
            typeof senderResult === 'object' &&
            'toString' in senderResult
          ) {
            // Address 객체일 수 있음
            senderAddress = (
              senderResult as { toString: () => string }
            ).toString();
            if (!senderAddress.startsWith('0x')) {
              senderAddress = `0x${senderAddress}`;
            }
          } else {
            // Uint8Array나 Buffer
            senderAddress = this.cryptoService.bytesToHex(
              Buffer.from(senderResult as unknown as Uint8Array),
            );
          }
          // this.logger.debug(
          //   `[VM] Transaction sender extracted: ${senderAddress} (expected: ${tx.from})`,
          // );

          if (senderAddress.toLowerCase() !== tx.from.toLowerCase()) {
            this.logger.warn(
              `[VM] Sender address mismatch! Expected ${tx.from}, got ${senderAddress}`,
            );
          }
        } catch (senderError: unknown) {
          this.logger.warn(
            `[VM] Failed to extract sender address: ${String(senderError)}`,
          );
        }
      }

      if (ethTxWithSender.hash) {
        try {
          const txHashResult = ethTxWithSender.hash();
          const txHash = this.cryptoService.bytesToHex(
            Buffer.from(txHashResult),
          );
          // this.logger.debug(
          //   `[VM] Transaction hash from VM: ${txHash} (expected: ${tx.hash})`,
          // );
        } catch (hashError: unknown) {
          this.logger.warn(
            `[VM] Failed to get transaction hash: ${String(hashError)}`,
          );
        }
      }

      // 컨트랙트 배포 트랜잭션 처리: 새로운 트랜잭션 객체 생성
      // createTxFromRLP는 to가 null일 때 빈 버퍼로 파싱하지만,
      // VM은 to가 undefined일 때만 컨트랙트 배포로 처리함
      // 따라서 to가 빈 버퍼인 경우 새로운 트랜잭션 객체를 만들어 to를 undefined로 설정
      const ethTxTyped = ethTx as unknown as {
        nonce: bigint;
        gasPrice: bigint;
        gasLimit: bigint;
        to?: Buffer | Uint8Array | undefined;
        value: bigint;
        data: Buffer | Uint8Array;
        v: bigint;
        r: Buffer | Uint8Array;
        s: Buffer | Uint8Array;
      };

      // 컨트랙트 배포 트랜잭션 처리: 항상 createLegacyTx로 새 객체 생성
      // createTxFromRLP는 RLP 파싱 결과로 내부 상태가 잘못될 수 있음
      // 컨트랙트 배포(tx.to === null)인 경우 항상 새 객체 생성
      let txForVM = ethTx;
      if (tx.to === null) {
        // this.logger.debug(
        //   '[VM] 컨트랙트 배포 트랜잭션 감지 → createLegacyTx로 새 객체 생성 (to=undefined)',
        // );
        // createLegacyTx로 새로운 트랜잭션 객체 생성
        // ethTx에서 필드 추출 (원본 트랜잭션의 서명 값 사용)
        const ethTxTyped = ethTx as unknown as {
          nonce: bigint;
          gasPrice: bigint;
          gasLimit: bigint;
          value: bigint;
          data: Buffer | Uint8Array;
          v: bigint;
          r: Buffer | Uint8Array | unknown;
          s: Buffer | Uint8Array | unknown;
        };

        // r, s가 Buffer나 Uint8Array가 아니면 변환
        const rBuffer =
          ethTxTyped.r instanceof Buffer
            ? ethTxTyped.r
            : ethTxTyped.r instanceof Uint8Array
              ? Buffer.from(ethTxTyped.r)
              : Buffer.from(this.cryptoService.hexToBytes(tx.r));
        const sBuffer =
          ethTxTyped.s instanceof Buffer
            ? ethTxTyped.s
            : ethTxTyped.s instanceof Uint8Array
              ? Buffer.from(ethTxTyped.s)
              : Buffer.from(this.cryptoService.hexToBytes(tx.s));
        const dataBuffer =
          ethTxTyped.data instanceof Buffer
            ? ethTxTyped.data
            : ethTxTyped.data instanceof Uint8Array
              ? Buffer.from(ethTxTyped.data)
              : Buffer.from(this.cryptoService.hexToBytes(tx.data || '0x'));

        // createLegacyTx에 전달할 필드 값 확인 및 로깅
        // this.logger.debug(
        //   `[VM] createLegacyTx 필드 값: nonce=${ethTxTyped.nonce}, gasPrice=${ethTxTyped.gasPrice}, gasLimit=${ethTxTyped.gasLimit}, value=${ethTxTyped.value}, v=${ethTxTyped.v}, r.length=${rBuffer.length}, s.length=${sBuffer.length}, data.length=${dataBuffer.length}`,
        // );

        txForVM = createLegacyTx(
          {
            nonce: ethTxTyped.nonce,
            gasPrice: ethTxTyped.gasPrice,
            gasLimit: ethTxTyped.gasLimit,
            to: undefined, // 컨트랙트 배포를 위해 명시적으로 undefined 설정
            value: ethTxTyped.value,
            data: dataBuffer,
            v: ethTxTyped.v,
            r: rBuffer,
            s: sBuffer,
          },
          { common: txCommon },
        );
        // this.logger.debug(
        //   `[VM] 새 트랜잭션 객체 생성 완료: to=${(txForVM as unknown as { to?: unknown }).to === undefined ? 'undefined' : '설정됨'}`,
        // );
      }

      // VM 10.x: runTx는 독립 함수로 변경됨
      // 타입은 @ethereumjs/vm의 RunTxResult 사용

      // 디버깅: runTx 호출 전 트랜잭션 상태 완전히 로깅
      const txForVMTyped = txForVM as unknown as {
        nonce?: unknown;
        gasPrice?: unknown;
        gasLimit?: unknown;
        to?: unknown;
        value?: unknown;
        data?: unknown;
        v?: unknown;
        r?: unknown;
        s?: unknown;
        hash?: () => unknown;
        getSenderAddress?: () => unknown;
      };
      // this.logger.debug(
      //   `[VM] runTx 호출 전 최종 트랜잭션 상태:` +
      //     `\n  nonce=${txForVMTyped.nonce}, typeof=${typeof txForVMTyped.nonce}` +
      //     `\n  gasPrice=${txForVMTyped.gasPrice}, typeof=${typeof txForVMTyped.gasPrice}` +
      //     `\n  gasLimit=${txForVMTyped.gasLimit}, typeof=${typeof txForVMTyped.gasLimit}` +
      //     `\n  to=${txForVMTyped.to}, typeof=${typeof txForVMTyped.to}, isUndefined=${txForVMTyped.to === undefined}` +
      //     `\n  value=${txForVMTyped.value}, typeof=${typeof txForVMTyped.value}` +
      //     `\n  v=${txForVMTyped.v}, typeof=${typeof txForVMTyped.v}` +
      //     `\n  r=${txForVMTyped.r instanceof Buffer ? `Buffer(${txForVMTyped.r.length})` : txForVMTyped.r instanceof Uint8Array ? `Uint8Array(${txForVMTyped.r.length})` : typeof txForVMTyped.r}` +
      //     `\n  s=${txForVMTyped.s instanceof Buffer ? `Buffer(${txForVMTyped.s.length})` : txForVMTyped.s instanceof Uint8Array ? `Uint8Array(${txForVMTyped.s.length})` : typeof txForVMTyped.s}` +
      //     `\n  data=${txForVMTyped.data instanceof Buffer ? `Buffer(${txForVMTyped.data.length})` : txForVMTyped.data instanceof Uint8Array ? `Uint8Array(${txForVMTyped.data.length})` : typeof txForVMTyped.data}`,
      // );

      let result;
      try {
        result = await runTx(this.vm, { tx: txForVM });
      } catch (vmError: unknown) {
        const errorMsg =
          vmError instanceof Error ? vmError.message : String(vmError);
        const errorStack =
          vmError instanceof Error ? vmError.stack : String(vmError);

        // 깊은 디버깅: 에러 스택 전체 로깅
        this.logger.error(`[VM] runTx failed for ${tx.hash}: ${errorMsg}`);
        this.logger.error(`[VM] Error stack trace:\n${errorStack}`);

        // 에러 객체의 모든 속성 로깅
        if (vmError instanceof Error) {
          this.logger.error(
            `[VM] Error object properties: ${JSON.stringify(
              Object.getOwnPropertyNames(vmError).reduce(
                (acc, key) => {
                  try {
                    acc[key] = String((vmError as any)[key]);
                  } catch {
                    acc[key] = '[unable to stringify]';
                  }
                  return acc;
                },
                {} as Record<string, string>,
              ),
            )}`,
          );
        }
        // 에러가 발생해도 트랜잭션은 블록에 포함됨 (실패 처리)
        throw vmError;
      }

      const status: 1 | 0 = result.execResult.exceptionError ? 0 : 1;

      const gasUsed: bigint =
        result.gasUsed ?? result.execResult.gasUsed ?? BigInt(21000);

      // 생성자 실행 결과 확인 (컨트랙트 배포인 경우)
      if (tx.to === null) {
        const returnValue = result.execResult.returnValue || new Uint8Array();
        const returnValueHex = this.cryptoService.bytesToHex(returnValue);
        this.logger.warn(
          `[VM] Contract deployment: createdAddress=${result.createdAddress || 'null'}, returnValue length=${returnValue.length} bytes, status=${status}, gasUsed=${gasUsed}`,
        );
        if (result.execResult.exceptionError) {
          const err = result.execResult.exceptionError;
          this.logger.error(
            `[VM] Constructor failed: ${JSON.stringify({
              error: err.error?.toString(),
              errorType: err.errorType,
              reason: err.reason,
            })}`,
          );
        }
        if (returnValue.length > 0) {
          this.logger.warn(
            `[VM] Return value (first 200 chars): ${returnValueHex.slice(0, 200)}...`,
          );
        }
      }

      // 실패 시 에러 메시지 로깅
      if (result.execResult.exceptionError) {
        const errorInfo = result.execResult.exceptionError;
        this.logger.error(
          `[VM] Transaction failed: ${tx.hash} - Error: ${errorInfo.error || 'Unknown error'}`,
        );
        // 상세 에러 정보 로깅
        if (errorInfo.error) {
          this.logger.error(
            `[VM] Exception error details: ${JSON.stringify({
              error: errorInfo.error.toString(),
              errorType: errorInfo.errorType,
              reason: errorInfo.reason,
            })}`,
          );
        }
      }

      const created = result.createdAddress;
      // VM 10.x: createdAddress는 Address 타입 (string 또는 Address 객체)
      let contractAddress: Address | null = null;
      if (created) {
        // Address 타입 처리: string, Address 객체, Uint8Array, Buffer 등
        if (typeof created === 'string') {
          contractAddress = created;
        } else if (created && typeof created === 'object') {
          // Address 객체인 경우 .toString() 또는 .bytes 사용
          if ('toString' in created) {
            const addrStr = (created as { toString: () => string }).toString();
            // toString()이 올바른 0x 접두사 주소를 반환하는지 확인
            contractAddress =
              addrStr && addrStr.startsWith('0x') ? addrStr : null;
          } else if ('bytes' in created) {
            const bytes = (created as { bytes: Uint8Array | Buffer }).bytes;
            contractAddress = this.cryptoService.bytesToHex(Buffer.from(bytes));
          } else {
            // Uint8Array나 Buffer인 경우
            contractAddress = this.cryptoService.bytesToHex(
              Buffer.from(created as unknown as Uint8Array),
            );
          }
        } else {
          // Uint8Array나 다른 타입인 경우 변환
          contractAddress = this.cryptoService.bytesToHex(
            Buffer.from(created as unknown as Uint8Array),
          );
        }

        // 최종 검증: contractAddress가 유효한 0x 접두사 주소인지 확인
        if (contractAddress && !contractAddress.startsWith('0x')) {
          this.logger.warn(
            `[VM] Invalid contract address format: ${contractAddress}, converting...`,
          );
          contractAddress = `0x${contractAddress}`;
        }
        // 20바이트 (40 hex chars) 길이 확인
        if (contractAddress && contractAddress.length !== 42) {
          this.logger.warn(
            `[VM] Contract address has unexpected length: ${contractAddress.length}, address: ${contractAddress}`,
          );
        }
        // this.logger.debug(
        //   `[VM] Contract address extracted: ${contractAddress}`,
        // );
      }

      // EVM 로그를 Receipt.Log 형태로 변환
      const logs = (result.execResult.logs || []).map(
        (l: [Uint8Array, Uint8Array[], Uint8Array]) => {
          const [addr, topics, data] = l;
          return {
            address: this.cryptoService.bytesToHex(addr),
            topics: topics.map((t: Uint8Array) =>
              this.cryptoService.bytesToHex(t),
            ),
            data: this.cryptoService.bytesToHex(data),
          };
        },
      );
      const logsBloom = '0x' + '0'.repeat(512);

      return { status, gasUsed, contractAddress, logs, logsBloom };
    }

    // VM 미존재 시: EOA 송금만 처리
    if (!tx.to) {
      throw new Error('Contract deployment requires VM');
    }
    await this.accountService.transfer(tx.from, tx.to, tx.value);
    await this.accountService.incrementNonce(tx.from);
    // this.logger.debug(
    //   `Transaction executed: ${tx.from} -> ${tx.to} (${tx.value} Wei)`,
    // );
  }

  /**
   * 블록 해시 계산
   *
   * 이더리움에서의 동작:
   * - Keccak-256(RLP(header))
   * - Header 필드들을 RLP 인코딩 후 해시
   *
   * 블록 Header 구조 (간소화):
   * - parentHash: 이전 블록 해시
   * - stateRoot: 계정 상태 루트
   * - transactionsRoot: 트랜잭션 루트
   * - number: 블록 번호
   * - timestamp: 생성 시간
   * - proposer: 블록 생성자
   *
   * 이더리움 전체 Header (참고용):
   * - parentHash, unclesHash, beneficiary(coinbase), stateRoot,
   *   transactionsRoot, receiptsRoot, logsBloom, difficulty,
   *   number, gasLimit, gasUsed, timestamp, extraData,
   *   mixHash, nonce
   *
   * 우리는 간소화된 버전 사용:
   * - 핵심 필드만 포함
   * - POS에서 불필요한 필드 제외 (difficulty, unclesHash 등)
   *
   * 왜 RLP인가:
   * - 결정론적 인코딩 (같은 데이터 → 같은 해시)
   * - 이더리움 표준
   * - JSON보다 작은 크기
   *
   * @param number - 블록 번호
   * @param parentHash - 이전 블록 해시
   * @param timestamp - 생성 시간
   * @param proposer - 블록 생성자
   * @param transactionsRoot - 트랜잭션 루트
   * @param stateRoot - 상태 루트
   * @returns 블록 해시 (32 bytes, "0x...")
   */
  private calculateBlockHash(
    number: number,
    parentHash: Hash,
    timestamp: number,
    proposer: Address,
    transactionsRoot: Hash,
    receiptsRoot: Hash,
    stateRoot: Hash,
  ): Hash {
    // Header 필드를 배열로 구성 (순서 중요!)
    // RLP 인코딩: [parentHash, stateRoot, transactionsRoot, receiptsRoot, number, timestamp, proposer]
    const headerArray = [
      this.cryptoService.hexToBytes(parentHash), // 이전 블록 해시
      this.cryptoService.hexToBytes(stateRoot), // 상태 루트
      this.cryptoService.hexToBytes(transactionsRoot), // 트랜잭션 루트
      this.cryptoService.hexToBytes(receiptsRoot), // Receipt 루트
      number, // 블록 번호
      timestamp, // 타임스탬프
      this.cryptoService.hexToBytes(proposer), // 블록 생성자
    ];

    // RLP 인코딩 + Keccak-256 해시
    return this.cryptoService.rlpHash(headerArray);
  }

  /**
   * State Root 계산
   *
   * 이더리움에서의 동작:
   * - Merkle Patricia Trie의 루트 해시
   * - 모든 계정 상태를 Trie에 저장
   * - Key: keccak256(address) - 주소를 해시하여 키로 사용
   * - Value: RLP([nonce, balance, storageRoot, codeHash]) - 계정 정보를 RLP 인코딩
   *
   * 계정 구조 (4개 필드):
   * 1. nonce: 트랜잭션 순서 번호
   * 2. balance: 잔액 (Wei 단위)
   * 3. storageRoot: 스마트 컨트랙트 저장소 루트 (우리는 EMPTY_ROOT)
   * 4. codeHash: 스마트 컨트랙트 코드 해시 (우리는 EMPTY_HASH)
   *
   * 왜 Merkle Patricia Trie인가:
   * - 효율적인 증명 (Merkle Proof)
   * - Light Client 지원
   * - 부분 상태 검증 가능
   * - 이더리움 표준
   *
   * @returns State Root 해시 (32 bytes, "0x...")
   */
  /**
   * State Root 계산
   *
   * 변경사항 (State Trie 도입):
   * - 기존: 메모리의 모든 계정을 새 Trie에 넣어 계산
   * - 현재: IStateRepository에서 현재 State Root 가져오기
   * - State Trie는 계정 저장 시마다 자동으로 Root 업데이트
   *
   * 이더리움에서:
   * - StateDB가 State Trie를 관리
   * - 계정 변경 시마다 Trie 업데이트
   * - Root는 자동으로 계산됨
   */
  private calculateStateRoot(): Hash {
    // IStateRepository에서 현재 State Root 가져오기
    // (StateManager.commitBlock()에서 이미 업데이트됨)
    return this.stateRepository.getStateRoot();
  }

  /**
   * Transactions Root 계산
   *
   * 이더리움에서의 동작:
   * - Merkle Patricia Trie의 루트 해시
   * - 트랜잭션들을 Trie에 저장
   * - Key: RLP(index) - 트랜잭션 순서 (0, 1, 2, ...)
   * - Value: RLP(transaction) - 트랜잭션 전체 데이터
   *
   * 트랜잭션 데이터:
   * - nonce, to, value, from, v, r, s
   * - 서명 포함된 전체 트랜잭션
   *
   * 왜 Merkle Patricia Trie인가:
   * - 트랜잭션 존재 증명 가능 (Merkle Proof)
   * - Light Client가 특정 트랜잭션만 검증 가능
   * - 이더리움 표준
   *
   * 빈 블록 처리:
   * - 트랜잭션이 없으면 EMPTY_ROOT 반환
   * - 이더리움 표준 값
   *
   * @param transactions - 트랜잭션 리스트
   * @returns Transactions Root 해시 (32 bytes, "0x...")
   */
  private async calculateTransactionsRoot(
    transactions: Transaction[],
  ): Promise<Hash> {
    // 1. 빈 블록: EMPTY_ROOT 반환
    if (transactions.length === 0) {
      return EMPTY_ROOT;
    }

    // 2. 새 Trie 인스턴스 생성
    const trie = await createMPT();

    // 3. 각 트랜잭션을 Trie에 삽입
    for (let i = 0; i < transactions.length; i++) {
      const tx = transactions[i];

      // Key: RLP(index) - 트랜잭션 순서
      const key = this.cryptoService.rlpEncode(i);

      // Value: RLP(transaction) - 트랜잭션 전체 데이터
      // [nonce, to, value, from, v, r, s]
      // EVM 통합: to가 null인 경우 빈 바이트 배열 (컨트랙트 배포)
      const toBytes = tx.to
        ? this.cryptoService.hexToBytes(tx.to)
        : Buffer.from([]);
      const value = this.cryptoService.rlpEncode([
        tx.nonce, // nonce
        toBytes, // to address (null인 경우 빈 배열)
        tx.value, // value (BigInt)
        this.cryptoService.hexToBytes(tx.from), // from address
        tx.v, // signature v
        this.cryptoService.hexToBytes(tx.r), // signature r
        this.cryptoService.hexToBytes(tx.s), // signature s
      ]);

      // Trie에 저장
      await trie.put(key, value);
    }

    // 4. Root 해시 반환
    const root = trie.root();

    // Uint8Array → Hex 문자열 변환
    return this.cryptoService.bytesToHex(root);
  }

  /**
   * Receipt Root 계산
   *
   * 이더리움:
   * - Receipt들의 Merkle Patricia Trie 루트 해시
   * - 각 Receipt를 RLP 인코딩하여 Trie에 저장
   *
   * 우리 (현재):
   * - 단순 해시 (나중에 Merkle Trie로 교체)
   */
  private async calculateReceiptsRoot(
    receipts: TransactionReceipt[],
  ): Promise<Hash> {
    // 1. 빈 블록: EMPTY_ROOT 반환
    if (receipts.length === 0) {
      return EMPTY_ROOT;
    }

    // 2. 새 Trie 인스턴스 생성
    const trie = await createMPT();

    // 3. 각 Receipt를 Trie에 삽입
    for (let i = 0; i < receipts.length; i++) {
      const receipt = receipts[i];

      // Key: RLP(index) - Receipt 순서
      const key = this.cryptoService.rlpEncode(i);

      // Value: RLP(receipt) - Receipt 전체 데이터
      // [status, cumulativeGasUsed, logsBloom, logs]
      const value = this.cryptoService.rlpEncode([
        receipt.status, // status (1 or 0)
        receipt.cumulativeGasUsed, // cumulative gas used
        this.cryptoService.hexToBytes(receipt.logsBloom), // logs bloom
        receipt.logs, // logs array
      ]);

      // Trie에 저장
      await trie.put(key, value);
    }

    // 4. Root 해시 반환
    const root = trie.root();

    // Uint8Array → Hex 문자열 변환
    return this.cryptoService.bytesToHex(root);
  }

  /**
   * 블록 번호로 조회
   */
  async getBlockByNumber(number: number): Promise<Block | null> {
    return this.repository.findByNumber(number);
  }

  /**
   * 블록 해시로 조회
   */
  async getBlockByHash(hash: Hash): Promise<Block | null> {
    return this.repository.findByHash(hash);
  }

  /**
   * 최신 블록 조회
   */
  async getLatestBlock(): Promise<Block | null> {
    return this.repository.findLatest();
  }

  /**
   * 체인 높이 (총 블록 개수)
   */
  async getChainHeight(): Promise<number> {
    return this.repository.count();
  }

  /**
   * 체인 통계
   */
  async getChainStats() {
    const height = await this.getChainHeight();
    const latestBlock = await this.getLatestBlock();
    const allBlocks = await this.repository.findAll();

    const totalTxs = allBlocks.reduce(
      (sum, block) => sum + block.getTransactionCount(),
      0,
    );

    return {
      height,
      latestBlockNumber: latestBlock?.number ?? null,
      latestBlockHash: latestBlock?.hash ?? null,
      totalTransactions: totalTxs,
      genesisProposer: this.GENESIS_PROPOSER,
    };
  }

  /**
   * VM 인스턴스 조회
   *
   * 다른 모듈에서 VM 접근이 필요할 때 사용
   *
   * @returns VM 인스턴스 또는 null
   */
  getVM(): VM | null {
    return this.vm;
  }
}
