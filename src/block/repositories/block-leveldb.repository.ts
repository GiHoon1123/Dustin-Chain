import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ClassicLevel } from 'classic-level';
import { LRUCache } from 'lru-cache';
import { CryptoService } from '../../common/crypto/crypto.service';
import { Hash } from '../../common/types/common.types';
import { Transaction } from '../../transaction/entities/transaction.entity';
import { Block, BlockBody, BlockHeader } from '../entities/block.entity';
import { IBlockRepository } from './block.repository.interface';

/**
 * BlockLevelDBRepository (Ethereum Geth 방식)
 * 
 * Geth의 데이터베이스 구조:
 * - 단일 LevelDB (chaindata/)
 * - Prefix로 데이터 타입 구분
 * - Header/Body 분리 저장
 * - Header는 LRU 캐싱
 * 
 * 저장 키:
 * - "H" + blockNumber → blockHash (Canonical chain)
 * - "n" + blockHash → blockNumber (역조회)
 * - "h" + blockNumber + blockHash → Block Header (RLP)
 * - "b" + blockNumber + blockHash → Block Body (RLP)
 * - "LastBlock" → latestBlockHash
 */
@Injectable()
export class BlockLevelDBRepository implements IBlockRepository, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BlockLevelDBRepository.name);
  private db: ClassicLevel<string, string>;
  
  // Header 캐싱 (LRU, 최근 10,000개)
  private headerCache: LRUCache<Hash, BlockHeader>;
  
  constructor(private readonly cryptoService: CryptoService) {
    this.db = new ClassicLevel<string, string>('./data/chaindata', {
      valueEncoding: 'utf8',
    });
    
    // Header 캐시 초기화 (10,000개, 약 2MB)
    this.headerCache = new LRUCache<Hash, BlockHeader>({
      max: 10000,
      ttl: 1000 * 60 * 60, // 1시간
    });
  }

  async onModuleInit(): Promise<void> {
    await this.db.open();
    this.logger.log('BlockLevelDB opened: ./data/chaindata');
  }

  async onModuleDestroy(): Promise<void> {
    await this.db.close();
    this.logger.log('BlockLevelDB closed');
  }

  /**
   * 블록 저장 (Geth 방식)
   * 
   * 1. Header 저장 (h + number + hash)
   * 2. Body 저장 (b + number + hash)
   * 3. Canonical 설정 (H + number → hash)
   * 4. 역조회 설정 (n + hash → number)
   * 5. LastBlock 업데이트
   * 6. Header 캐싱
   */
  async save(block: Block): Promise<void> {
    const header = block.getHeader();
    const body = block.getBody();

    try {
      // 1. Header 저장
      const headerKey = `h${block.number}${block.hash}`;
      await this.db.put(headerKey, this.serializeHeader(header));

      // 2. Body 저장
      const bodyKey = `b${block.number}${block.hash}`;
      await this.db.put(bodyKey, this.serializeBody(body));

      // 3. Canonical chain 설정
      const canonicalKey = `H${block.number}`;
      await this.db.put(canonicalKey, block.hash);

      // 4. 역조회 (hash → number)
      const numberKey = `n${block.hash}`;
      await this.db.put(numberKey, block.number.toString());

      // 5. LastBlock 업데이트
      await this.db.put('LastBlock', block.hash);

      // 6. Header 캐싱
      this.headerCache.set(block.hash, header);

      this.logger.debug(`Block #${block.number} saved: ${block.hash}`);
    } catch (error: any) {
      this.logger.error(`Failed to save block #${block.number}:`, error);
      throw error;
    }
  }

  /**
   * 블록 번호로 조회
   * 
   * 1. Canonical 해시 조회 (H + number)
   * 2. 해시로 블록 조회
   */
  async findByNumber(blockNumber: number): Promise<Block | null> {
    try {
      // 1. Canonical 해시
      const canonicalKey = `H${blockNumber}`;
      const hash = await this.db.get(canonicalKey);

      // 2. 해시로 조회
      return await this.findByHash(hash);
    } catch (error: any) {
      if (error.code === 'LEVEL_NOT_FOUND') {
        return null;
      }
      this.logger.error(`Failed to find block by number ${blockNumber}:`, error);
      throw error;
    }
  }

  /**
   * 블록 해시로 조회
   * 
   * 1. Header 조회 (캐시 우선)
   * 2. Body 조회 (디스크)
   * 3. Block 재구성
   */
  async findByHash(hash: Hash): Promise<Block | null> {
    try {
      // 1. 블록 번호 조회 (역조회)
      const numberKey = `n${hash}`;
      const blockNumber = parseInt(await this.db.get(numberKey));

      // 2. Header 조회 (캐시 우선)
      let header = this.headerCache.get(hash);
      if (!header) {
        const headerKey = `h${blockNumber}${hash}`;
        const headerData = await this.db.get(headerKey);
        header = this.deserializeHeader(headerData);
        this.headerCache.set(hash, header);
      }

      // 3. Body 조회 (디스크)
      const bodyKey = `b${blockNumber}${hash}`;
      const bodyData = await this.db.get(bodyKey);
      const body = this.deserializeBody(bodyData);

      // 4. Block 재구성
      return Block.fromHeaderAndBody(header, body);
    } catch (error: any) {
      if (error.code === 'LEVEL_NOT_FOUND') {
        return null;
      }
      this.logger.error(`Failed to find block by hash ${hash}:`, error);
      throw error;
    }
  }

  /**
   * 최신 블록 조회
   */
  async findLatest(): Promise<Block | null> {
    try {
      const latestHash = await this.db.get('LastBlock');
      return await this.findByHash(latestHash);
    } catch (error: any) {
      if (error.code === 'LEVEL_NOT_FOUND') {
        return null;
      }
      this.logger.error('Failed to find latest block:', error);
      throw error;
    }
  }

  /**
   * 범위 조회 (from ~ to)
   */
  async findByRange(from: number, to: number): Promise<Block[]> {
    const blocks: Block[] = [];

    for (let i = from; i <= to; i++) {
      const block = await this.findByNumber(i);
      if (block) {
        blocks.push(block);
      }
    }

    return blocks;
  }

  /**
   * 전체 블록 개수
   */
  async count(): Promise<number> {
    const latest = await this.findLatest();
    return latest ? latest.number + 1 : 0;
  }

  /**
   * 모든 블록 조회 (메모리 주의!)
   */
  async findAll(): Promise<Block[]> {
    const count = await this.count();
    if (count === 0) return [];
    
    return await this.findByRange(0, count - 1);
  }

  // ========== 직렬화/역직렬화 ==========

  /**
   * Header 직렬화 (RLP)
   */
  private serializeHeader(header: BlockHeader): string {
    const headerArray = [
      header.number.toString(),
      header.hash,
      header.parentHash,
      header.timestamp.toString(),
      header.proposer,
      header.stateRoot,
      header.transactionsRoot,
      header.transactionCount.toString(),
    ];

    const rlpEncoded = this.cryptoService.rlpEncode(headerArray);
    return Buffer.from(rlpEncoded).toString('hex');
  }

  /**
   * Header 역직렬화 (RLP)
   */
  private deserializeHeader(serializedData: string): BlockHeader {
    try {
      const hexBuffer = Buffer.from(serializedData, 'hex');
      const decoded = this.cryptoService.rlpDecode(hexBuffer);
      
      const [number, hash, parentHash, timestamp, proposer, stateRoot, transactionsRoot, transactionCount] = decoded as string[];

      return {
        number: parseInt(number),
        hash,
        parentHash,
        timestamp: parseInt(timestamp),
        proposer,
        stateRoot,
        transactionsRoot,
        transactionCount: parseInt(transactionCount),
      };
    } catch (error: any) {
      this.logger.error('Failed to deserialize header:', error);
      throw new Error('Invalid header data in database');
    }
  }

  /**
   * Body 직렬화 (RLP)
   */
  private serializeBody(body: BlockBody): string {
    // 트랜잭션 배열 직렬화
    const txsArray = body.transactions.map((tx) => [
      tx.hash,
      tx.from,
      tx.to,
      tx.value.toString(),
      tx.nonce.toString(),
      tx.timestamp.toString(),
      tx.v || '',
      tx.r || '',
      tx.s || '',
    ]);

    const rlpEncoded = this.cryptoService.rlpEncode(txsArray);
    return Buffer.from(rlpEncoded).toString('hex');
  }

  /**
   * Body 역직렬화 (RLP)
   */
  private deserializeBody(serializedData: string): BlockBody {
    try {
      const hexBuffer = Buffer.from(serializedData, 'hex');
      const decoded = this.cryptoService.rlpDecode(hexBuffer) as any[];

      const transactions = decoded.map((txData: any[]) => {
        const [hash, from, to, value, nonce, timestamp, v, r, s] = txData;
        
        const tx = new Transaction(from, to, BigInt(value));
        tx.hash = hash;
        tx.nonce = parseInt(nonce);
        tx.timestamp = parseInt(timestamp);
        if (v) tx.v = v;
        if (r) tx.r = r;
        if (s) tx.s = s;

        return tx;
      });

      return { transactions };
    } catch (error: any) {
      this.logger.error('Failed to deserialize body:', error);
      throw new Error('Invalid body data in database');
    }
  }
}

