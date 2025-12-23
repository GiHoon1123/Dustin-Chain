import {
  Block as EthereumBlock,
  BlockHeader as EthereumBlockHeader,
} from '@ethereumjs/block';
import {
  Common,
  createCustomCommon,
  Hardfork,
  Mainnet,
  StateManagerInterface,
} from '@ethereumjs/common';
import { createMPT } from '@ethereumjs/mpt';
import { createLegacyTx, createTxFromRLP } from '@ethereumjs/tx';
import { Address as EthAddress } from '@ethereumjs/util';
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
import { StakingService } from '../staking/staking.service';
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
    private readonly stakingService: StakingService,
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
    const genesisBlock = await this.createGenesisBlock();

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

    // StakingContract 배포 상태 확인 및 Validator 등록
    await this.ensureContractsDeployedAndRegisterValidators(
      genesisBlock.timestamp,
    );
  }

  /**
   * 컨트랙트 배포 상태 확인 및 Genesis Validator 등록
   *
   * 동작:
   * 1. deployed-contracts.json에서 StakingContract 배포 상태 확인
   * 2. StakingContract가 배포되어 있으면 → Genesis Validator 등록만 수행
   * 3. StakingContract가 없으면 → StakingContract와 StableCoin 배포 후 Validator 등록
   *
   * @param timestamp - Genesis Block 타임스탬프 (밀리초)
   */
  private async ensureContractsDeployedAndRegisterValidators(
    timestamp: number,
  ): Promise<void> {
    // StakingService를 통해 ContractService 접근
    const stakingServiceAny = this.stakingService as any;
    if (!stakingServiceAny?.contractService) {
      this.logger.warn(
        'ContractService not available. Skipping contract deployment check.',
      );
      return;
    }

    const contractService = stakingServiceAny.contractService;
    const deployed = contractService.getDeployedContracts();

    // StakingContract가 배포되어 있는지 확인
    if (deployed && deployed.staking && deployed.staking.address) {
      this.logger.log(
        `StakingContract already deployed at: ${deployed.staking.address}`,
      );
      this.logger.log('Registering Genesis Validators...');
      await this.registerGenesisValidators(timestamp);
      return;
    }

    // StakingContract가 없으면 배포 필요
    this.logger.log('StakingContract not found. Deploying contracts...');

    try {
      // 1. StakingContract 배포
      this.logger.log('Deploying StakingContract...');
      const stakingResult = await contractService.deployStakingContract();
      this.logger.log(
        `StakingContract deployed at: ${stakingResult.stakingAddress}`,
      );

      // 2. StableCoin 시스템 배포
      this.logger.log('Deploying StableCoin system...');
      const stablecoinResult = await contractService.deployStablecoin();
      this.logger.log(
        `StableCoin deployed at: ${stablecoinResult.stablecoinAddress}`,
      );
      this.logger.log(
        `CollateralVault deployed at: ${stablecoinResult.vaultAddress}`,
      );

      // 3. Genesis Validator 등록
      this.logger.log('Registering Genesis Validators...');
      await this.registerGenesisValidators(timestamp);
    } catch (error: any) {
      this.logger.error(
        `Failed to deploy contracts and register validators: ${error.message}`,
      );
      // 에러가 발생해도 서버는 계속 실행
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

    // ⚠️ 중요: Solidity의 block.timestamp는 초 단위이므로 밀리초를 초로 변환
    // 하지만 Block Entity는 밀리초를 저장하므로 Date.now() 사용
    const timestamp = Date.now();
    const parentHash = '0x' + '0'.repeat(64);

    const stateRoot = this.calculateStateRoot();
    const transactionsRoot = await this.calculateTransactionsRoot([]);
    const receiptsRoot = await this.calculateReceiptsRoot([]);

    // Genesis Block의 logsBloom은 빈 bloom (로그 없음)
    const genesisLogsBloom = '0x' + '0'.repeat(512);

    const hash = this.calculateBlockHash(
      0,
      parentHash,
      timestamp,
      this.GENESIS_PROPOSER,
      transactionsRoot,
      receiptsRoot,
      genesisLogsBloom,
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
      genesisLogsBloom,
      hash,
    );

    // ✅ 저널의 Genesis 계정들을 LevelDB에 커밋
    await this.stateManager.commitBlock();
    // this.logger.log('Genesis accounts committed to LevelDB');

    // 블록 저장
    await this.repository.save(genesisBlock);

    this.logger.log(`Genesis Block created: ${hash}`);

    // Genesis Validator 등록은 onApplicationBootstrap에서
    // 컨트랙트 배포 상태 확인 후 수행됨 (ensureContractsDeployedAndRegisterValidators)

    return genesisBlock;
  }

  /**
   * Genesis Validator 등록 (VM을 통해 직접 호출, 트랜잭션 없이)
   *
   * 현재 상황:
   * - Execution Layer와 Consensus Layer가 통합되어 있음
   * - Validator 등록을 트랜잭션으로 처리하면 순환 의존성 발생
   *
   * 해결 방법:
   * - Genesis Block 생성 시점에 VM을 통해 직접 StakingContract 함수 호출
   * - 트랜잭션 없이 상태 변경
   *
   * 추후 레이어 분리 시:
   * - Execution Layer: Deposit Contract에 트랜잭션으로 ETH 예치
   * - Consensus Layer: Beacon Chain이 Deposit 이벤트를 감지하여 Validator 등록
   *
   * @param timestamp - Genesis Block 타임스탬프 (밀리초)
   */
  private async registerGenesisValidators(timestamp: number): Promise<void> {
    // VM이 초기화되어 있지 않으면 초기화
    if (!this.vm) {
      try {
        this.vm = await createVM({
          stateManager: this.evmState as unknown as StateManagerInterface,
          common: this.common,
        });
      } catch (error) {
        this.logger.error(
          `Failed to initialize VM for validator registration: ${String(error)}`,
        );
        return;
      }
    }

    // StakingContract가 배포되어 있는지 확인
    // StakingService를 통해 ContractService 접근
    const stakingServiceAny = this.stakingService as any;
    if (!stakingServiceAny.contractService) {
      this.logger.warn(
        'ContractService not available. Skipping Genesis Validator registration.',
      );
      return;
    }

    const deployed = stakingServiceAny.contractService.getDeployedContracts();
    if (!deployed || !deployed.staking) {
      this.logger.warn(
        'StakingContract is not deployed. Skipping Genesis Validator registration.',
      );
      return;
    }

    // genesis-accounts.json 로드
    const accountsPath = this.findGenesisAccountsFile();
    if (!accountsPath) {
      this.logger.warn(
        'genesis-accounts.json not found. Skipping Genesis Validator registration.',
      );
      return;
    }

    try {
      const fileContent = fs.readFileSync(accountsPath, 'utf8');
      const accounts: Array<{
        index: number;
        address: string;
        publicKey: string;
        privateKey: string;
      }> = JSON.parse(fileContent);

      // 처음 90개만 Validator로 등록
      const GENESIS_VALIDATOR_COUNT = 90;
      const accountsToRegister = accounts.slice(0, GENESIS_VALIDATOR_COUNT);

      this.logger.log(
        `Registering ${accountsToRegister.length} Genesis Validators via VM (no transaction)...`,
      );

      let registered = 0;
      let skipped = 0;
      let failed = 0;

      for (const account of accountsToRegister) {
        try {
          // StakingService를 통해 ContractService 접근
          const stakingServiceAny = this.stakingService as any;
          const contractService = stakingServiceAny.contractService;
          if (!contractService) {
            this.logger.warn(
              'ContractService not available. Skipping validator registration.',
            );
            failed++;
            continue;
          }

          const success =
            await this.stakingService.registerGenesisValidatorDirect(
              account,
              contractService,
              0, // Genesis Block 번호
              timestamp,
            );

          if (success) {
            registered++;
            this.logger.debug(
              `Registered validator ${account.address} (${registered}/${accountsToRegister.length})`,
            );
          } else {
            skipped++;
          }
        } catch (error) {
          failed++;
          this.logger.error(
            `Failed to register validator ${account.address}: ${error.message}`,
          );
        }
      }

      this.logger.log(
        `Genesis Validator registration completed: ${registered} registered, ${skipped} skipped, ${failed} failed`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to load genesis-accounts.json: ${error.message}`,
      );
    }
  }

  /**
   * genesis-accounts.json 파일 경로 찾기
   */
  private findGenesisAccountsFile(): string | null {
    const possiblePaths = [
      path.resolve(process.cwd(), 'genesis-accounts.json'),
      path.resolve(__dirname, '../../genesis-accounts.json'),
      path.resolve(__dirname, '../../../genesis-accounts.json'),
    ];

    for (const filePath of possiblePaths) {
      if (fs.existsSync(filePath)) {
        return filePath;
      }
    }

    return null;
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
    // ⚠️ 중요: Solidity의 block.timestamp는 초 단위이므로 밀리초를 초로 변환
    // 하지만 Block Entity는 밀리초를 저장하므로 Date.now() 사용
    const timestamp = Date.now();

    // 2. StateManager가 최신 블록의 stateRoot를 사용하도록 설정
    // (트랜잭션 실행 전에 최신 상태를 보장)
    // BlockProducer에서 이미 startBlock()을 호출했으므로 여기서는 setStateRoot만 호출
    await this.stateRepository.setStateRoot(latestBlock.stateRoot);

    // 3. Mempool에서 pending 트랜잭션 가져오기
    const pendingTxs = this.txPool.getPending();

    // this.logger.log(
    //   `Creating Block #${blockNumber} with ${pendingTxs.length} transactions`,
    // );

    // 4. 트랜잭션 실행 및 Receipt 생성
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
        const exec = await this.executeTransaction(tx, blockNumber, timestamp);
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

    // 8. Block Logs Bloom 계산 (이더리움 표준)
    // 모든 Receipt의 logsBloom을 OR 연산
    const receiptLogsBlooms = receipts.map((receipt) => receipt.logsBloom);
    const blockLogsBloom =
      this.cryptoService.combineLogsBlooms(receiptLogsBlooms);

    // 9. Block Hash 계산
    const hash = this.calculateBlockHash(
      blockNumber,
      parentHash,
      timestamp,
      proposer,
      transactionsRoot,
      receiptsRoot,
      blockLogsBloom,
      stateRoot,
    );

    // 10. Block 생성
    const block = new Block(
      blockNumber,
      parentHash,
      timestamp,
      proposer,
      executedTxs,
      stateRoot,
      transactionsRoot,
      receiptsRoot,
      blockLogsBloom,
      hash,
    );

    for (const receipt of receipts) {
      receipt.blockHash = hash;
      for (const log of receipt.logs) {
        log.blockHash = hash;
      }
    }

    // 11. Queued 트랜잭션을 Pending으로 전환
    // 트랜잭션이 실행되어 nonce가 증가했으므로,
    // 해당 계정의 queued 트랜잭션 중 실행 가능한 것들을 pending으로 전환
    const processedAddresses = new Set<string>();
    for (const tx of executedTxs) {
      const addressLower = tx.from.toLowerCase();
      if (!processedAddresses.has(addressLower)) {
        processedAddresses.add(addressLower);
        const newNonce = await this.accountService.getNonce(tx.from);
        this.txPool.promoteQueuedToPending(tx.from, newNonce);
      }
    }

    // 12. Receipt를 Block에 임시 저장 (나중에 saveBlock에서 사용)
    type BlockWithReceipts = Block & { receipts?: TransactionReceipt[] };
    (block as BlockWithReceipts).receipts = receipts;

    // 13. 저장하지 않음! (BlockProducer에서 2/3 확인 후 저장)
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
   * 컨트랙트 함수를 VM을 통해 직접 호출 (트랜잭션 없이)
   *
   * 이더리움:
   * - Beacon Chain이 Execution Layer로 출금 정보 전달
   * - Execution Layer가 블록 생성 시 자동 처리 (트랜잭션 없이)
   *
   * 우리:
   * - VM을 통해 processWithdrawals() 직접 호출
   * - 트랜잭션 풀을 거치지 않음
   * - 블록 생성 시 자동 처리
   *
   * @param to - 컨트랙트 주소
   * @param data - 함수 선택자 + 파라미터 (ABI 인코딩)
   * @param from - 호출자 주소
   * @param value - 전송할 금액 (Wei)
   * @param blockNumber - 현재 블록 번호
   * @param timestamp - 현재 블록 타임스탬프 (밀리초)
   * @returns 실행 결과 (반환값, 로그, 가스 사용량)
   */
  async executeContractDirect(
    to: Address,
    data: string,
    from: Address,
    privateKey: string,
    value: bigint,
    blockNumber: number,
    timestamp: number,
  ): Promise<{
    result: string;
    logs: { address: Address; topics: Hash[]; data: string }[];
    gasUsed: bigint;
  }> {
    if (!this.vm) {
      throw new Error('VM is not initialized');
    }

    // data를 Buffer로 변환
    const dataHex = data.startsWith('0x') ? data.slice(2) : data;
    const dataBuffer = Buffer.from(dataHex, 'hex');
    const dataBytes = new Uint8Array(dataBuffer);

    // 주소를 Buffer로 변환 (EthAddress 생성용)
    const toBytes = this.cryptoService.hexToBytes(to);
    const toBuffer = Buffer.from(toBytes);
    const toEthAddress = new EthAddress(new Uint8Array(toBuffer));

    // 트랜잭션 객체 생성 (실제 서명 필요 - runTx가 서명 검증함)
    // nonce는 계정의 현재 nonce 사용
    const accountNonce = await this.accountService.getNonce(from);
    const gasPrice = 1000000000n; // 1 Gwei
    const gasLimit = 10000000n; // 충분한 가스 한도

    // 트랜잭션 해시 계산 (EIP-155 서명 대상)
    // RLP([nonce, gasPrice, gasLimit, to, value, data, chainId, 0, 0])
    const toBytesForSign = to
      ? this.cryptoService.hexToBytes(to)
      : new Uint8Array(0);
    const toBufferForSign = Buffer.from(toBytesForSign);
    const dataBufferForSign = Buffer.from(dataBytes);

    const signArray = [
      this.toRlpBuffer(BigInt(accountNonce)),
      this.toRlpBuffer(gasPrice),
      this.toRlpBuffer(gasLimit),
      toBufferForSign,
      this.toRlpBuffer(value),
      dataBufferForSign,
      this.toRlpBuffer(BigInt(CHAIN_ID)),
      Buffer.alloc(0), // r = 0
      Buffer.alloc(0), // s = 0
    ];

    const signRlp = this.cryptoService.rlpEncode(signArray);
    const txHash = this.cryptoService.hashBuffer(Buffer.from(signRlp));

    // EIP-155 서명 생성
    const signature = this.cryptoService.signTransaction(
      txHash,
      privateKey,
      CHAIN_ID,
    );

    // 서명된 트랜잭션 생성
    const rValue = Buffer.from(this.cryptoService.hexToBytes(signature.r));
    const sValue = Buffer.from(this.cryptoService.hexToBytes(signature.s));

    const txForVM = createLegacyTx(
      {
        nonce: BigInt(accountNonce),
        gasPrice,
        gasLimit,
        to: toEthAddress,
        value,
        data: dataBytes,
        v: BigInt(signature.v),
        r: rValue,
        s: sValue,
      },
      { common: this.common },
    );

    // Block Header 생성
    const blockHeader = new EthereumBlockHeader(
      {
        number: BigInt(blockNumber),
        gasLimit: 30000000n,
        timestamp: BigInt(Math.floor(timestamp / 1000)), // 초 단위
        parentHash: Buffer.alloc(32, 0),
        stateRoot: Buffer.alloc(32, 0),
        transactionsTrie: Buffer.alloc(32, 0),
        receiptTrie: Buffer.alloc(32, 0),
        logsBloom: Buffer.alloc(256, 0),
        difficulty: 0n,
        extraData: Buffer.alloc(0),
        gasUsed: 0n,
        mixHash: Buffer.alloc(32, 0),
        nonce: Buffer.alloc(8, 0),
      },
      { common: this.common },
    );

    const vmBlock = new EthereumBlock(blockHeader, [], [], undefined, {
      common: this.common,
    });

    // VM을 통해 직접 실행
    const result = await runTx(this.vm, {
      tx: txForVM,
      block: vmBlock,
    });

    // 실행 결과 파싱
    const status: 1 | 0 = result.execResult.exceptionError ? 0 : 1;
    if (status === 0) {
      const error = result.execResult.exceptionError;
      throw new Error(
        `Contract execution failed: ${error?.error?.toString() || 'Unknown error'}`,
      );
    }

    // 반환값 추출
    const returnValue = result.execResult.returnValue || new Uint8Array();
    const resultHex = this.cryptoService.bytesToHex(returnValue);

    // 로그 추출
    const logs: { address: Address; topics: Hash[]; data: string }[] = [];
    if (result.execResult.logs) {
      for (const log of result.execResult.logs) {
        const logAddress = this.cryptoService.bytesToHex(
          Buffer.from(log[0] as Uint8Array),
        );
        const logTopics = (log[1] as Uint8Array[]).map((topic) =>
          this.cryptoService.bytesToHex(Buffer.from(topic)),
        );
        const logData = this.cryptoService.bytesToHex(
          Buffer.from(log[2] as Uint8Array),
        );
        logs.push({
          address: logAddress,
          topics: logTopics,
          data: logData,
        });
      }
    }

    // 가스 사용량 추출
    const gasUsed =
      result.execResult.executionGasUsed !== undefined
        ? result.execResult.executionGasUsed
        : 0n;

    // nonce 증가 (실제 트랜잭션이 아니지만 상태 변경이 일어났으므로)
    await this.accountService.incrementNonce(from);

    return {
      result: resultHex,
      logs,
      gasUsed,
    };
  }

  /**
   * 컨트랙트 배포 (VM을 통해 직접 실행, 트랜잭션 제출 없이)
   *
   * 현재 상황:
   * - Execution Layer와 Consensus Layer가 통합되어 있음
   * - 컨트랙트 배포를 트랜잭션으로 처리하면 nonce race condition 발생 가능
   * - Genesis Block 생성 시점이나 특수한 경우에 직접 배포 필요
   *
   * 해결 방법:
   * - VM을 통해 직접 컨트랙트 배포
   * - 트랜잭션 없이 상태 변경 (가스 비용 없음, 블록에 포함되지 않음)
   * - nonce는 증가시키지만 실제 트랜잭션은 생성하지 않음
   *
   * 추후 레이어 분리 시:
   * - Execution Layer: 트랜잭션으로 컨트랙트 배포
   * - Consensus Layer: 블록에 포함하여 실행
   * - 레이어 분리 시에는 트랜잭션 방식으로 처리 가능
   *
   * @param bytecode - 컨트랙트 바이트코드 (hex string)
   * @param from - 배포자 주소
   * @param privateKey - 배포자 개인키
   * @param value - 전송할 금액 (Wei, 기본값: 0)
   * @param blockNumber - 블록 번호
   * @param timestamp - 타임스탬프 (밀리초)
   * @returns 배포된 컨트랙트 주소
   */
  async deployContractDirect(
    bytecode: string,
    from: Address,
    privateKey: string,
    value: bigint = 0n,
    blockNumber: number,
    timestamp: number,
  ): Promise<Address> {
    if (!this.vm) {
      throw new Error('VM is not initialized');
    }

    // bytecode를 Buffer로 변환
    const bytecodeHex = bytecode.startsWith('0x')
      ? bytecode.slice(2)
      : bytecode;
    const bytecodeBuffer = Buffer.from(bytecodeHex, 'hex');
    const bytecodeBytes = new Uint8Array(bytecodeBuffer);

    // 트랜잭션 객체 생성 (컨트랙트 배포는 to가 null)
    const accountNonce = await this.accountService.getNonce(from);
    const gasPrice = 1000000000n; // 1 Gwei
    const gasLimit = 10000000n; // 충분한 가스 한도

    // 트랜잭션 해시 계산 (EIP-155 서명 대상)
    // RLP([nonce, gasPrice, gasLimit, to(null), value, data, chainId, 0, 0])
    const toBufferForSign = Buffer.alloc(0); // 컨트랙트 배포는 to가 null
    const dataBufferForSign = Buffer.from(bytecodeBytes);

    const signArray = [
      this.toRlpBuffer(BigInt(accountNonce)),
      this.toRlpBuffer(gasPrice),
      this.toRlpBuffer(gasLimit),
      toBufferForSign, // null인 경우 빈 버퍼
      this.toRlpBuffer(value),
      dataBufferForSign,
      this.toRlpBuffer(BigInt(CHAIN_ID)),
      Buffer.alloc(0), // r = 0
      Buffer.alloc(0), // s = 0
    ];

    const signRlp = this.cryptoService.rlpEncode(signArray);
    const txHash = this.cryptoService.hashBuffer(Buffer.from(signRlp));

    // EIP-155 서명 생성
    const signature = this.cryptoService.signTransaction(
      txHash,
      privateKey,
      CHAIN_ID,
    );

    // 서명된 트랜잭션 생성 (to가 null인 경우 undefined)
    const rValue = Buffer.from(this.cryptoService.hexToBytes(signature.r));
    const sValue = Buffer.from(this.cryptoService.hexToBytes(signature.s));

    const txForVM = createLegacyTx(
      {
        nonce: BigInt(accountNonce),
        gasPrice,
        gasLimit,
        to: undefined, // 컨트랙트 배포는 to가 null
        value,
        data: bytecodeBytes,
        v: BigInt(signature.v),
        r: rValue,
        s: sValue,
      },
      { common: this.common },
    );

    // Block Header 생성
    const blockHeader = new EthereumBlockHeader(
      {
        number: BigInt(blockNumber),
        gasLimit: 30000000n,
        timestamp: BigInt(Math.floor(timestamp / 1000)), // 초 단위
        parentHash: Buffer.alloc(32, 0),
        stateRoot: Buffer.alloc(32, 0),
        transactionsTrie: Buffer.alloc(32, 0),
        receiptTrie: Buffer.alloc(32, 0),
        logsBloom: Buffer.alloc(256, 0),
        difficulty: 0n,
        extraData: Buffer.alloc(0),
        gasUsed: 0n,
        mixHash: Buffer.alloc(32, 0),
        nonce: Buffer.alloc(8, 0),
      },
      { common: this.common },
    );

    const vmBlock = new EthereumBlock(blockHeader, [], [], undefined, {
      common: this.common,
    });

    // VM을 통해 직접 실행
    const result = await runTx(this.vm, {
      tx: txForVM,
      block: vmBlock,
    });

    // 실행 결과 파싱
    const status: 1 | 0 = result.execResult.exceptionError ? 0 : 1;
    if (status === 0) {
      const error = result.execResult.exceptionError;
      throw new Error(
        `Contract deployment failed: ${error?.error?.toString() || 'Unknown error'}`,
      );
    }

    // 배포된 컨트랙트 주소 추출
    const created = result.createdAddress;
    let contractAddress: Address | null = null;

    if (created) {
      // Address 타입 처리: string, Address 객체, Uint8Array, Buffer 등
      if (typeof created === 'string') {
        contractAddress = created;
      } else if (created && typeof created === 'object') {
        // Address 객체인 경우 .toString() 또는 .bytes 사용
        if ('toString' in created) {
          const addrStr = (created as { toString: () => string }).toString();
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
        contractAddress = `0x${contractAddress}`;
      }
    }

    if (!contractAddress) {
      throw new Error('Failed to get deployed contract address');
    }

    // nonce 증가 (실제 트랜잭션이 아니지만 상태 변경이 일어났으므로)
    await this.accountService.incrementNonce(from);

    return contractAddress;
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
    blockNumber: number,
    timestamp: number,
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

      // VM 실행 시 새 블록 컨텍스트 사용 (현재 생성 중인 블록)
      // 주의: 우리의 Block 엔티티는 코어 로직이므로 유지하되,
      // runTx에 전달할 때만 @ethereumjs/block의 Block 객체로 변환
      let result;
      try {
        // runTx에 전달하기 위한 임시 Block 객체 생성
        // 실제 블록 저장/조회는 우리의 Block 엔티티 사용
        // @ethereumjs/block v10에서는 BlockHeader를 먼저 생성하고 Block에 전달
        const blockHeader = new EthereumBlockHeader(
          {
            number: BigInt(blockNumber),
            gasLimit: 30000000n,
            // ⚠️ 중요: Solidity의 block.timestamp는 초 단위이므로 밀리초를 초로 변환
            timestamp: BigInt(Math.floor(timestamp / 1000)),
            // 기본값들 추가 (runTx가 요구하는 필수 필드)
            parentHash: Buffer.alloc(32, 0), // 임시값 (실제 값은 나중에 계산됨)
            stateRoot: Buffer.alloc(32, 0), // 임시값
            transactionsTrie: Buffer.alloc(32, 0), // 임시값
            receiptTrie: Buffer.alloc(32, 0), // 임시값
            logsBloom: Buffer.alloc(256, 0), // 임시값
            difficulty: 0n,
            extraData: Buffer.alloc(0),
            gasUsed: 0n,
            mixHash: Buffer.alloc(32, 0),
            nonce: Buffer.alloc(8, 0),
          },
          { common: this.common },
        );

        // @ethereumjs/block v10: Block 생성자는 (header, transactions, uncleHeaders, options) 형식
        // options는 네 번째 인자로 전달
        const vmBlock = new EthereumBlock(
          blockHeader,
          [], // transactions
          [], // uncleHeaders
          undefined, // withdrawals (optional)
          { common: this.common }, // options
        );

        result = await runTx(this.vm, {
          tx: txForVM,
          block: vmBlock, // 임시 Block 객체만 runTx에 전달
        });
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

      // gasUsed 계산: VM 실행 결과에서 가스 사용량 추출
      let gasUsed: bigint;
      if (result.gasUsed !== undefined) {
        gasUsed = result.gasUsed;
      } else if (result.execResult.gasUsed !== undefined) {
        gasUsed = result.execResult.gasUsed;
      } else {
        // 가스 사용량이 없는 경우: 트랜잭션이 실행되지 않았거나 초기 단계에서 실패
        // 컨트랙트 호출인 경우 최소 가스 사용량 설정
        gasUsed =
          tx.to !== null && tx.data && tx.data !== '0x' && tx.data.length > 2
            ? BigInt(21000) // 기본 가스 (실제로는 더 많이 사용했을 수 있음)
            : BigInt(21000); // 일반 송금 기본 가스
        this.logger.warn(
          `[VM] Gas used not found in result, using default: ${gasUsed} (tx: ${tx.hash})`,
        );
      }

      // 담보 예치 트랜잭션 디버깅: runTx 성공 후 결과 확인
      if (tx.to && tx.data && tx.data.startsWith('0x6f758140')) {
        if (result.execResult.exceptionError) {
          // 실제 에러인 경우에만 ERROR 레벨
          const err = result.execResult.exceptionError;
          this.logger.error(
            `[VM] 🔍 DEPOSIT COLLATERAL FAILED - tx=${tx.hash}, status=${status}, gasUsed=${gasUsed.toString()}`,
          );
          this.logger.error(
            `[VM] 🔍 Exception error: ${JSON.stringify(
              {
                error: err.error?.toString(),
                errorType: err.errorType,
                reason: err.reason,
              },
              null,
              2,
            )}`,
          );
        } else {
          // 성공한 경우 DEBUG 레벨
          this.logger.debug(
            `[VM] 🔍 DEPOSIT COLLATERAL SUCCESS - tx=${tx.hash}, status=${status}, gasUsed=${gasUsed.toString()}`,
          );
          this.logger.debug(
            `[VM] 🔍 Result summary: gasUsed=${result.gasUsed?.toString() || 'undefined'}, execResult.gasUsed=${result.execResult.gasUsed?.toString() || 'undefined'}, returnValue length=${result.execResult.returnValue?.length || 0}`,
          );
        }
      }

      // 생성자 실행 결과 확인 (컨트랙트 배포인 경우)
      if (tx.to === null) {
        const returnValue = result.execResult.returnValue || new Uint8Array();
        const returnValueHex = this.cryptoService.bytesToHex(returnValue);
        this.logger.warn(
          `[VM] Contract deployment: createdAddress=${result.createdAddress || 'null'}, returnValue length=${returnValue.length} bytes, status=${status}, gasUsed=${gasUsed}`,
        );
        if (result.execResult.exceptionError) {
          const err = result.execResult.exceptionError;
          // 컨트랙트 생성자 실패는 정상적인 현상일 수 있음 (WARN으로 처리)
          this.logger.warn(
            `[VM] Constructor failed (contract may revert intentionally): ${JSON.stringify(
              {
                error: err.error?.toString(),
                errorType: err.errorType,
                reason: err.reason,
              },
            )}`,
          );
        }
        if (returnValue.length > 0) {
          this.logger.warn(
            `[VM] Return value (first 200 chars): ${returnValueHex.slice(0, 200)}...`,
          );
        }
      }

      // 실패 시 에러 메시지 로깅 (컨트랙트 배포 실패는 WARN, 일반 트랜잭션 실패는 ERROR)
      if (result.execResult.exceptionError) {
        const errorInfo = result.execResult.exceptionError;
        // 컨트랙트 배포 실패는 WARN, 일반 트랜잭션 실패는 ERROR
        const logLevel = tx.to === null ? 'warn' : 'error';
        const logMessage = `[VM] Transaction failed: ${tx.hash} - Error: ${errorInfo.error || 'Unknown error'}`;

        if (logLevel === 'warn') {
          this.logger.warn(logMessage);
        } else {
          this.logger.error(logMessage);
        }
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
        // 트랜잭션 상세 정보 로깅 (디버깅용)
        this.logger.error(
          `[VM] Failed transaction details: to=${tx.to}, value=${tx.value}, data=${tx.data?.slice(0, 20)}..., gasLimit=${tx.gasLimit}, gasPrice=${tx.gasPrice}`,
        );
        // 담보 예치 트랜잭션 디버깅을 위한 추가 로깅 (실제 에러인 경우만)
        if (tx.to && tx.data && tx.data.startsWith('0x6f758140')) {
          this.logger.error(
            `[VM] 🔍 DEPOSIT COLLATERAL FAILED: tx=${tx.hash}, to=${tx.to}, value=${tx.value.toString()}, data=${tx.data}, gasUsed=${gasUsed.toString()}, status=${status}`,
          );
          this.logger.error(
            `[VM] 🔍 Exception error full: ${JSON.stringify(errorInfo, null, 2)}`,
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

      // Logs Bloom Filter 계산 (이더리움 표준)
      const logsBloom = this.cryptoService.calculateLogsBloom(logs);

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
    logsBloom: string,
    stateRoot: Hash,
  ): Hash {
    // Header 필드를 배열로 구성 (순서 중요!)
    // RLP 인코딩: [parentHash, stateRoot, transactionsRoot, receiptsRoot, logsBloom, number, timestamp, proposer]
    // 이더리움 표준에 따라 logsBloom이 receiptsRoot 다음에 위치
    const headerArray = [
      this.cryptoService.hexToBytes(parentHash), // 이전 블록 해시
      this.cryptoService.hexToBytes(stateRoot), // 상태 루트
      this.cryptoService.hexToBytes(transactionsRoot), // 트랜잭션 루트
      this.cryptoService.hexToBytes(receiptsRoot), // Receipt 루트
      this.cryptoService.hexToBytes(logsBloom), // Logs Bloom
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
      // 이더리움 표준: [status, cumulativeGasUsed, logsBloom, logs]
      // logs는 [address, topics[], data] 형식의 배열
      const encodedLogs = receipt.logs.map((log) => [
        this.cryptoService.hexToBytes(log.address),
        log.topics.map((topic) => this.cryptoService.hexToBytes(topic)),
        this.cryptoService.hexToBytes(log.data || '0x'),
      ]);

      const value = this.cryptoService.rlpEncode([
        receipt.status.toString(), // status (1 or 0) - string으로 변환
        receipt.cumulativeGasUsed.toString(), // cumulative gas used (bigint → string)
        this.cryptoService.hexToBytes(receipt.logsBloom), // logs bloom
        encodedLogs, // logs array
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
