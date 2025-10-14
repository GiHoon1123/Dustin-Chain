import { Address } from '../../common/types/common.types';

/**
 * Validator Entity
 *
 * 이더리움 Validator:
 * - 블록 제안 (Proposer)
 * - 블록 검증 (Attestation)
 * - 네트워크 보안 유지
 *
 * 현재 구현:
 * - 256개 Genesis Validator (하드코딩)
 * - 스테이킹 없음 (Phase 4)
 * - 단순 등록/활성화만
 *
 * 나중에 추가:
 * - stakedAmount (스테이킹 금액)
 * - totalRewards (누적 보상)
 * - slashingCount (처벌 횟수)
 */
export class Validator {
  /**
   * Validator 주소
   */
  address: Address;

  /**
   * 활성화 상태
   *
   * true: 블록 제안/검증 가능
   * false: 비활성화 (탈퇴 또는 슬래싱)
   */
  isActive: boolean;

  /**
   * 등록 시간
   */
  registeredAt: Date;

  constructor(address: Address) {
    this.address = address;
    this.isActive = true;
    this.registeredAt = new Date();
  }

  /**
   * 활성화
   */
  activate(): void {
    this.isActive = true;
  }

  /**
   * 비활성화
   */
  deactivate(): void {
    this.isActive = false;
  }

  /**
   * JSON 직렬화
   */
  toJSON() {
    return {
      address: this.address,
      isActive: this.isActive,
      registeredAt: this.registeredAt.toISOString(),
    };
  }
}
