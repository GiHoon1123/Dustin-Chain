import { Signature } from '../../common/crypto/crypto.types';
import { Address, Hash } from '../../common/types/common.types';

/**
 * Transaction Entity
 *
 * 이더리움 트랜잭션:
 * - EOA(계정)에서 발생하는 상태 변경 요청
 * - 서명으로 인증됨 (개인키 보유 증명)
 * - 블록에 포함되어 실행됨
 *
 * 트랜잭션 생명주기:
 * 1. 생성 & 서명 (클라이언트)
 * 2. 제출 & 검증 (노드)
 * 3. Mempool 대기 (pending)
 * 4. 블록 포함 (confirmed)
 */
export class Transaction {
  /**
   * 트랜잭션 해시 (고유 식별자)
   *
   * 이더리움:
   * - Keccak-256(RLP(tx))
   * - 서명 포함된 전체 트랜잭션을 해시
   *
   * 용도:
   * - 트랜잭션 추적
   * - 중복 방지
   * - 영수증 조회
   */
  hash: Hash;

  /**
   * 발신자 주소
   *
   * 이더리움:
   * - 서명으로부터 복구됨 (ecrecover)
   * - 트랜잭션에 명시적으로 포함 안됨 (서명으로 증명)
   *
   * 우리:
   * - 편의상 포함 (검증 시 서명과 일치하는지 확인)
   */
  from: Address;

  /**
   * 수신자 주소
   *
   * 이더리움:
   * - EOA: 일반 계정 (송금)
   * - Contract: 컨트랙트 호출
   * - null: 컨트랙트 배포
   *
   * 우리:
   * - EOA만 지원 (송금만)
   */
  to: Address;

  /**
   * 송금 금액 (Wei 단위)
   *
   * 이더리움:
   * - 1 ETH = 10^18 Wei
   * - BigInt로 처리
   *
   * 우리:
   * - 1 DSTN = 10^18 Wei
   */
  value: bigint;

  /**
   * Nonce (발신자 계정 기준)
   *
   * 이더리움:
   * - 발신자가 보낸 트랜잭션 순서 번호
   * - 리플레이 공격 방지
   * - 순서 보장
   *
   * 검증:
   * - tx.nonce === account.nonce 이어야 함
   * - 블록 포함 후 account.nonce++
   */
  nonce: number;

  /**
   * ECDSA 서명 (v, r, s)
   *
   * 이더리움:
   * - 개인키 소유 증명
   * - EIP-155 (Replay Attack 방지)
   * - v = chainId * 2 + 35 + {0,1}
   */
  v: number;
  r: string;
  s: string;

  /**
   * 트랜잭션 상태
   *
   * pending: Mempool 대기 중
   * confirmed: 블록에 포함됨
   * failed: 실행 실패
   */
  status: 'pending' | 'confirmed' | 'failed';

  /**
   * 블록 번호 (블록에 포함된 경우)
   */
  blockNumber?: number;

  /**
   * 생성 시간
   */
  timestamp: Date;

  constructor(
    from: Address,
    to: Address,
    value: bigint,
    nonce: number,
    signature: Signature,
    hash: Hash,
  ) {
    this.from = from;
    this.to = to;
    this.value = value;
    this.nonce = nonce;
    this.v = signature.v;
    this.r = signature.r;
    this.s = signature.s;
    this.hash = hash;
    this.status = 'pending';
    this.timestamp = new Date();
  }

  /**
   * 블록에 포함되었음을 표시
   */
  confirm(blockNumber: number): void {
    this.status = 'confirmed';
    this.blockNumber = blockNumber;
  }

  /**
   * 실행 실패 표시
   */
  fail(): void {
    this.status = 'failed';
  }

  /**
   * 서명 객체 반환
   */
  getSignature(): Signature {
    return {
      v: this.v,
      r: this.r,
      s: this.s,
    };
  }

  /**
   * JSON 직렬화
   */
  toJSON() {
    return {
      hash: this.hash,
      from: this.from,
      to: this.to,
      value: this.value.toString(),
      nonce: this.nonce,
      v: this.v,
      r: this.r,
      s: this.s,
      status: this.status,
      blockNumber: this.blockNumber,
      timestamp: this.timestamp.toISOString(),
    };
  }
}
