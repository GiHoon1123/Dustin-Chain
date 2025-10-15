import * as fs from 'fs';
import * as path from 'path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AccountService } from '../account/account.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { Address, Hash } from '../common/types/common.types';
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
    const transactionsRoot = this.calculateTransactionsRoot([]);

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
    const transactionsRoot = this.calculateTransactionsRoot(executedTxs);

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

    // 9. 저장
    await this.repository.save(block);

    this.logger.log(
      `Block #${blockNumber} created: ${hash} (${executedTxs.length} txs)`,
    );

    return block;
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
   * 이더리움:
   * - Keccak-256(RLP(header))
   * - Header 필드들을 RLP 인코딩 후 해시
   *
   * 우리:
   * - 간단하게 JSON으로 직렬화 후 해시
   * - 나중에 RLP 추가
   *
   * @param number - 블록 번호
   * @param parentHash - 이전 블록 해시
   * @param timestamp - 생성 시간
   * @param proposer - 블록 생성자
   * @param transactionsRoot - 트랜잭션 루트
   * @param stateRoot - 상태 루트
   * @returns 블록 해시
   */
  private calculateBlockHash(
    number: number,
    parentHash: Hash,
    timestamp: number,
    proposer: Address,
    transactionsRoot: Hash,
    stateRoot: Hash,
  ): Hash {
    const headerData = {
      number,
      parentHash,
      timestamp,
      proposer,
      transactionsRoot,
      stateRoot,
    };

    return this.cryptoService.hashUtf8(JSON.stringify(headerData));
  }

  /**
   * State Root 계산
   *
   * 이더리움:
   * - Merkle Patricia Trie의 루트 해시
   * - 모든 계정 상태를 Trie에 저장
   *
   * 우리 (현재):
   * - 간단하게 모든 계정을 JSON으로 해시
   * - 나중에 Merkle Tree 추가
   *
   * @returns State Root 해시
   */
  private async calculateStateRoot(): Promise<Hash> {
    const accounts = await this.accountService.getAllAccounts();
    const stateData = accounts.map((acc) => ({
      address: acc.address,
      balance: acc.balance.toString(),
      nonce: acc.nonce,
    }));

    return this.cryptoService.hashUtf8(JSON.stringify(stateData));
  }

  /**
   * Transactions Root 계산
   *
   * 이더리움:
   * - Merkle Tree의 루트 해시
   * - 트랜잭션들을 Merkle Tree로 구성
   *
   * 우리 (현재):
   * - 트랜잭션 해시들을 모아서 해시
   * - 나중에 Merkle Tree 추가
   *
   * @param transactions - 트랜잭션 리스트
   * @returns Transactions Root 해시
   */
  private calculateTransactionsRoot(transactions: Transaction[]): Hash {
    if (transactions.length === 0) {
      return '0x' + '0'.repeat(64);
    }

    const txHashes = transactions.map((tx) => tx.hash);
    return this.cryptoService.hashUtf8(JSON.stringify(txHashes));
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
