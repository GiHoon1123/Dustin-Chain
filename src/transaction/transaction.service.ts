import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AccountService } from '../account/account.service';
import { CHAIN_ID } from '../common/constants/blockchain.constants';
import { CryptoService } from '../common/crypto/crypto.service';
import { Signature } from '../common/crypto/crypto.types';
import { Address, Hash } from '../common/types/common.types';
import { Transaction } from './entities/transaction.entity';
import { TransactionPool } from './pool/transaction.pool';

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
  ) {}

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
    to: Address,
    value: bigint,
  ): Promise<Transaction> {
    // 1. 발신자 주소 도출
    const from = this.cryptoService.privateKeyToAddress(privateKey);

    // 2. 현재 nonce 조회
    const nonce = await this.accountService.getNonce(from);

    // 3. 트랜잭션 해시 계산 (서명 대상)
    const txData = {
      from,
      to,
      value: value.toString(),
      nonce,
      chainId: CHAIN_ID,
    };
    const txHash = this.cryptoService.hashUtf8(JSON.stringify(txData));

    // 4. EIP-155 서명
    const signature = this.cryptoService.signTransaction(
      txHash,
      privateKey,
      CHAIN_ID,
    );

    // 5. 최종 트랜잭션 해시 (서명 포함)
    const finalData = {
      ...txData,
      v: signature.v,
      r: signature.r,
      s: signature.s,
    };
    const finalHash = this.cryptoService.hashUtf8(JSON.stringify(finalData));

    // 6. Transaction 객체 생성
    const tx = new Transaction(from, to, value, nonce, signature, finalHash);

    this.logger.debug(
      `Transaction signed: ${finalHash} (${from} -> ${to}, ${value} Wei, nonce: ${nonce})`,
    );

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
    // 트랜잭션 해시 재계산 (서명 제외)
    const txData = {
      from: tx.from,
      to: tx.to,
      value: tx.value.toString(),
      nonce: tx.nonce,
      chainId: CHAIN_ID,
    };
    const txHash = this.cryptoService.hashUtf8(JSON.stringify(txData));

    // 서명으로부터 주소 복구
    const recoveredAddress = this.cryptoService.recoverAddress(
      txHash,
      tx.getSignature(),
    );

    // 복구된 주소와 from 주소 일치 확인
    const isValid = recoveredAddress.toLowerCase() === tx.from.toLowerCase();

    if (!isValid) {
      throw new Error(
        `Invalid signature: expected ${tx.from}, recovered ${recoveredAddress}`,
      );
    }

    this.logger.debug(`Signature verified for ${tx.hash}`);
    return true;
  }

  /**
   * Nonce 검증
   *
   * 트랜잭션의 nonce가 계정의 현재 nonce와 일치하는지 확인
   *
   * @param tx - 검증할 트랜잭션
   * @throws {Error} Nonce 불일치
   */
  async validateNonce(tx: Transaction): Promise<void> {
    const accountNonce = await this.accountService.getNonce(tx.from);

    if (tx.nonce !== accountNonce) {
      throw new Error(
        `Invalid nonce: expected ${accountNonce}, got ${tx.nonce}`,
      );
    }

    this.logger.debug(`Nonce validated for ${tx.hash}: ${tx.nonce}`);
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

    if (balance < tx.value) {
      throw new Error(
        `Insufficient balance: ${balance} Wei, required: ${tx.value} Wei`,
      );
    }

    this.logger.debug(
      `Balance validated for ${tx.hash}: ${balance} >= ${tx.value}`,
    );
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

    // 3. 잔액 검증
    await this.validateBalance(tx);

    this.logger.log(`Transaction validated: ${tx.hash}`);
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
    to: Address,
    value: bigint,
    nonce: number,
    signature: Signature,
  ): Promise<Transaction> {
    // 1. 트랜잭션 해시 계산
    const txData = {
      from,
      to,
      value: value.toString(),
      nonce,
      chainId: CHAIN_ID,
    };
    const txHash = this.cryptoService.hashUtf8(JSON.stringify(txData));

    // 2. 최종 해시 (서명 포함)
    const finalData = {
      ...txData,
      v: signature.v,
      r: signature.r,
      s: signature.s,
    };
    const finalHash = this.cryptoService.hashUtf8(JSON.stringify(finalData));

    // 3. Transaction 객체 생성
    const tx = new Transaction(from, to, value, nonce, signature, finalHash);

    // 4. 검증
    await this.validateTransaction(tx);

    // 5. Pool 추가
    const added = this.txPool.add(tx);
    if (!added) {
      throw new Error('Transaction already exists in pool');
    }

    this.logger.log(
      `Transaction submitted: ${finalHash} (${from} -> ${to}, ${value} Wei)`,
    );

    return tx;
  }

  /**
   * 트랜잭션 조회
   *
   * @param hash - 트랜잭션 해시
   * @returns 트랜잭션
   * @throws {NotFoundException} 트랜잭션 없음
   */
  getTransaction(hash: Hash): Transaction {
    const tx = this.txPool.get(hash);

    if (!tx) {
      throw new NotFoundException(`Transaction not found: ${hash}`);
    }

    return tx;
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
}
