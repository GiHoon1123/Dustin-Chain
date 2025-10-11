/**
 * 암호화 관련 타입 정의
 */

/**
 * Signature: ECDSA 서명 결과
 *
 * 이더리움에서의 동작:
 * - ECDSA(Elliptic Curve Digital Signature Algorithm) 사용
 * - secp256k1 곡선 사용 (비트코인과 동일)
 *
 * 구성:
 * - r: 서명의 첫 번째 부분 (32 bytes = 64 hex chars)
 * - s: 서명의 두 번째 부분 (32 bytes = 64 hex chars)
 * - v: 복구 식별자
 *   - 레거시: 27 or 28
 *   - EIP-155: chainId * 2 + 35 + recoveryId
 *
 * 왜 필요한가:
 * - 트랜잭션 소유권 증명
 * - 서명으로부터 공개키/주소 복구 가능 (v 값 사용)
 * - 트랜잭션 위조 방지
 * - 리플레이 공격 방지 (EIP-155)
 */
export interface Signature {
  v: number;
  r: string;
  s: string;
}

/**
 * KeyPair: 공개키-개인키 쌍
 *
 * 이더리움에서의 동작:
 * - 지갑 생성 시 동시에 생성
 * - 개인키는 안전하게 보관, 공개키는 공개 가능
 */
export interface KeyPair {
  privateKey: string;
  publicKey: string;
  address: string;
}
