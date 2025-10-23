/**
 * 블록체인 전체에서 사용되는 공통 타입 정의
 * 이더리움과 동일한 형식을 따름
 */

/**
 * Address: 이더리움 주소 형식
 *
 * 이더리움에서의 동작:
 * - 공개키를 Keccak-256으로 해싱한 후 마지막 20바이트 (40 hex chars)
 * - "0x" 접두사를 붙여서 총 42자
 *
 * 왜 필요한가:
 * - 계정 식별자로 사용
 * - 트랜잭션의 발신자/수신자 지정
 * - 밸리데이터 식별
 */
export type Address = string; // "0x" + 40 hex characters

/**
 * Hash: 해시값 형식
 *
 * 이더리움에서의 동작:
 * - Keccak-256 해시 결과 (32바이트 = 64 hex chars)
 * - 블록 해시, 트랜잭션 해시, 상태 루트 등에 사용
 *
 * 왜 필요한가:
 * - 데이터 무결성 검증
 * - 블록체인의 체인 구조 (이전 블록 해시 참조)
 * - 데이터 변조 방지
 */
export type Hash = string; // "0x" + 64 hex characters

/**
 * PrivateKey: 개인키
 *
 * 이더리움에서의 동작:
 * - 256비트(32바이트) 무작위 숫자
 * - secp256k1 타원곡선 암호화에 사용
 *
 * 왜 필요한가:
 * - 트랜잭션 서명
 * - 계정 소유권 증명
 * - 절대 노출되어서는 안됨
 */
export type PrivateKey = string; // "0x" + 64 hex characters

/**
 * PublicKey: 공개키
 *
 * 이더리움에서의 동작:
 * - 개인키로부터 secp256k1 곡선 연산으로 생성
 * - 비압축 형식: 64바이트 (128 hex chars), 0x04 접두사 제외
 *
 * 왜 필요한가:
 * - 주소 생성의 중간 단계
 * - 서명 검증
 */
export type PublicKey = string;

/**
 * Wei 단위 (가장 작은 단위)
 *
 * 이더리움에서의 동작:
 * - 1 ETH = 10^18 Wei
 * - 모든 내부 계산은 Wei 단위로 수행
 *
 * 왜 필요한가:
 * - 소수점 연산 오류 방지
 * - 정밀한 금액 표현
 *
 * Dustin-Chain:
 * - 1 DSTN = 10^18 Wei
 */
export type Wei = string; // BigInt를 문자열로 표현

/**
 * HEX 문자열에서 "0x" 접두사 제거
 *
 * 왜 필요한가:
 * - 암호화 라이브러리는 보통 접두사 없는 hex를 받음
 * - 일관된 처리를 위해 정규화 필요
 */
export function stripHexPrefix(hex: string): string {
  return hex.startsWith('0x') ? hex.slice(2) : hex;
}

/**
 * HEX 문자열에 "0x" 접두사 추가
 *
 * 왜 필요한가:
 * - 이더리움 표준은 항상 0x 접두사 사용
 * - API 응답 형식 통일
 */
export function addHexPrefix(hex: string): string {
  return hex.startsWith('0x') ? hex : '0x' + hex;
}

/**
 * HEX 문자열 형식 검증
 *
 * 왜 필요한가:
 * - 잘못된 입력으로 인한 런타임 에러 방지
 * - 디버깅 시간 절약
 *
 * @param value - 검증할 문자열
 * @param byteLength - 예상되는 바이트 길이 (선택, 예: 32 = 64 hex chars)
 */
export function isHexString(value: string, byteLength?: number): boolean {
  // null/undefined 체크
  if (!value || typeof value !== 'string') {
    return false;
  }

  if (!value.match(/^0x[0-9a-fA-F]*$/)) {
    return false;
  }

  const hex = stripHexPrefix(value);

  // 홀수 길이 hex는 무효
  if (hex.length % 2 !== 0) {
    return false;
  }

  // 길이 체크 (byteLength * 2 = hex chars)
  if (byteLength !== undefined && hex.length !== byteLength * 2) {
    return false;
  }

  return true;
}

/**
 * 주소 검증 함수
 *
 * 이더리움에서:
 * - 정확히 20바이트 (40 hex chars)
 * - 0x 접두사 필수
 */
export function isValidAddress(address: string): boolean {
  return isHexString(address, 20);
}

/**
 * 해시 검증 함수
 *
 * Keccak-256 해시:
 * - 정확히 32바이트 (64 hex chars)
 * - 0x 접두사 필수
 */
export function isValidHash(hash: string): boolean {
  return isHexString(hash, 32);
}

/**
 * 개인키 검증 함수
 *
 * secp256k1 개인키:
 * - 정확히 32바이트 (64 hex chars)
 * - 0x 접두사 필수
 * - 0이 아니어야 함
 * - secp256k1 order보다 작아야 함 (라이브러리가 검증)
 */
export function isValidPrivateKey(privateKey: string): boolean {
  if (!isHexString(privateKey, 32)) {
    return false;
  }

  // 0이 아니어야 함
  const hex = stripHexPrefix(privateKey);
  if (hex === '0'.repeat(64)) {
    return false;
  }

  return true;
}
