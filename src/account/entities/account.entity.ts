import {
  EMPTY_HASH,
  EMPTY_ROOT,
} from '../../common/constants/blockchain.constants';
import { Address } from '../../common/types/common.types';

/**
 * Account Entity
 *
 * 이더리움에서의 Account:
 * - 블록체인 상태의 기본 단위
 * - 모든 주소는 Account를 가짐 (잔액이 0이어도)
 * - State Trie에 저장됨
 *
 * 두 가지 타입:
 * 1. EOA (Externally Owned Account): 일반 사용자 계정
 * 2. Contract Account: 스마트 컨트랙트 (나중에 구현)
 *
 * 우리 구현:
 * - EOA만 구현 (일반 계정)
 * - POS용 staking 필드 추가
 */
export class Account {
  /**
   * 계정 주소
   *
   * 이더리움:
   * - Keccak-256(publicKey)의 마지막 20바이트
   * - 0x + 40 hex chars
   *
   * 용도:
   * - 계정 식별자
   * - 트랜잭션 발신자/수신자
   * - Primary Key
   */
  address: Address;

  /**
   * 계정 잔액 (Wei 단위)
   *
   * 이더리움:
   * - 1 ETH = 10^18 Wei
   * - bigint로 처리 (JavaScript Number 한계 극복)
   *
   * Dustin-Chain:
   * - 1 DSTN = 10^18 Wei
   *
   * 왜 bigint:
   * - Number.MAX_SAFE_INTEGER = 2^53 - 1
   * - 10^18 Wei는 Number로 표현 불가능
   */
  balance: bigint;

  /**
   * Nonce (Number used Once)
   *
   * 이더리움에서의 동작:
   * - 해당 계정이 보낸 트랜잭션 개수
   * - 0부터 시작, 트랜잭션마다 1씩 증가
   * - 순서 보장 (nonce 5는 4 이후에만 실행)
   *
   * 왜 필요한가:
   * - 리플레이 공격 방지
   * - 트랜잭션 순서 보장
   * - 중복 트랜잭션 방지
   *
   * 예시:
   * - Alice가 처음 트랜잭션 보냄 → nonce: 0
   * - 두 번째 트랜잭션 → nonce: 1
   * - nonce가 맞지 않으면 거부
   */
  nonce: number;

  /**
   * 컨트랙트 스토리지 루트 (MPT root)
   * - EOA는 EMPTY_ROOT
   */
  storageRoot: string;

  /**
   * 컨트랙트 코드 해시 (keccak256(runtime bytecode))
   * - EOA는 EMPTY_HASH
   */
  codeHash: string;

  constructor(address: Address) {
    this.address = address;
    this.balance = 0n; // bigint 0
    this.nonce = 0;
    this.storageRoot = EMPTY_ROOT;
    this.codeHash = EMPTY_HASH;
  }

  /**
   * 잔액 추가
   *
   * 비즈니스 규칙:
   * - 추가 금액은 양수여야 함
   * - 잔액은 항상 0 이상
   *
   * @param amount - 추가할 금액 (Wei)
   * @throws {Error} 금액이 0 이하인 경우
   */
  addBalance(amount: bigint): void {
    if (amount <= 0n) {
      throw new Error('Amount must be positive');
    }
    this.balance += amount;
  }

  /**
   * 잔액 차감
   *
   * 비즈니스 규칙:
   * - 차감 금액은 양수여야 함
   * - 잔액이 부족하면 차감 불가
   * - 잔액은 절대 음수가 될 수 없음
   *
   * @param amount - 차감할 금액 (Wei)
   * @throws {Error} 금액이 0 이하이거나 잔액 부족인 경우
   */
  subtractBalance(amount: bigint): void {
    if (amount <= 0n) {
      throw new Error('Amount must be positive');
    }
    if (this.balance < amount) {
      throw new Error(
        `Insufficient balance. Current: ${this.balance}, Required: ${amount}`,
      );
    }
    this.balance -= amount;
  }

  /**
   * Nonce 증가
   *
   * 비즈니스 규칙:
   * - 트랜잭션 실행 시마다 1씩 증가
   * - 순차적으로 증가 (건너뛰기 불가)
   *
   * 이더리움에서:
   * - 트랜잭션 처리 후 자동 증가
   * - 절대 감소하지 않음
   */
  incrementNonce(): void {
    this.nonce++;
  }

  /**
   * 계정 정보를 간단한 객체로 변환 (Ethereum JSON-RPC 표준)
   *
   * 용도:
   * - JSON 직렬화
   * - API 응답
   *
   * 이더리움 표준:
   * - balance: Hex String
   * - nonce: Hex String
   */
  toJSON() {
    return {
      address: this.address,
      balance: `0x${this.balance.toString(16)}`, // ✅ Hex String
      nonce: `0x${this.nonce.toString(16)}`, // ✅ Hex String
      storageRoot: this.storageRoot,
      codeHash: this.codeHash,
    };
  }
}
