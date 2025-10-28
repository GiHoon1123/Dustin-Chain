import { Trie } from '@ethereumjs/trie';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { AccountService } from '../account/account.service';
import { EMPTY_ROOT } from '../common/constants/blockchain.constants';
import { CryptoService } from '../common/crypto/crypto.service';
import { Address, Hash } from '../common/types/common.types';
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
@Injectable()
export class BlockService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BlockService.name);

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
  ) {}

  /**
   * 애플리케이션 부트스트랩
   *
   * NestJS Lifecycle:
   * 1. onModuleInit (모든 모듈) - BlockLevelDBRepository DB 열기, StateLevelDBRepository DB 열기
   * 2. onApplicationBootstrap (모든 모듈) - Genesis Block 체크/생성, State 복원 ✅
   *
   * 이 시점에는 모든 LevelDB가 이미 열린 상태 보장
   */
  async onApplicationBootstrap(): Promise<void> {
    this.logger.log('Checking Genesis Block...');
    await this.createGenesisBlock();

    // State 복원
    await this.restoreState();
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
        this.logger.log(
          'No blocks found - State will be initialized from Genesis',
        );
        return;
      }

      // 최신 블록의 stateRoot로 State Trie 연결
      await this.stateRepository.setStateRoot(latestBlock.stateRoot);

      this.logger.log(
        `State restored from block #${latestBlock.number} (stateRoot: ${latestBlock.stateRoot})`,
      );
    } catch (error: any) {
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
      this.logger.log('Genesis Block already exists');
      return existing;
    }

    this.logger.log('Creating Genesis Block...');

    // genesis.json 로드
    const genesis = this.loadGenesisConfig();

    // alloc 계정들 초기화
    const addresses = Object.keys(genesis.alloc);
    for (const [address, data] of Object.entries(genesis.alloc)) {
      await this.accountService.addBalance(address, BigInt(data.balance));
    }

    // 첫 번째 계정을 Genesis Proposer로 설정
    this.GENESIS_PROPOSER = addresses[0];

    this.logger.log(
      `Initialized ${addresses.length} genesis accounts from genesis.json`,
    );

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
    this.logger.log('Genesis accounts committed to LevelDB');

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
        return JSON.parse(content);
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

    this.logger.log(
      `Creating Block #${blockNumber} with ${pendingTxs.length} transactions`,
    );

    // 3. 트랜잭션 실행 및 Receipt 생성
    const executedTxs: Transaction[] = [];
    const receipts: TransactionReceipt[] = [];
    let cumulativeGasUsed = BigInt(0);

    for (let i = 0; i < pendingTxs.length; i++) {
      const tx = pendingTxs[i];
      let status: 1 | 0 = 1; // 성공
      const gasUsed = BigInt(21000); // 기본 Gas (이더리움 기본 전송 Gas)

      try {
        await this.executeTransaction(tx);
        status = 1; // 성공
        this.logger.debug(`Transaction executed: ${tx.hash}`);
      } catch (error) {
        // 트랜잭션 실행 실패 (잔액 부족, nonce 불일치 등)
        // 이더리움 표준: 실패해도 블록에 포함하고 Gas는 차감
        this.logger.warn(
          `Transaction execution failed: ${tx.hash} - ${error.message}`,
        );
        status = 0; // 실패

        // Gas fee 차감 (실패해도 채굴자에게 보상)
        try {
          await this.accountService.subtractBalance(tx.from, gasUsed);
          await this.accountService.incrementNonce(tx.from);
        } catch (gasError) {
          this.logger.error(
            `Failed to deduct gas fee for failed tx ${tx.hash}: ${gasError.message}`,
          );
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
    (block as any).receipts = receipts;

    // 12. ✅ 저장하지 않음! (BlockProducer에서 2/3 확인 후 저장)
    // 블록 객체만 반환

    this.logger.log(
      `Block #${blockNumber} created (not saved yet): ${hash} (${executedTxs.length} txs, ${receipts.length} receipts)`,
    );

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
    const receipts = (block as any).receipts as
      | TransactionReceipt[]
      | undefined;
    if (receipts && receipts.length > 0) {
      for (const receipt of receipts) {
        // IBlockRepository에 saveReceipt 메서드가 있다고 가정
        if ('saveReceipt' in this.repository) {
          await (this.repository as any).saveReceipt(receipt);
        }
      }
      this.logger.debug(
        `${receipts.length} receipts saved for block #${block.number}`,
      );
    }

    this.logger.log(`Block #${block.number} saved: ${block.hash}`);
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
  private async executeTransaction(tx: Transaction): Promise<void> {
    // 송금 실행
    await this.accountService.transfer(tx.from, tx.to, tx.value);

    // Nonce 증가
    await this.accountService.incrementNonce(tx.from);

    this.logger.debug(
      `Transaction executed: ${tx.from} -> ${tx.to} (${tx.value} Wei)`,
    );
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
    const trie = new Trie();

    // 3. 각 트랜잭션을 Trie에 삽입
    for (let i = 0; i < transactions.length; i++) {
      const tx = transactions[i];

      // Key: RLP(index) - 트랜잭션 순서
      const key = this.cryptoService.rlpEncode(i);

      // Value: RLP(transaction) - 트랜잭션 전체 데이터
      // [nonce, to, value, from, v, r, s]
      const value = this.cryptoService.rlpEncode([
        tx.nonce, // nonce
        this.cryptoService.hexToBytes(tx.to), // to address
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
    const trie = new Trie();

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
}
