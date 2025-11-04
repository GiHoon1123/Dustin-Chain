import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AccountService } from '../account/account.service';
import { CHAIN_ID } from '../common/constants/blockchain.constants';
import { CryptoService } from '../common/crypto/crypto.service';
import { Signature } from '../common/crypto/crypto.types';
import { Address, Hash } from '../common/types/common.types';
import { BlockLevelDBRepository } from '../storage/repositories/block-leveldb.repository';
import { IBlockRepository } from '../storage/repositories/block.repository.interface';
import { TransactionReceipt } from './entities/transaction-receipt.entity';
import { Transaction } from './entities/transaction.entity';
import { TransactionPool } from './pool/transaction.pool';

const DEFAULT_GAS_PRICE = BigInt('1000000000'); // 1 Gwei 기본 가스 가격
const DEFAULT_GAS_LIMIT = BigInt(21000); // 단순 송금 기본 가스 한도

/**
 * Transaction Service
 *
 * 역할:
 * - 트랜잭션 서명 생성 (테스트용)
 * - 트랜잭션 검증 (Pool 진입 전)
 * - 트랜잭션 제출 (Pool 추가)
 * - 트랜잭션 조회
 *
 * 검증 단계:
 * 1. 서명 검증 (발신자 확인)
 * 2. Nonce 검증 (계정 nonce와 일치)
 * 3. 잔액 검증 (잔액 충분)
 */
@Injectable()
export class TransactionService {
  private readonly logger = new Logger(TransactionService.name);

  constructor(
    private readonly cryptoService: CryptoService,
    private readonly accountService: AccountService,
    private readonly txPool: TransactionPool,
    @Inject(IBlockRepository)
    private readonly blockRepository: IBlockRepository,
  ) {}

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
   * 트랜잭션 서명 생성 (테스트용)
   *
   * ⚠️ 주의:
   * - 실제 프로덕션 금지
   * - 개인키를 서버로 보내면 안됨
   * - 오직 개발/테스트용
   *
   * 실제:
   * - web3.js가 클라이언트에서 서명
   * - 서명된 트랜잭션만 서버로 전송
   *
   * @param privateKey - 개인키
   * @param to - 수신자
   * @param value - 금액 (Wei)
   * @returns 서명된 트랜잭션
   */
  async signTransaction(
    privateKey: string,
    to: Address | null,
    value: bigint,
    options?: {
      data?: string;
      gasPrice?: bigint;
      gasLimit?: bigint;
    },
  ): Promise<Transaction> {
    // 1. 발신자 주소 도출
    const from = this.cryptoService.privateKeyToAddress(privateKey);

    // 2. nonce 조회 (이더리움 표준: 서버가 현재 nonce를 사용)
    const nonce = await this.accountService.getNonce(from);

    const gasPrice = options?.gasPrice ?? DEFAULT_GAS_PRICE;
    const gasLimit = options?.gasLimit ?? DEFAULT_GAS_LIMIT;
    const data = this.normalizeData(options?.data);

    // 3. 트랜잭션을 RLP로 직렬화하여 해시 계산 (이더리움 표준)
    // 서명 대상: RLP([nonce, gasPrice, gasLimit, to, value, data, chainId, 0, 0])
    const toBytes = to ? this.cryptoService.hexToBytes(to) : new Uint8Array(0);
    const toBuffer = Buffer.from(toBytes);
    const dataBytes = this.cryptoService.hexToBytes(data || '0x');
    const dataBuffer = Buffer.from(dataBytes);

    // RLP 배열 구성 (서명 대상 - chainId 포함, r=0, s=0)
    const signArray = [
      this.toRlpBuffer(BigInt(nonce)),
      this.toRlpBuffer(gasPrice),
      this.toRlpBuffer(gasLimit),
      toBuffer,
      this.toRlpBuffer(value),
      dataBuffer,
      this.toRlpBuffer(BigInt(CHAIN_ID)),
      Buffer.alloc(0), // r = 0
      Buffer.alloc(0), // s = 0
    ];

    const signRlp = this.cryptoService.rlpEncode(signArray);
    const txHash = this.cryptoService.hashBuffer(Buffer.from(signRlp));

    // 4. EIP-155 서명
    const signature = this.cryptoService.signTransaction(
      txHash, // hashBuffer는 이미 Hash (string) 반환
      privateKey,
      CHAIN_ID,
    );

    // 5. 최종 트랜잭션 해시 (서명 포함)
    // RLP([nonce, gasPrice, gasLimit, to, value, data, v, r, s])
    const rValue = Buffer.from(this.cryptoService.hexToBytes(signature.r));
    const sValue = Buffer.from(this.cryptoService.hexToBytes(signature.s));

    const finalArray = [
      this.toRlpBuffer(BigInt(nonce)),
      this.toRlpBuffer(gasPrice),
      this.toRlpBuffer(gasLimit),
      toBuffer,
      this.toRlpBuffer(value),
      dataBuffer,
      this.toRlpBuffer(BigInt(signature.v)),
      rValue,
      sValue,
    ];

    const finalRlp = this.cryptoService.rlpEncode(finalArray);
    const finalHash = this.cryptoService.hashBuffer(Buffer.from(finalRlp)); // hashBuffer는 이미 Hash (string) 반환

    // 6. Transaction 객체 생성
    const tx = new Transaction(
      from,
      to,
      value,
      nonce,
      signature,
      finalHash,
      data,
      gasPrice,
      gasLimit,
    );

    // this.logger.debug(
    //   `Transaction signed: ${finalHash} (${from} -> ${to}, ${value} Wei, nonce: ${nonce})`,
    // );

    return tx;
  }

  /**
   * 서명 검증
   *
   * ECDSA 서명 복구하여 발신자 주소 확인
   *
   * @param tx - 검증할 트랜잭션
   * @returns 검증 성공 여부
   * @throws {Error} 서명 불일치
   */
  verifySignature(tx: Transaction): boolean {
    const normalizedData = this.normalizeData(tx.data);
    if (normalizedData !== tx.data) {
      tx.data = normalizedData;
    }

    // 트랜잭션 해시 재계산 (서명 제외) - RLP 기반
    // 서명 대상: RLP([nonce, gasPrice, gasLimit, to, value, data, chainId, 0, 0])
    const toBytes = tx.to
      ? this.cryptoService.hexToBytes(tx.to)
      : new Uint8Array(0);
    const toBuffer = Buffer.from(toBytes);
    const dataBytes = this.cryptoService.hexToBytes(normalizedData || '0x');
    const dataBuffer = Buffer.from(dataBytes);

    const signArray = [
      this.toRlpBuffer(BigInt(tx.nonce)),
      this.toRlpBuffer(tx.gasPrice),
      this.toRlpBuffer(tx.gasLimit),
      toBuffer,
      this.toRlpBuffer(tx.value),
      dataBuffer,
      this.toRlpBuffer(BigInt(CHAIN_ID)),
      Buffer.alloc(0), // r = 0
      Buffer.alloc(0), // s = 0
    ];

    const signRlp = this.cryptoService.rlpEncode(signArray);
    const txHash = this.cryptoService.hashBuffer(Buffer.from(signRlp));

    // 서명으로부터 주소 복구
    const recoveredAddress = this.cryptoService.recoverAddress(
      txHash, // hashBuffer는 이미 Hash (string) 반환
      tx.getSignature(),
    );

    // 복구된 주소와 from 주소 일치 확인
    const isValid = recoveredAddress.toLowerCase() === tx.from.toLowerCase();

    if (!isValid) {
      throw new Error(
        `Invalid signature: expected ${tx.from}, recovered ${recoveredAddress}`,
      );
    }

    return true;
  }

  /**
   * Nonce 검증
   *
   * 이더리움 표준:
   * - nonce는 계정의 현재 nonce와 정확히 일치해야 함
   * - Pool에 이미 같은 nonce의 트랜잭션이 있으면 거부 (중복 방지)
   * - nonce는 트랜잭션이 블록에 포함되어 실행될 때만 증가
   * - Pool에 있는 트랜잭션은 아직 실행되지 않았으므로 nonce는 증가하지 않음
   *
   * 예시:
   * - accountNonce = 0
   * - 첫 번째 트랜잭션 (nonce: 0) Pool 추가 → accountNonce는 여전히 0
   * - 두 번째 트랜잭션 시도:
   *   - nonce: 0 사용 → Pool에 이미 nonce 0이 있으면 거부
   *   - nonce: 1 사용 → accountNonce는 0이므로 거부 (queued는 현재 미지원)
   *
   * @param tx - 검증할 트랜잭션
   * @throws {Error} Nonce 불일치 또는 중복
   */
  async validateNonce(tx: Transaction): Promise<void> {
    const accountNonce = await this.accountService.getNonce(tx.from);

    // 1. 계정의 현재 nonce와 일치하는지 확인
    if (tx.nonce !== accountNonce) {
      throw new Error(
        `Invalid nonce: expected ${accountNonce}, got ${tx.nonce}`,
      );
    }

    // 2. Pool에 이미 같은 nonce의 트랜잭션이 있는지 확인 (중복 방지)
    const pendingTxs = this.txPool.getPending();
    const duplicateTx = pendingTxs.find(
      (pendingTx) =>
        pendingTx.from.toLowerCase() === tx.from.toLowerCase() &&
        pendingTx.nonce === tx.nonce,
    );

    if (duplicateTx) {
      throw new Error(
        `Duplicate nonce: transaction with nonce ${tx.nonce} already exists in pool (hash: ${duplicateTx.hash})`,
      );
    }

    // this.logger.debug(`Nonce validated for ${tx.hash}: ${tx.nonce}`);
  }

  /**
   * 잔액 검증
   *
   * 발신자가 충분한 잔액을 보유하고 있는지 확인
   *
   * @param tx - 검증할 트랜잭션
   * @throws {Error} 잔액 부족
   */
  async validateBalance(tx: Transaction): Promise<void> {
    const balance = await this.accountService.getBalance(tx.from);

    const required = tx.value + tx.gasPrice * tx.gasLimit;

    if (balance < required) {
      throw new Error(
        `Insufficient balance: ${balance} Wei, required: ${required} Wei (value + gas fee)`,
      );
    }

    // this.logger.debug(
    //   `Balance validated for ${tx.hash}: ${balance} >= ${required}`,
    // );
  }

  /**
   * 가스 필드 검증
   *
   * - gasPrice/gasLimit은 0보다 커야 함
   * - data 필드는 Hex 문자열이어야 함
   */
  validateGasParameters(tx: Transaction): void {
    if (tx.gasPrice <= BigInt(0)) {
      throw new Error('Gas price must be greater than zero');
    }

    if (tx.gasLimit <= BigInt(0)) {
      throw new Error('Gas limit must be greater than zero');
    }

    // data 형식 검증 및 정규화 (서명 검증과 동일한 형식 유지)
    const normalizedData = this.normalizeData(tx.data);
    if (normalizedData !== tx.data) {
      tx.data = normalizedData;
    }

    // this.logger.debug(
    //   `Gas parameters validated for ${tx.hash}: price=${tx.gasPrice}, limit=${tx.gasLimit}`,
    // );
  }

  /**
   * 트랜잭션 전체 검증 (Pool 진입 전)
   *
   * 1. 서명 검증
   * 2. Nonce 검증
   * 3. 잔액 검증
   *
   * @param tx - 검증할 트랜잭션
   * @throws {Error} 검증 실패
   */
  async validateTransaction(tx: Transaction): Promise<void> {
    // 1. 서명 검증
    this.verifySignature(tx);

    // 2. Nonce 검증
    await this.validateNonce(tx);

    // 3. 가스 파라미터 검증
    this.validateGasParameters(tx);

    // 4. 잔액 검증 (전송 금액 + 가스 비용)
    await this.validateBalance(tx);

    // this.logger.log(`Transaction validated: ${tx.hash}`);
  }

  /**
   * 트랜잭션 제출 (Pool 추가)
   *
   * 1. 검증
   * 2. Pool 추가
   *
   * @param from - 발신자
   * @param to - 수신자
   * @param value - 금액
   * @param nonce - 논스
   * @param signature - 서명
   * @returns 생성된 트랜잭션
   */
  async submitTransaction(
    from: Address,
    to: Address | null,
    value: bigint,
    nonce: number,
    signature: Signature,
    options?: {
      gasPrice?: bigint;
      gasLimit?: bigint;
      data?: string;
    },
  ): Promise<Transaction> {
    const gasPrice = options?.gasPrice ?? DEFAULT_GAS_PRICE;
    const gasLimit = options?.gasLimit ?? DEFAULT_GAS_LIMIT;
    const data = this.normalizeData(options?.data);

    // 1. 트랜잭션 해시 계산 - RLP 기반
    // 최종 해시: RLP([nonce, gasPrice, gasLimit, to, value, data, v, r, s])
    const toBytes = to ? this.cryptoService.hexToBytes(to) : new Uint8Array(0);
    const toBuffer = Buffer.from(toBytes);
    const dataBytes = this.cryptoService.hexToBytes(data || '0x');
    const dataBuffer = Buffer.from(dataBytes);
    const rValue = Buffer.from(this.cryptoService.hexToBytes(signature.r));
    const sValue = Buffer.from(this.cryptoService.hexToBytes(signature.s));

    const finalArray = [
      this.toRlpBuffer(BigInt(nonce)),
      this.toRlpBuffer(gasPrice),
      this.toRlpBuffer(gasLimit),
      toBuffer,
      this.toRlpBuffer(value),
      dataBuffer,
      this.toRlpBuffer(BigInt(signature.v)),
      rValue,
      sValue,
    ];

    const finalRlp = this.cryptoService.rlpEncode(finalArray);
    const finalHash = this.cryptoService.hashBuffer(Buffer.from(finalRlp)); // hashBuffer는 이미 Hash (string) 반환

    // 3. Transaction 객체 생성
    const tx = new Transaction(
      from,
      to,
      value,
      nonce,
      signature,
      finalHash,
      data,
      gasPrice,
      gasLimit,
    );

    // 4. 검증
    await this.validateTransaction(tx);

    // 5. Pool 추가
    const added = this.txPool.add(tx);
    if (!added) {
      throw new Error('Transaction already exists in pool');
    }

    // this.logger.log(
    //   `Transaction submitted: ${finalHash} (${from} -> ${to}, ${value} Wei)`,
    // );

    return tx;
  }

  /**
   * 트랜잭션 조회 (Geth 방식)
   *
   * 이더리움 방식:
   * 1. txPool에서 찾기 (pending)
   * 2. 없으면 txLookup 인덱스에서 블록 정보 찾기
   * 3. 해당 블록에서 트랜잭션 추출
   * 4. 블록 정보 추가하여 반환
   *
   * @param hash - 트랜잭션 해시
   * @returns 트랜잭션 (blockHash, blockNumber, txIndex 포함)
   * @throws {NotFoundException} 트랜잭션 없음
   */
  async getTransaction(hash: Hash): Promise<any> {
    // 1. Pool에서 찾기 (pending 트랜잭션)
    const poolTx = this.txPool.get(hash);
    if (poolTx) {
      return poolTx.toJSON();
    }

    // 2. txLookup 인덱스에서 블록 정보 찾기
    const levelDbRepo = this.blockRepository as BlockLevelDBRepository;
    const lookup = await levelDbRepo.findTxLookup(hash);

    if (!lookup) {
      throw new NotFoundException(`Transaction not found: ${hash}`);
    }

    // 3. 해당 블록에서 트랜잭션 추출
    const block = await this.blockRepository.findByHash(lookup.blockHash);
    if (!block) {
      throw new NotFoundException(
        `Block not found for transaction: ${lookup.blockHash}`,
      );
    }

    const tx = block.transactions[lookup.txIndex];
    if (!tx) {
      throw new NotFoundException(`Transaction not found in block: ${hash}`);
    }

    // 4. 블록 정보 추가하여 반환 (이더리움 JSON-RPC 표준)
    const { status, ...txJson } = tx.toJSON();
    // status 필드 제거 (이더리움 표준에는 없음)

    return {
      ...txJson,
      blockHash: lookup.blockHash,
      blockNumber: `0x${lookup.blockNumber.toString(16)}`,
      transactionIndex: `0x${lookup.txIndex.toString(16)}`,
    };
  }

  /**
   * 모든 Pending 트랜잭션 조회
   *
   * @returns Pending 트랜잭션 배열
   */
  getPendingTransactions(): Transaction[] {
    return this.txPool.getPending();
  }

  /**
   * Pool 통계
   */
  getPoolStats() {
    return this.txPool.getStats();
  }

  /**
   * Receipt 조회
   *
   * @param hash - 트랜잭션 해시
   * @returns Receipt 또는 null
   */
  async getReceipt(hash: Hash): Promise<TransactionReceipt | null> {
    const levelDbRepo = this.blockRepository as BlockLevelDBRepository;
    const receipt = await levelDbRepo.findReceipt(hash);

    if (!receipt) {
      // this.logger.debug(`Receipt not found: ${hash}`);
      return null;
    }

    return receipt;
  }

  /**
   * data 필드를 이더리움 표준 형태(0x 접두사, Hex)로 정규화
   */
  private normalizeData(data?: string | null): string {
    if (!data || data === '0x' || data === '0X') {
      return '0x';
    }

    const trimmed = data.trim();

    if (trimmed.length === 0) {
      return '0x';
    }

    if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) {
      if (!/^0x[0-9a-fA-F]*$/.test(trimmed)) {
        throw new Error('Transaction data must be a valid hex string');
      }
      return `0x${trimmed.slice(2).toLowerCase()}`;
    }

    if (!/^[0-9a-fA-F]*$/.test(trimmed)) {
      throw new Error('Transaction data must be a valid hex string');
    }

    return `0x${trimmed.toLowerCase()}`;
  }
}
