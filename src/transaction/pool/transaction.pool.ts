import { Injectable, Logger } from '@nestjs/common';
import { Address, Hash } from '../../common/types/common.types';
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
 * - pending + queued 구현
 * - In-Memory 저장
 * - 블록 생성 시 여기서 트랜잭션 가져감
 *
 * 나중에 개선:
 * - Gas Price 기반 정렬
 * - 용량 제한 & 자동 제거
 * - 시간 초과 처리
 */
@Injectable()
export class TransactionPool {
  private readonly logger = new Logger(TransactionPool.name);

  /**
   * Pending 트랜잭션 저장소 (즉시 실행 가능)
   *
   * Key: 트랜잭션 해시
   * Value: Transaction 객체
   *
   * 조건:
   * - tx.nonce === account.nonce
   * - 바로 블록에 포함될 수 있음
   */
  private pending: Map<Hash, Transaction> = new Map();

  /**
   * Queued 트랜잭션 저장소 (대기 중)
   *
   * Key: 트랜잭션 해시
   * Value: Transaction 객체
   *
   * 조건:
   * - tx.nonce > account.nonce
   * - 앞선 nonce가 처리되어야 실행 가능
   * - nonce가 증가하면 자동으로 pending으로 전환
   */
  private queued: Map<Hash, Transaction> = new Map();

  /**
   * 트랜잭션 추가
   *
   * 조건:
   * - 중복 체크 (같은 해시, pending + queued 모두 확인)
   * - 검증 완료된 트랜잭션만
   * - accountNonce를 기반으로 pending/queued 구분
   *
   * @param tx - 추가할 트랜잭션
   * @param accountNonce - 계정의 현재 nonce
   * @returns 성공 여부
   */
  add(tx: Transaction, accountNonce: number): boolean {
    // 중복 체크 (pending + queued 모두 확인)
    if (this.pending.has(tx.hash) || this.queued.has(tx.hash)) {
      this.logger.warn(`Transaction already exists: ${tx.hash}`);
      return false;
    }

    // pending vs queued 구분
    if (tx.nonce === accountNonce) {
      // Pending: 즉시 실행 가능
      this.pending.set(tx.hash, tx);
    } else if (tx.nonce > accountNonce) {
      // Queued: 대기 중
      this.queued.set(tx.hash, tx);
    } else {
      // nonce가 너무 작음 (이미 처리된 트랜잭션)
      this.logger.warn(
        `Transaction nonce too old: ${tx.nonce} < ${accountNonce}`,
      );
      return false;
    }

    return true;
  }

  /**
   * 트랜잭션 조회 (pending + queued 모두 확인)
   *
   * @param hash - 트랜잭션 해시
   * @returns Transaction 또는 null
   */
  get(hash: Hash): Transaction | null {
    return this.pending.get(hash) || this.queued.get(hash) || null;
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
   * 모든 Queued 트랜잭션 조회
   *
   * @returns 모든 Queued 트랜잭션 배열
   */
  getQueued(): Transaction[] {
    return Array.from(this.queued.values());
  }

  /**
   * Queued 트랜잭션을 Pending으로 전환
   *
   * 블록에 트랜잭션이 포함되어 nonce가 증가하면,
   * 해당 계정의 queued 트랜잭션 중 실행 가능한 것들을 pending으로 전환
   *
   * @param address - 계정 주소
   * @param newAccountNonce - 증가된 계정 nonce
   */
  promoteQueuedToPending(address: Address, newAccountNonce: number): void {
    const queuedTxs = Array.from(this.queued.values());
    const addressLower = address.toLowerCase();

    for (const tx of queuedTxs) {
      if (
        tx.from.toLowerCase() === addressLower &&
        tx.nonce === newAccountNonce
      ) {
        // Queued → Pending 전환
        this.queued.delete(tx.hash);
        this.pending.set(tx.hash, tx);
        // this.logger.debug(
        //   `Promoted queued tx to pending: ${tx.hash} (nonce: ${tx.nonce})`,
        // );
      }
    }
  }

  /**
   * 트랜잭션 개수 (pending + queued)
   */
  size(): number {
    return this.pending.size + this.queued.size;
  }

  /**
   * Pending 트랜잭션 개수
   */
  pendingSize(): number {
    return this.pending.size;
  }

  /**
   * Queued 트랜잭션 개수
   */
  queuedSize(): number {
    return this.queued.size;
  }

  /**
   * 트랜잭션 제거 (pending + queued 모두 확인)
   *
   * 블록에 포함된 후 호출
   *
   * @param hash - 트랜잭션 해시
   */
  remove(hash: Hash): void {
    if (this.pending.delete(hash)) {
      // this.logger.log(`Transaction removed from pool: ${hash}`);
      return;
    }
    if (this.queued.delete(hash)) {
      // this.logger.log(`Queued transaction removed from pool: ${hash}`);
      return;
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
   * Pool 비우기 (pending + queued 모두)
   *
   * 테스트용
   */
  clear(): void {
    this.pending.clear();
    this.queued.clear();
    // this.logger.log('Transaction pool cleared');
  }

  /**
   * Pool 존재 여부 확인 (pending + queued 모두 확인)
   */
  has(hash: Hash): boolean {
    return this.pending.has(hash) || this.queued.has(hash);
  }

  /**
   * Pool 통계
   *
   * 디버깅용
   */
  getStats() {
    const pendingTxs = this.getPending();
    const queuedTxs = this.getQueued();
    const totalValue =
      pendingTxs.reduce((sum, tx) => sum + tx.value, 0n) +
      queuedTxs.reduce((sum, tx) => sum + tx.value, 0n);

    return {
      pendingCount: this.pending.size,
      queuedCount: this.queued.size,
      totalCount: this.pending.size + this.queued.size,
      totalValue: totalValue.toString(),
      pendingTransactions: pendingTxs.map((tx) => ({
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        value: tx.value.toString(),
        nonce: tx.nonce,
      })),
      queuedTransactions: queuedTxs.map((tx) => ({
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        value: tx.value.toString(),
        nonce: tx.nonce,
      })),
    };
  }
}
