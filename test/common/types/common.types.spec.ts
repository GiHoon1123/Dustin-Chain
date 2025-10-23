import {
  addHexPrefix,
  isHexString,
  isValidAddress,
  isValidHash,
  isValidPrivateKey,
  stripHexPrefix,
} from '../../../src/common/types/common.types';

/**
 * common.types.ts 유틸리티 함수 테스트
 *
 * 목표:
 * - 모든 유틸리티 함수를 100% 커버
 * - 정상 케이스와 엣지 케이스 모두 테스트
 * - 이더리움 표준 준수 확인
 */
describe('common.types utilities', () => {
  /**
   * stripHexPrefix 함수 테스트
   */
  describe('stripHexPrefix', () => {
    it('should remove 0x prefix from hex string', () => {
      expect(stripHexPrefix('0x1234')).toBe('1234');
      expect(stripHexPrefix('0xabcdef')).toBe('abcdef');
    });

    it('should return same string if no 0x prefix', () => {
      expect(stripHexPrefix('1234')).toBe('1234');
      expect(stripHexPrefix('abcdef')).toBe('abcdef');
    });

    it('should handle empty string', () => {
      expect(stripHexPrefix('')).toBe('');
    });

    it('should handle 0x only', () => {
      expect(stripHexPrefix('0x')).toBe('');
    });

    it('should be case sensitive for prefix', () => {
      expect(stripHexPrefix('0X1234')).toBe('0X1234'); // 대문자 X는 제거 안됨
    });

    it('should only remove first occurrence', () => {
      expect(stripHexPrefix('0x0x1234')).toBe('0x1234');
    });
  });

  /**
   * addHexPrefix 함수 테스트
   */
  describe('addHexPrefix', () => {
    it('should add 0x prefix to hex string', () => {
      expect(addHexPrefix('1234')).toBe('0x1234');
      expect(addHexPrefix('abcdef')).toBe('0xabcdef');
    });

    it('should not add duplicate prefix', () => {
      expect(addHexPrefix('0x1234')).toBe('0x1234');
      expect(addHexPrefix('0xabcdef')).toBe('0xabcdef');
    });

    it('should handle empty string', () => {
      expect(addHexPrefix('')).toBe('0x');
    });

    it('should be idempotent', () => {
      const hex = '1234';
      const once = addHexPrefix(hex);
      const twice = addHexPrefix(once);
      expect(once).toBe(twice);
    });
  });

  /**
   * stripHexPrefix + addHexPrefix 조합 테스트
   */
  describe('stripHexPrefix + addHexPrefix', () => {
    it('should be reversible', () => {
      const original = '0x1234abcd';
      const stripped = stripHexPrefix(original);
      const restored = addHexPrefix(stripped);
      expect(restored).toBe(original);
    });

    it('should normalize hex strings', () => {
      expect(addHexPrefix(stripHexPrefix('1234'))).toBe('0x1234');
      expect(addHexPrefix(stripHexPrefix('0x1234'))).toBe('0x1234');
    });
  });

  /**
   * isHexString 함수 테스트
   */
  describe('isHexString', () => {
    describe('valid hex strings', () => {
      it('should accept valid hex with 0x prefix', () => {
        expect(isHexString('0x1234')).toBe(true);
        expect(isHexString('0xabcdef')).toBe(true);
        expect(isHexString('0xABCDEF')).toBe(true);
        expect(isHexString('0x0123456789abcdef')).toBe(true);
      });

      it('should accept empty hex (0x)', () => {
        expect(isHexString('0x')).toBe(true);
      });

      it('should accept mixed case', () => {
        expect(isHexString('0xAbCdEf')).toBe(true);
      });
    });

    describe('invalid hex strings', () => {
      it('should reject hex without 0x prefix', () => {
        expect(isHexString('1234')).toBe(false);
        expect(isHexString('abcdef')).toBe(false);
      });

      it('should reject non-hex characters', () => {
        expect(isHexString('0x123g')).toBe(false);
        expect(isHexString('0xhello')).toBe(false);
        expect(isHexString('0x12 34')).toBe(false);
      });

      it('should reject odd-length hex (invalid bytes)', () => {
        expect(isHexString('0x123')).toBe(false);
        expect(isHexString('0xabcde')).toBe(false);
      });

      it('should reject empty string', () => {
        expect(isHexString('')).toBe(false);
      });

      it('should reject null and undefined', () => {
        // @ts-ignore
        expect(isHexString(null)).toBe(false);
        // @ts-ignore
        expect(isHexString(undefined)).toBe(false);
      });
    });

    describe('with byteLength parameter', () => {
      it('should validate exact byte length', () => {
        expect(isHexString('0x1234', 2)).toBe(true); // 2 bytes = 4 hex chars
        expect(isHexString('0x123456', 3)).toBe(true); // 3 bytes = 6 hex chars
      });

      it('should reject wrong byte length', () => {
        expect(isHexString('0x1234', 3)).toBe(false);
        expect(isHexString('0x123456', 2)).toBe(false);
      });

      it('should validate 20 bytes (address)', () => {
        const address = '0x' + '12'.repeat(20); // 40 hex chars
        expect(isHexString(address, 20)).toBe(true);
      });

      it('should validate 32 bytes (hash)', () => {
        const hash = '0x' + '12'.repeat(32); // 64 hex chars
        expect(isHexString(hash, 32)).toBe(true);
      });

      it('should reject when byteLength is 0', () => {
        expect(isHexString('0x', 0)).toBe(true); // 0 bytes = 0 hex chars
        expect(isHexString('0x12', 0)).toBe(false);
      });
    });
  });

  /**
   * isValidAddress 함수 테스트
   */
  describe('isValidAddress', () => {
    describe('valid addresses', () => {
      it('should accept valid 20-byte address', () => {
        const address = '0x' + '1234567890'.repeat(4); // 40 hex chars
        expect(isValidAddress(address)).toBe(true);
      });

      it('should accept all lowercase', () => {
        expect(
          isValidAddress('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'),
        ).toBe(true);
      });

      it('should accept all uppercase', () => {
        expect(
          isValidAddress('0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD'),
        ).toBe(true);
      });

      it('should accept mixed case', () => {
        expect(
          isValidAddress('0xAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCd'),
        ).toBe(true);
      });

      it('should accept zero address', () => {
        expect(isValidAddress('0x' + '0'.repeat(40))).toBe(true);
      });
    });

    describe('invalid addresses', () => {
      it('should reject address without 0x prefix', () => {
        expect(isValidAddress('1234567890'.repeat(4))).toBe(false);
      });

      it('should reject address with wrong length (too short)', () => {
        expect(isValidAddress('0x123456')).toBe(false);
        expect(isValidAddress('0x' + '12'.repeat(19))).toBe(false); // 38 hex chars
      });

      it('should reject address with wrong length (too long)', () => {
        expect(isValidAddress('0x' + '12'.repeat(21))).toBe(false); // 42 hex chars
      });

      it('should reject non-hex characters', () => {
        expect(
          isValidAddress('0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG'),
        ).toBe(false);
        expect(
          isValidAddress('0x123456789012345678901234567890123456789g'),
        ).toBe(false);
      });

      it('should reject empty string', () => {
        expect(isValidAddress('')).toBe(false);
      });

      it('should reject 0x only', () => {
        expect(isValidAddress('0x')).toBe(false);
      });
    });
  });

  /**
   * isValidHash 함수 테스트
   */
  describe('isValidHash', () => {
    describe('valid hashes', () => {
      it('should accept valid 32-byte hash', () => {
        const hash = '0x' + '1234567890abcdef'.repeat(4); // 64 hex chars
        expect(isValidHash(hash)).toBe(true);
      });

      it('should accept all lowercase', () => {
        expect(
          isValidHash(
            '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
          ),
        ).toBe(true);
      });

      it('should accept all uppercase', () => {
        expect(
          isValidHash(
            '0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD',
          ),
        ).toBe(true);
      });

      it('should accept mixed case', () => {
        expect(
          isValidHash(
            '0xAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCd',
          ),
        ).toBe(true);
      });

      it('should accept zero hash', () => {
        expect(isValidHash('0x' + '0'.repeat(64))).toBe(true);
      });
    });

    describe('invalid hashes', () => {
      it('should reject hash without 0x prefix', () => {
        expect(isValidHash('1234567890abcdef'.repeat(4))).toBe(false);
      });

      it('should reject hash with wrong length (too short)', () => {
        expect(isValidHash('0x123456')).toBe(false);
        expect(isValidHash('0x' + '12'.repeat(31))).toBe(false); // 62 hex chars
      });

      it('should reject hash with wrong length (too long)', () => {
        expect(isValidHash('0x' + '12'.repeat(33))).toBe(false); // 66 hex chars
      });

      it('should reject non-hex characters', () => {
        expect(
          isValidHash(
            '0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG',
          ),
        ).toBe(false);
      });

      it('should reject empty string', () => {
        expect(isValidHash('')).toBe(false);
      });

      it('should reject 0x only', () => {
        expect(isValidHash('0x')).toBe(false);
      });
    });
  });

  /**
   * isValidPrivateKey 함수 테스트
   */
  describe('isValidPrivateKey', () => {
    describe('valid private keys', () => {
      it('should accept valid 32-byte private key', () => {
        const privateKey = '0x' + '1234567890abcdef'.repeat(4); // 64 hex chars
        expect(isValidPrivateKey(privateKey)).toBe(true);
      });

      it('should accept all lowercase', () => {
        expect(
          isValidPrivateKey(
            '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
          ),
        ).toBe(true);
      });

      it('should accept all uppercase', () => {
        expect(
          isValidPrivateKey(
            '0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD',
          ),
        ).toBe(true);
      });

      it('should accept non-zero private key', () => {
        expect(
          isValidPrivateKey(
            '0x0000000000000000000000000000000000000000000000000000000000000001',
          ),
        ).toBe(true);
      });
    });

    describe('invalid private keys', () => {
      it('should reject zero private key', () => {
        expect(isValidPrivateKey('0x' + '0'.repeat(64))).toBe(false);
      });

      it('should reject private key without 0x prefix', () => {
        expect(isValidPrivateKey('1234567890abcdef'.repeat(4))).toBe(false);
      });

      it('should reject private key with wrong length (too short)', () => {
        expect(isValidPrivateKey('0x123456')).toBe(false);
        expect(isValidPrivateKey('0x' + '12'.repeat(31))).toBe(false);
      });

      it('should reject private key with wrong length (too long)', () => {
        expect(isValidPrivateKey('0x' + '12'.repeat(33))).toBe(false);
      });

      it('should reject non-hex characters', () => {
        expect(
          isValidPrivateKey(
            '0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG',
          ),
        ).toBe(false);
      });

      it('should reject empty string', () => {
        expect(isValidPrivateKey('')).toBe(false);
      });

      it('should reject 0x only', () => {
        expect(isValidPrivateKey('0x')).toBe(false);
      });

      it('should reject odd-length hex', () => {
        expect(isValidPrivateKey('0x123')).toBe(false);
      });
    });
  });

  /**
   * 타입별 길이 검증
   */
  describe('Type Length Validations', () => {
    it('address should be exactly 20 bytes (40 hex chars)', () => {
      const address = '0x' + '12'.repeat(20);
      expect(isValidAddress(address)).toBe(true);
      expect(address.length).toBe(42); // 0x + 40
    });

    it('hash should be exactly 32 bytes (64 hex chars)', () => {
      const hash = '0x' + '12'.repeat(32);
      expect(isValidHash(hash)).toBe(true);
      expect(hash.length).toBe(66); // 0x + 64
    });

    it('private key should be exactly 32 bytes (64 hex chars)', () => {
      const privateKey = '0x' + '12'.repeat(32);
      expect(isValidPrivateKey(privateKey)).toBe(true);
      expect(privateKey.length).toBe(66); // 0x + 64
    });
  });

  /**
   * 엣지 케이스 및 경계값 테스트
   */
  describe('Edge Cases', () => {
    it('should handle very long strings', () => {
      const veryLong = '0x' + '12'.repeat(1000);
      expect(isHexString(veryLong)).toBe(true);
      expect(isValidAddress(veryLong)).toBe(false);
      expect(isValidHash(veryLong)).toBe(false);
    });

    it('should handle special characters', () => {
      expect(isHexString('0x12!@#$')).toBe(false);
      expect(isValidAddress('0x12!@#$' + '12'.repeat(17))).toBe(false);
    });

    it('should handle whitespace', () => {
      expect(isHexString('0x 1234')).toBe(false);
      expect(isHexString('0x1234 ')).toBe(false);
      expect(isHexString(' 0x1234')).toBe(false);
    });

    it('should handle newlines and tabs', () => {
      expect(isHexString('0x12\n34')).toBe(false);
      expect(isHexString('0x12\t34')).toBe(false);
    });
  });

  /**
   * 실제 이더리움 값 검증
   */
  describe('Real Ethereum Values', () => {
    it('should validate actual Ethereum mainnet addresses', () => {
      // Vitalik's address
      expect(isValidAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBe(
        true,
      );

      // Null address
      expect(isValidAddress('0x0000000000000000000000000000000000000000')).toBe(
        true,
      );
    });

    it('should validate actual Ethereum transaction hashes', () => {
      // Real tx hash format
      expect(
        isValidHash(
          '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        ),
      ).toBe(true);
    });

    it('should validate EMPTY_ROOT and EMPTY_HASH from constants', () => {
      const EMPTY_ROOT =
        '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421';
      const EMPTY_HASH =
        '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470';

      expect(isValidHash(EMPTY_ROOT)).toBe(true);
      expect(isValidHash(EMPTY_HASH)).toBe(true);
    });
  });

  /**
   * 성능 테스트 (대량 검증)
   */
  describe('Performance', () => {
    it('should validate 1000 addresses quickly', () => {
      const addresses = Array(1000)
        .fill(0)
        .map((_, i) => '0x' + i.toString(16).padStart(40, '0'));

      const start = Date.now();
      addresses.forEach((addr) => isValidAddress(addr));
      const end = Date.now();

      expect(end - start).toBeLessThan(100); // Should complete in < 100ms
    });
  });
});
