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
 * - "l" + txHash → Transaction Lookup (RLP: [blockHash, blockNumber, txIndex])
 * - "LastBlock" → latestBlockHash
 */
@Injectable()
export class BlockLevelDBRepository
  implements IBlockRepository, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(BlockLevelDBRepository.name);
  private db: ClassicLevel<string, string | Buffer>; // Binary 저장 (Geth 방식)

  // Header 캐싱 (LRU, 최근 10,000개)
  private headerCache: InstanceType<LRUType>;

  constructor(private readonly cryptoService: CryptoService) {
    // Mixed encoding: lookup keys (string), data values (Buffer)
    this.db = new ClassicLevel<string, string | Buffer>('./data/chaindata');

    // Header 캐시 초기화 (10,000개, 약 2MB)
    this.headerCache = new LRU<Hash, BlockHeader>({
      max: 10000,
      ttl: 1000 * 60 * 60, // 1시간
    });
  }

  async onModuleInit(): Promise<void> {
    await this.db.open();
    // this.logger.log('BlockLevelDB opened: ./data/chaindata');
  }

  async onModuleDestroy(): Promise<void> {
    await this.db.close();
    // this.logger.log('BlockLevelDB closed');
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

      // Batch 생성 (원자적 작업)
      const batch = this.db.batch();

      // 1. Header 저장 (Binary)
      const headerKey = `h${block.number}${block.hash}`;
      batch.put(headerKey, this.serializeHeader(header), {
        valueEncoding: 'buffer',
      });

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

      // 6. Transaction Lookup 인덱스 저장 (Geth 방식)
      for (let i = 0; i < block.transactions.length; i++) {
        const tx = block.transactions[i];
        const lookupKey = `l${tx.hash}`;
        const lookupValue = this.serializeTxLookup(block.hash, block.number, i);
        batch.put(lookupKey, lookupValue, { valueEncoding: 'buffer' });
      }

      // 원자적으로 모두 저장 (모두 성공 or 모두 실패)
      await batch.write();

      // 6. Header 캐싱 (DB 저장 성공 후에만)
      this.headerCache.set(block.hash, header);

      // this.logger.debug(`Block #${block.number} saved: ${block.hash}`);
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
        // this.logger.debug('DB not open yet, returning null');
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
        const headerData = await this.db.get(headerKey, {
          valueEncoding: 'buffer',
        });

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
      return Block.fromHeaderAndBody(header as any, body as any);
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
    // this.logger.log('All blocks cleared');
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
    return Buffer.from(rlpEncoded); // Binary 그대로 반환
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
   *
   * EVM 통합으로 인한 변경:
   * - data, gasPrice, gasLimit 필드 추가
   * - 기존 트랜잭션도 호환되도록 기본값 저장
   */
  private serializeBody(body: BlockBody): Buffer {
    // 트랜잭션 배열 직렬화
    const txsArray = body.transactions.map((tx) => [
      tx.hash,
      tx.from,
      tx.to || '', // null인 경우 빈 문자열로 저장 (컨트랙트 배포)
      tx.value.toString(),
      tx.nonce.toString(),
      tx.timestamp.getTime().toString(), // Date → timestamp (ms)
      tx.v || '',
      tx.r || '',
      tx.s || '',
      tx.data || '', // EVM: 컨트랙트 배포/호출 데이터
      tx.gasPrice?.toString() || '1000000000', // EVM: 가스 가격 (기본값 1 Gwei)
      tx.gasLimit?.toString() || '21000', // EVM: 가스 한도 (기본값 21000)
    ]);

    const rlpEncoded = this.cryptoService.rlpEncode(txsArray);
    return Buffer.from(rlpEncoded); // Binary 그대로 반환
  }

  /**
   * Body 역직렬화 (RLP) - Geth 방식
   *
   * EVM 통합으로 인한 변경:
   * - data, gasPrice, gasLimit 필드 파싱 추가
   * - 기존 데이터 호환성: 필드가 없으면 기본값 사용
   */
  private deserializeBody(serializedData: Buffer): BlockBody {
    try {
      // Binary 그대로 디코딩 (Hex 변환 없음)
      const decoded = this.cryptoService.rlpDecode(serializedData) as any[];

      const transactions = decoded.map((txData: any[]) => {
        // 기존 데이터: [hash, from, to, value, nonce, timestamp, v, r, s]
        // 신규 EVM 데이터: [hash, from, to, value, nonce, timestamp, v, r, s, data, gasPrice, gasLimit]
        const hash = txData[0];
        const from = txData[1];
        const to = txData[2];
        const value = txData[3];
        const nonce = txData[4];
        const timestamp = txData[5];
        const v = txData[6];
        const r = txData[7];
        const s = txData[8];
        // EVM 필드: 기존 데이터와의 호환성을 위해 기본값 제공
        const data = txData[9] || '';
        const gasPrice = txData[10]
          ? BigInt(txData[10].toString())
          : BigInt('1000000000'); // 기본값 1 Gwei
        const gasLimit = txData[11]
          ? BigInt(txData[11].toString())
          : BigInt(21000); // 기본값 21000

        const signature = {
          v: parseInt(v.toString()) || 0, // number로 변환
          r: this.ensureHexString(r) || '',
          s: this.ensureHexString(s) || '',
        };

        // to 필드: 빈 문자열이면 null로 변환 (컨트랙트 배포)
        const toStr = to ? this.ensureHexString(to) : '';
        const toAddress = toStr && toStr.length > 0 ? toStr : null;

        const tx = new Transaction(
          this.ensureHexString(from), // Buffer → Hex String
          toAddress, // null 가능 (컨트랙트 배포)
          BigInt(value.toString()),
          parseInt(nonce.toString()),
          signature,
          this.ensureHexString(hash), // Buffer → Hex String
          data, // EVM: data 필드
          gasPrice, // EVM: gasPrice 필드
          gasLimit, // EVM: gasLimit 필드
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
    // this.logger.debug(`Receipt saved: ${receipt.transactionHash}`);
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
    // contractAddress는 null이면 빈 문자열로 저장 (RLP 인코딩 시)
    const contractAddrForStorage = receipt.contractAddress || '';
    // this.logger.debug(
    //   `Serializing receipt: txHash=${receipt.transactionHash}, contractAddress=${receipt.contractAddress || 'null'}`,
    // );
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
      contractAddrForStorage, // null이면 빈 문자열
      JSON.stringify(receipt.logs), // logs는 복잡한 객체이므로 JSON 유지
      receipt.logsBloom,
    ];

    const rlpEncoded = this.cryptoService.rlpEncode(rlpData);
    return Buffer.from(rlpEncoded); // Binary 그대로 반환
  }

  /**
   * Transaction Lookup 직렬화 (Geth 방식)
   *
   * Geth: RLP([blockHash, blockNumber, txIndex])
   *
   * @param blockHash - 블록 해시
   * @param blockNumber - 블록 번호
   * @param txIndex - 트랜잭션 인덱스
   * @returns RLP 인코딩된 Buffer
   */
  private serializeTxLookup(
    blockHash: Hash,
    blockNumber: number,
    txIndex: number,
  ): Buffer {
    const rlpData = [blockHash, blockNumber.toString(), txIndex.toString()];
    const rlpEncoded = this.cryptoService.rlpEncode(rlpData);
    return Buffer.from(rlpEncoded);
  }

  /**
   * Transaction Lookup 역직렬화 (Geth 방식)
   *
   * @param data - RLP 인코딩된 Buffer
   * @returns {blockHash, blockNumber, txIndex}
   */
  private deserializeTxLookup(data: Buffer): {
    blockHash: Hash;
    blockNumber: number;
    txIndex: number;
  } {
    try {
      const rlpData = this.cryptoService.rlpDecode(data) as any[];
      const [blockHash, blockNumber, txIndex] = rlpData;

      return {
        blockHash: this.ensureHexString(blockHash),
        blockNumber: parseInt(blockNumber.toString()),
        txIndex: parseInt(txIndex.toString()),
      };
    } catch (error: any) {
      this.logger.error('Failed to deserialize tx lookup:', error);
      throw new Error('Invalid tx lookup data in database');
    }
  }

  /**
   * Transaction Lookup 조회 (Geth 방식)
   *
   * txHash로 해당 트랜잭션이 포함된 블록 정보 조회
   *
   * @param txHash - 트랜잭션 해시
   * @returns {blockHash, blockNumber, txIndex} 또는 null
   */
  async findTxLookup(txHash: Hash): Promise<{
    blockHash: Hash;
    blockNumber: number;
    txIndex: number;
  } | null> {
    if (this.db.status !== 'open') {
      return null;
    }

    const key = `l${txHash}`;

    try {
      const value = await this.db.get(key, { valueEncoding: 'buffer' });
      if (!value) {
        return null;
      }

      return this.deserializeTxLookup(value as Buffer);
    } catch (error: any) {
      if (error.code === 'LEVEL_NOT_FOUND') {
        return null;
      }
      throw error;
    }
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

      // contractAddress 처리: RLP 디코딩된 값은 Buffer나 string일 수 있음
      // Buffer인 경우 UTF-8이 아닌 hex로 변환해야 함 (20바이트 주소)
      if (contractAddress) {
        // Buffer나 Uint8Array는 직접 hex로 변환
        if (
          Buffer.isBuffer(contractAddress) ||
          contractAddress instanceof Uint8Array
        ) {
          receipt.contractAddress = this.ensureHexString(contractAddress);
        } else if (typeof contractAddress === 'string') {
          // 이미 문자열인 경우, 0x 접두사 확인
          receipt.contractAddress = contractAddress.startsWith('0x')
            ? contractAddress
            : contractAddress.length > 0
              ? this.ensureHexString(Buffer.from(contractAddress, 'utf8'))
              : null;
        } else {
          // 다른 타입인 경우 toString() 후 처리
          const addrStr = contractAddress.toString();
          receipt.contractAddress =
            addrStr && addrStr.length > 0 && addrStr !== ''
              ? this.ensureHexString(addrStr)
              : null;
        }
        // 빈 문자열이거나 0x0 등은 null로 처리
        if (
          receipt.contractAddress === '' ||
          receipt.contractAddress === '0x' ||
          receipt.contractAddress === '0x0'
        ) {
          receipt.contractAddress = null;
        }
      } else {
        receipt.contractAddress = null;
      }
      receipt.logs = JSON.parse(logs.toString());
      receipt.logsBloom = this.ensureHexString(logsBloom);

      return receipt;
    } catch (error: any) {
      this.logger.error('Failed to deserialize receipt:', error);
      throw new Error('Invalid receipt data in database');
    }
  }
}
