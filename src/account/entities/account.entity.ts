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

  constructor(address: Address) {
    this.address = address;
    this.balance = 0n; // bigint 0
    this.nonce = 0;
  }

  /**
   * 계정 정보를 간단한 객체로 변환
   *
   * 용도:
   * - JSON 직렬화
   * - API 응답
   */
  toJSON() {
    return {
      address: this.address,
      balance: this.balance.toString(),
      nonce: this.nonce,
    };
  }
}
