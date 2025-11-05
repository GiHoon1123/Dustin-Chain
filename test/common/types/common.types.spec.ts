import {
  addHexPrefix,
  isValidAddress,
  isValidHash,
  isValidPrivateKey,
  isHexString,
  stripHexPrefix,
} from '../../../src/common/types/common.types';

/**
 * Common Types 유틸리티 함수 테스트
 *
 * 테스트 범위:
 * - Hex 접두사 추가/제거
 * - Hex 문자열 검증
 * - 주소 검증
 * - 해시 검증
 * - 개인키 검증
 */
describe('Common Types Utilities', () => {
  describe('addHexPrefix', () => {
    it('0x 접두사를 추가해야 함', () => {
      expect(addHexPrefix('abc')).toBe('0xabc');
    });

    it('이미 0x가 있으면 그대로 반환해야 함', () => {
      expect(addHexPrefix('0xabc')).toBe('0xabc');
    });

    it('빈 문자열에 접두사를 추가해야 함', () => {
      expect(addHexPrefix('')).toBe('0x');
    });
  });

  describe('stripHexPrefix', () => {
    it('0x 접두사를 제거해야 함', () => {
      expect(stripHexPrefix('0xabc')).toBe('abc');
    });

    it('0x가 없으면 그대로 반환해야 함', () => {
      expect(stripHexPrefix('abc')).toBe('abc');
    });
  });

  describe('isHexString', () => {
    it('유효한 Hex 문자열을 검증해야 함', () => {
      expect(isHexString('0xab')).toBe(true); // 짝수 길이
      expect(isHexString('0x1234567890abcdef')).toBe(true);
    });

    it('0x 없이는 무효해야 함', () => {
      expect(isHexString('abc')).toBe(false);
    });

    it('홀수 길이는 무효해야 함', () => {
      expect(isHexString('0xabc')).toBe(false); // 홀수 (3글자)
      expect(isHexString('0xab')).toBe(true); // 짝수 (2글자)
      expect(isHexString('0xa')).toBe(false); // 홀수 (1글자)
    });

    it('특정 바이트 길이를 검증해야 함', () => {
      expect(isHexString('0x' + 'a'.repeat(40), 20)).toBe(true); // 20 bytes
      expect(isHexString('0x' + 'a'.repeat(64), 32)).toBe(true); // 32 bytes
      expect(isHexString('0x' + 'a'.repeat(40), 32)).toBe(false); // 길이 불일치
    });

    it('잘못된 문자를 거부해야 함', () => {
      expect(isHexString('0xghijkl')).toBe(false); // g는 hex가 아님
    });
  });

  describe('isValidAddress', () => {
    it('유효한 주소를 검증해야 함', () => {
      expect(isValidAddress('0x' + '1'.repeat(40))).toBe(true);
      expect(isValidAddress('0x' + 'a'.repeat(40))).toBe(true);
    });

    it('길이가 잘못된 주소를 거부해야 함', () => {
      expect(isValidAddress('0x' + '1'.repeat(38))).toBe(false); // 너무 짧음
      expect(isValidAddress('0x' + '1'.repeat(42))).toBe(false); // 너무 김
    });

    it('0x 없이는 무효해야 함', () => {
      expect(isValidAddress('1'.repeat(40))).toBe(false);
    });
  });

  describe('isValidHash', () => {
    it('유효한 해시를 검증해야 함', () => {
      expect(isValidHash('0x' + '1'.repeat(64))).toBe(true);
      expect(isValidHash('0x' + 'a'.repeat(64))).toBe(true);
    });

    it('길이가 잘못된 해시를 거부해야 함', () => {
      expect(isValidHash('0x' + '1'.repeat(62))).toBe(false); // 너무 짧음
      expect(isValidHash('0x' + '1'.repeat(66))).toBe(false); // 너무 김
    });

    it('0x 없이는 무효해야 함', () => {
      expect(isValidHash('1'.repeat(64))).toBe(false);
    });
  });

  describe('isValidPrivateKey', () => {
    it('유효한 개인키를 검증해야 함', () => {
      expect(isValidPrivateKey('0x' + '1'.repeat(64))).toBe(true);
      expect(isValidPrivateKey('0x' + 'a'.repeat(64))).toBe(true);
    });

    it('0으로만 된 개인키를 거부해야 함', () => {
      expect(isValidPrivateKey('0x' + '0'.repeat(64))).toBe(false);
    });

    it('길이가 잘못된 개인키를 거부해야 함', () => {
      expect(isValidPrivateKey('0x' + '1'.repeat(62))).toBe(false);
      expect(isValidPrivateKey('0x' + '1'.repeat(66))).toBe(false);
    });

    it('0x 없이는 무효해야 함', () => {
      expect(isValidPrivateKey('1'.repeat(64))).toBe(false);
    });
  });
});

