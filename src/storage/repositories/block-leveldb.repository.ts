import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ClassicLevel } from 'classic-level';
import * as LRUCacheModule from 'lru-cache';
import {
  Block,
  BlockBody,
  BlockHeader,
} from '../../block/entities/block.entity';
import { CryptoService } from '../../common/crypto/crypto.service';
import { Hash } from '../../common/types/common.types';
import { TransactionReceipt } from '../../transaction/entities/transaction-receipt.entity';
import { Transaction } from '../../transaction/entities/transaction.entity';
import { IBlockRepository } from './block.repository.interface';

const LRU = LRUCacheModule.LRUCache || LRUCacheModule;
type LRUType = typeof LRU;

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
 * - "r" + txHash → Transaction Receipt (RLP)
 * - "LastBlock" → latestBlockHash
 */
@Injectable()
export class BlockLevelDBRepository
  implements IBlockRepository, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(BlockLevelDBRepository.name);
  private db: ClassicLevel<string, string | Buffer>; // ✅ Binary 저장 (Geth 방식)

  // Header 캐싱 (LRU, 최근 10,000개)
  private headerCache: InstanceType<LRUType>;

  constructor(private readonly cryptoService: CryptoService) {
    // ✅ Mixed encoding: lookup keys (string), data values (Buffer)
    this.db = new ClassicLevel<string, string | Buffer>('./data/chaindata');

    // Header 캐시 초기화 (10,000개, 약 2MB)
    this.headerCache = new LRU<Hash, BlockHeader>({
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
   * 블록 저장 (Geth 방식 - Batch 사용)
   *
   * Batch를 사용하여 원자적(Atomic) 저장:
   * - 모든 작업이 성공하거나 모두 실패
   * - 중간 상태가 DB에 남지 않음
   * - 성능 향상 (여러 put → 1번의 write)
   *
   * 저장 항목:
   * 1. Header 저장 (h + number + hash)
   * 2. Body 저장 (b + number + hash)
   * 3. Canonical 설정 (H + number → hash)
   * 4. 역조회 설정 (n + hash → number)
   * 5. LastBlock 업데이트
   * 6. Header 캐싱 (DB 저장 성공 후)
   */
  async save(block: Block): Promise<void> {
    const header = block.getHeader();
    const body = block.getBody();

    try {
      // DB 상태 확인
      if (this.db.status !== 'open') {
        this.logger.warn(`Cannot save block #${block.number}: DB not open yet`);
        return;
      }

      // ✅ Batch 생성 (원자적 작업)
      const batch = this.db.batch();

      // 1. Header 저장 (Binary)
      const headerKey = `h${block.number}${block.hash}`;
      batch.put(headerKey, this.serializeHeader(header), { valueEncoding: 'buffer' });

      // 2. Body 저장 (Binary)
      const bodyKey = `b${block.number}${block.hash}`;
      batch.put(bodyKey, this.serializeBody(body), { valueEncoding: 'buffer' });

      // 3. Canonical chain 설정 (String - lookup key)
      const canonicalKey = `H${block.number}`;
      batch.put(canonicalKey, block.hash);

      // 4. 역조회 (hash → number, String - lookup key)
      const numberKey = `n${block.hash}`;
      batch.put(numberKey, block.number.toString());

      // 5. LastBlock 업데이트 (String - lookup key)
      batch.put('LastBlock', block.hash);

      // ✅ 원자적으로 모두 저장 (모두 성공 or 모두 실패)
      await batch.write();

      // 6. Header 캐싱 (DB 저장 성공 후에만)
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
      // DB 상태 확인
      if (this.db.status !== 'open') {
        this.logger.debug('DB not open yet, returning null');
        return null;
      }

      // 1. Canonical 해시
      const canonicalKey = `H${blockNumber}`;
      const hashRaw = await this.db.get(canonicalKey);

      if (!hashRaw) {
        return null;
      }

      // 2. 해시로 조회 (lookup key는 string)
      const hash = this.ensureString(hashRaw);
      return await this.findByHash(hash);
    } catch (error: any) {
      if (
        error.code === 'LEVEL_NOT_FOUND' ||
        error.code === 'LEVEL_DATABASE_NOT_OPEN'
      ) {
        return null;
      }
      this.logger.error(
        `Failed to find block by number ${blockNumber}:`,
        error,
      );
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
      const blockNumberRaw = await this.db.get(numberKey);

      if (!blockNumberRaw) {
        return null;
      }

      const blockNumber = parseInt(this.ensureString(blockNumberRaw));

      // 2. Header 조회 (캐시 우선)
      let header = this.headerCache.get(hash);
      if (!header) {
        const headerKey = `h${blockNumber}${hash}`;
        const headerData = await this.db.get(headerKey, { valueEncoding: 'buffer' });

        if (!headerData) {
          return null;
        }

        // Header는 Binary로 저장됨
        header = this.deserializeHeader(headerData as Buffer);
        this.headerCache.set(hash, header);
      }

      // 3. Body 조회 (디스크)
      const bodyKey = `b${blockNumber}${hash}`;
      const bodyData = await this.db.get(bodyKey, { valueEncoding: 'buffer' });

      if (!bodyData) {
        return null;
      }

      // Body는 Binary로 저장됨
      const body = this.deserializeBody(bodyData as Buffer);

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
      const latestHashRaw = await this.db.get('LastBlock');

      if (!latestHashRaw) {
        return null;
      }

      // lookup key는 string
      const latestHash = this.ensureString(latestHashRaw);
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

  /**
   * 모든 블록 삭제 (테스트용)
   */
  async clear(): Promise<void> {
    await this.db.clear();
    this.headerCache.clear();
    this.logger.log('All blocks cleared');
  }

  // ========== 직렬화/역직렬화 ==========

  /**
   * Header 직렬화 (RLP) - Geth 방식
   * 
   * Binary로 저장 (Hex String 변환 없음)
   */
  private serializeHeader(header: BlockHeader): Buffer {
    const headerArray = [
      header.number.toString(),
      header.hash,
      header.parentHash,
      header.timestamp.toString(),
      header.proposer,
      header.stateRoot,
      header.transactionsRoot,
      header.receiptsRoot,
      header.transactionCount.toString(),
    ];

    const rlpEncoded = this.cryptoService.rlpEncode(headerArray);
    return Buffer.from(rlpEncoded); // ✅ Binary 그대로 반환
  }

  /**
   * Header 역직렬화 (RLP) - Geth 방식
   */
  private deserializeHeader(serializedData: Buffer): BlockHeader {
    try {
      // Binary 그대로 디코딩 (Hex 변환 없음)
      const decoded = this.cryptoService.rlpDecode(serializedData);

      const [
        number,
        hash,
        parentHash,
        timestamp,
        proposer,
        stateRoot,
        transactionsRoot,
        receiptsRoot,
        transactionCount,
      ] = decoded as any[];

      return {
        number: parseInt(number.toString()),
        hash: this.ensureHexString(hash),
        parentHash: this.ensureHexString(parentHash),
        timestamp: parseInt(timestamp.toString()),
        proposer: this.ensureHexString(proposer),
        stateRoot: this.ensureHexString(stateRoot),
        transactionsRoot: this.ensureHexString(transactionsRoot),
        receiptsRoot: this.ensureHexString(receiptsRoot),
        transactionCount: parseInt(transactionCount.toString()),
      };
    } catch (error: any) {
      this.logger.error('Failed to deserialize header:', error);
      throw new Error('Invalid header data in database');
    }
  }

  /**
   * Buffer 또는 Uint8Array를 Hex 문자열로 변환
   */
  private ensureHexString(value: any): string {
    if (typeof value === 'string') {
      return value;
    }
    if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
      return this.cryptoService.bytesToHex(value);
    }
    return value.toString();
  }

  /**
   * LevelDB에서 가져온 값을 Buffer로 변환
   * 
   * @param value - LevelDB get 결과 (string | Buffer)
   * @returns Buffer
   */
  private ensureBuffer(value: string | Buffer): Buffer {
    if (Buffer.isBuffer(value)) {
      return value;
    }
    // Hex String → Buffer (Binary 저장된 경우)
    return Buffer.from(value, 'hex');
  }

  /**
   * LevelDB에서 가져온 값을 String으로 변환
   * 
   * @param value - LevelDB get 결과 (string | Buffer)
   * @returns string
   */
  private ensureString(value: string | Buffer): string {
    if (typeof value === 'string') {
      return value;
    }
    // Buffer → String (lookup key인 경우)
    return value.toString('utf8');
  }

  /**
   * Body 직렬화 (RLP) - Geth 방식
   * 
   * Binary로 저장 (Hex String 변환 없음)
   */
  private serializeBody(body: BlockBody): Buffer {
    // 트랜잭션 배열 직렬화
    const txsArray = body.transactions.map((tx) => [
      tx.hash,
      tx.from,
      tx.to,
      tx.value.toString(),
      tx.nonce.toString(),
      tx.timestamp.getTime().toString(), // Date → timestamp (ms)
      tx.v || '',
      tx.r || '',
      tx.s || '',
    ]);

    const rlpEncoded = this.cryptoService.rlpEncode(txsArray);
    return Buffer.from(rlpEncoded); // ✅ Binary 그대로 반환
  }

  /**
   * Body 역직렬화 (RLP) - Geth 방식
   */
  private deserializeBody(serializedData: Buffer): BlockBody {
    try {
      // Binary 그대로 디코딩 (Hex 변환 없음)
      const decoded = this.cryptoService.rlpDecode(serializedData) as any[];

      const transactions = decoded.map((txData: any[]) => {
        const [hash, from, to, value, nonce, timestamp, v, r, s] = txData;

        const signature = {
          v: parseInt(v.toString()) || 0, // ✅ number로 변환
          r: this.ensureHexString(r) || '',
          s: this.ensureHexString(s) || '',
        };
        const tx = new Transaction(
          this.ensureHexString(from), // ✅ Buffer → Hex String
          this.ensureHexString(to), // ✅ Buffer → Hex String
          BigInt(value.toString()),
          parseInt(nonce.toString()),
          signature,
          this.ensureHexString(hash), // ✅ Buffer → Hex String
        );
        tx.timestamp = new Date(parseInt(timestamp.toString()));

        return tx;
      });

      return { transactions };
    } catch (error: any) {
      this.logger.error('Failed to deserialize body:', error);
      throw new Error('Invalid body data in database');
    }
  }

  /**
   * Receipt 저장 (Geth 방식)
   *
   * 키: "r" + txHash → Receipt (RLP)
   *
   * @param receipt - 저장할 Receipt
   */
  async saveReceipt(receipt: TransactionReceipt): Promise<void> {
    if (this.db.status !== 'open') {
      this.logger.warn('Database is not open, skipping receipt save');
      return;
    }

    const key = `r${receipt.transactionHash}`;
    const value = this.serializeReceipt(receipt);

    await this.db.put(key, value, { valueEncoding: 'buffer' });
    this.logger.debug(`Receipt saved: ${receipt.transactionHash}`);
  }

  /**
   * Receipt 조회
   *
   * @param txHash - 트랜잭션 해시
   * @returns Receipt 또는 null
   */
  async findReceipt(txHash: Hash): Promise<TransactionReceipt | null> {
    if (this.db.status !== 'open') {
      return null;
    }

    const key = `r${txHash}`;

    try {
      const value = await this.db.get(key, { valueEncoding: 'buffer' });
      if (!value) {
        return null;
      }

      // Receipt는 Binary로 저장됨
      return this.deserializeReceipt(value as Buffer);
    } catch (error: any) {
      if (error.code === 'LEVEL_NOT_FOUND') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Receipt RLP 직렬화 - Geth 방식
   *
   * 이더리움 Receipt RLP:
   * [status, cumulativeGasUsed, logsBloom, logs]
   *
   * 우리 Receipt RLP (확장):
   * [txHash, txIndex, blockHash, blockNumber, from, to, status, gasUsed, cumulativeGasUsed, contractAddress, logs, logsBloom]
   * 
   * Binary로 저장 (JSON 사용 안 함)
   */
  private serializeReceipt(receipt: TransactionReceipt): Buffer {
    const rlpData = [
      receipt.transactionHash,
      receipt.transactionIndex.toString(),
      receipt.blockHash,
      receipt.blockNumber.toString(),
      receipt.from,
      receipt.to,
      receipt.status.toString(),
      receipt.gasUsed.toString(),
      receipt.cumulativeGasUsed.toString(),
      receipt.contractAddress || '',
      JSON.stringify(receipt.logs), // logs는 복잡한 객체이므로 JSON 유지
      receipt.logsBloom,
    ];

    const rlpEncoded = this.cryptoService.rlpEncode(rlpData);
    return Buffer.from(rlpEncoded); // ✅ Binary 그대로 반환
  }

  /**
   * Receipt RLP 역직렬화 - Geth 방식
   */
  private deserializeReceipt(data: Buffer): TransactionReceipt {
    try {
      // Binary 그대로 디코딩 (JSON 사용 안 함)
      const rlpData = this.cryptoService.rlpDecode(data) as any[];

      const [
        transactionHash,
        transactionIndex,
        blockHash,
        blockNumber,
        from,
        to,
        status,
        gasUsed,
        cumulativeGasUsed,
        contractAddress,
        logs,
        logsBloom,
      ] = rlpData;

      const receipt = new TransactionReceipt(
        this.ensureHexString(transactionHash),
        parseInt(transactionIndex.toString()),
        this.ensureHexString(blockHash),
        parseInt(blockNumber.toString()),
        this.ensureHexString(from),
        this.ensureHexString(to),
        parseInt(status.toString()) as 1 | 0,
        BigInt(gasUsed.toString()),
        BigInt(cumulativeGasUsed.toString()),
      );

      receipt.contractAddress = contractAddress.toString() || null;
      receipt.logs = JSON.parse(logs.toString());
      receipt.logsBloom = this.ensureHexString(logsBloom);

      return receipt;
    } catch (error: any) {
      this.logger.error('Failed to deserialize receipt:', error);
      throw new Error('Invalid receipt data in database');
    }
  }
}
