import * as fs from 'fs';
import * as path from 'path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Trie } from '@ethereumjs/trie';
import { AccountService } from '../account/account.service';
import { CryptoService } from '../common/crypto/crypto.service';
import {
  EMPTY_HASH,
  EMPTY_ROOT,
} from '../common/constants/blockchain.constants';
import { Address, Hash } from '../common/types/common.types';
import { StateManager } from '../state/state-manager';
import { Transaction } from '../transaction/entities/transaction.entity';
import { TransactionPool } from '../transaction/pool/transaction.pool';
import { Block } from './entities/block.entity';
import { IBlockRepository } from './repositories/block.repository.interface';

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
 */
@Injectable()
export class BlockService {
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
    private readonly cryptoService: CryptoService,
    private readonly accountService: AccountService,
    private readonly txPool: TransactionPool,
    private readonly stateManager: StateManager,
  ) {}

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

    const stateRoot = await this.calculateStateRoot();
    const transactionsRoot = await this.calculateTransactionsRoot([]);

    const hash = this.calculateBlockHash(
      0,
      parentHash,
      timestamp,
      this.GENESIS_PROPOSER,
      transactionsRoot,
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

    // 3. 트랜잭션 실행
    const executedTxs: Transaction[] = [];
    for (const tx of pendingTxs) {
      try {
        await this.executeTransaction(tx);
        tx.confirm(blockNumber);
        executedTxs.push(tx);
        this.txPool.remove(tx.hash);
        this.logger.debug(`Transaction executed: ${tx.hash}`);
      } catch (error) {
        // 트랜잭션 실행 실패 (잔액 부족, nonce 불일치 등)
        this.logger.warn(
          `Transaction execution failed: ${tx.hash} - ${error.message}`,
        );
        tx.fail();
        this.txPool.remove(tx.hash);
      }
    }

    // 4. (보상은 BlockProducer에서 처리)

    // 5. State Root 계산
    const stateRoot = await this.calculateStateRoot();

    // 6. Transactions Root 계산
    const transactionsRoot = await this.calculateTransactionsRoot(executedTxs);

    // 7. Block Hash 계산
    const hash = this.calculateBlockHash(
      blockNumber,
      parentHash,
      timestamp,
      proposer,
      transactionsRoot,
      stateRoot,
    );

    // 8. Block 생성
    const block = new Block(
      blockNumber,
      parentHash,
      timestamp,
      proposer,
      executedTxs,
      stateRoot,
      transactionsRoot,
      hash,
    );

    // 9. ✅ 저장하지 않음! (BlockProducer에서 2/3 확인 후 저장)
    // 블록 객체만 반환

    this.logger.log(
      `Block #${blockNumber} created (not saved yet): ${hash} (${executedTxs.length} txs)`,
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
    stateRoot: Hash,
  ): Hash {
    // Header 필드를 배열로 구성 (순서 중요!)
    // RLP 인코딩: [parentHash, stateRoot, transactionsRoot, number, timestamp, proposer]
    const headerArray = [
      this.cryptoService.hexToBytes(parentHash), // 이전 블록 해시
      this.cryptoService.hexToBytes(stateRoot), // 상태 루트
      this.cryptoService.hexToBytes(transactionsRoot), // 트랜잭션 루트
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
  private async calculateStateRoot(): Promise<Hash> {
    // 1. 새 Trie 인스턴스 생성
    const trie = new Trie();

    // 2. 모든 계정 조회
    const accounts = await this.accountService.getAllAccounts();

    // 3. 각 계정을 Trie에 삽입
    for (const account of accounts) {
      // Key: keccak256(address)
      const key = this.cryptoService.hexToBytes(
        this.cryptoService.hashHex(account.address),
      );

      // Value: RLP([nonce, balance, storageRoot, codeHash])
      // 이더리움 계정의 4가지 필드
      const value = this.cryptoService.rlpEncode([
        account.nonce, // nonce
        account.balance, // balance (BigInt)
        this.cryptoService.hexToBytes(EMPTY_ROOT), // storageRoot (스마트 컨트랙트 없음)
        this.cryptoService.hexToBytes(EMPTY_HASH), // codeHash (스마트 컨트랙트 없음)
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
