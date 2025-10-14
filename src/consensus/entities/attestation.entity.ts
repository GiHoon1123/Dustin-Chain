import { Signature } from '../../common/crypto/crypto.types';
import { Address, Hash } from '../../common/types/common.types';

/**
 * Attestation Entity
 *
 * 이더리움 Attestation:
 * - Committee가 블록을 검증한 증명
 * - 각 Validator의 서명 포함
 * - 2/3 이상 모이면 블록 확정
 *
 * Attestation 구성요소:
 * - Slot: 어느 슬롯의 블록인지
 * - Block Hash: 검증하는 블록
 * - Validator: 검증자 주소
 * - Signature: 검증자의 서명
 *
 * 현재 구현:
 * - 서명은 임시 (실제 개인키 없음)
 * - 나중에 실제 서명 추가
 */
export class Attestation {
  /**
   * 슬롯 번호
   *
   * 어느 슬롯의 블록을 검증하는지
   */
  slot: number;

  /**
   * 블록 해시
   *
   * 검증하는 블록의 해시
   */
  blockHash: Hash;

  /**
   * 검증자 주소
   *
   * Attestation을 제출한 Validator
   */
  validator: Address;

  /**
   * 검증자 서명
   *
   * 이더리움:
   * - BLS 서명 사용
   * - 여러 서명을 하나로 집계 가능
   *
   * 우리:
   * - 일단 ECDSA (기존)
   * - 나중에 BLS 고려
   */
  signature: Signature;

  /**
   * 생성 시간
   */
  timestamp: Date;

  constructor(
    slot: number,
    blockHash: Hash,
    validator: Address,
    signature: Signature,
  ) {
    this.slot = slot;
    this.blockHash = blockHash;
    this.validator = validator;
    this.signature = signature;
    this.timestamp = new Date();
  }

  /**
   * JSON 직렬화
   */
  toJSON() {
    return {
      slot: this.slot,
      blockHash: this.blockHash,
      validator: this.validator,
      signature: {
        v: this.signature.v,
        r: this.signature.r,
        s: this.signature.s,
      },
      timestamp: this.timestamp.toISOString(),
    };
  }
}
