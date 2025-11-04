import { Injectable, Logger } from '@nestjs/common';
import { Hash } from '../../common/types/common.types';
import { Transaction } from '../entities/transaction.entity';

/**
 * Transaction Pool (Mempool)
 *
 * 이더리움 Mempool:
 * - 아직 블록에 포함되지 않은 트랜잭션 저장소
 * - pending: 즉시 실행 가능
 * - queued: nonce 대기 중
 *
 * 우리 구현:
 * - pending만 구현 (간단 버전)
 * - In-Memory 저장
 * - 블록 생성 시 여기서 트랜잭션 가져감
 *
 * 나중에 개선:
 * - queued 추가
 * - Gas Price 기반 정렬
 * - 용량 제한 & 자동 제거
 * - 시간 초과 처리
 */
@Injectable()
export class TransactionPool {
  private readonly logger = new Logger(TransactionPool.name);

  /**
   * Pending 트랜잭션 저장소
   *
   * Key: 트랜잭션 해시
   * Value: Transaction 객체
   *
   * 이더리움:
   * - Address별, Nonce별로 정리
   * - Gas Price 기준 정렬
   *
   * 우리:
   * - 단순 Map (일단)
   */
  private pending: Map<Hash, Transaction> = new Map();

  /**
   * 트랜잭션 추가
   *
   * 조건:
   * - 중복 체크 (같은 해시)
   * - 검증 완료된 트랜잭션만
   *
   * @param tx - 추가할 트랜잭션
   * @returns 성공 여부
   */
  add(tx: Transaction): boolean {
    // 중복 체크
    if (this.pending.has(tx.hash)) {
      this.logger.warn(`Transaction already exists: ${tx.hash}`);
      return false;
    }

    this.pending.set(tx.hash, tx);
    // this.logger.log(
    //   `Transaction added to pool: ${tx.hash} (${tx.from} -> ${tx.to}, ${tx.value} Wei)`,
    // );

    return true;
  }

  /**
   * 트랜잭션 조회
   *
   * @param hash - 트랜잭션 해시
   * @returns Transaction 또는 null
   */
  get(hash: Hash): Transaction | null {
    return this.pending.get(hash) || null;
  }

  /**
   * 모든 Pending 트랜잭션 조회
   *
   * 블록 생성 시 사용
   *
   * @returns 모든 Pending 트랜잭션 배열
   */
  getPending(): Transaction[] {
    return Array.from(this.pending.values());
  }

  /**
   * 트랜잭션 개수
   */
  size(): number {
    return this.pending.size;
  }

  /**
   * 트랜잭션 제거
   *
   * 블록에 포함된 후 호출
   *
   * @param hash - 트랜잭션 해시
   */
  remove(hash: Hash): void {
    if (this.pending.delete(hash)) {
      // this.logger.log(`Transaction removed from pool: ${hash}`);
    }
  }

  /**
   * 여러 트랜잭션 제거
   *
   * 블록 생성 후 일괄 제거
   *
   * @param hashes - 트랜잭션 해시 배열
   */
  removeMany(hashes: Hash[]): void {
    for (const hash of hashes) {
      this.remove(hash);
    }
  }

  /**
   * Pool 비우기
   *
   * 테스트용
   */
  clear(): void {
    this.pending.clear();
    // this.logger.log('Transaction pool cleared');
  }

  /**
   * Pool 존재 여부 확인
   */
  has(hash: Hash): boolean {
    return this.pending.has(hash);
  }

  /**
   * Pool 통계
   *
   * 디버깅용
   */
  getStats() {
    const transactions = this.getPending();
    const totalValue = transactions.reduce((sum, tx) => sum + tx.value, 0n);

    return {
      pendingCount: this.pending.size,
      totalValue: totalValue.toString(),
      transactions: transactions.map((tx) => ({
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        value: tx.value.toString(),
        nonce: tx.nonce,
      })),
    };
  }
}
