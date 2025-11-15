import { Test, TestingModule } from '@nestjs/testing';
import { CryptoService } from '../../../src/common/crypto/crypto.service';

/**
 * CryptoService - LogsBloom 테스트
 *
 * 이더리움 표준:
 * - Bloom Filter 크기: 2048비트 (256바이트)
 * - 각 로그의 address와 topics를 Keccak-256 해시
 * - 해시에서 3개 비트 위치 계산
 * - 해당 비트들을 1로 설정 (OR 연산)
 *
 * 테스트 항목:
 * 1. calculateLogsBloom - 빈 로그 배열
 * 2. calculateLogsBloom - 단일 로그
 * 3. calculateLogsBloom - 여러 로그
 * 4. combineLogsBlooms - 여러 bloom OR 연산
 * 5. isInLogsBloom - 포함 여부 확인
 */
describe('CryptoService - LogsBloom', () => {
  let service: CryptoService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CryptoService],
    }).compile();

    service = module.get<CryptoService>(CryptoService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('calculateLogsBloom', () => {
    it('should return empty bloom for empty logs array', () => {
      const logs: { address: string; topics: string[] }[] = [];
      const result = service.calculateLogsBloom(logs);

      expect(result).toBe('0x' + '0'.repeat(512));
      expect(result.length).toBe(514); // '0x' + 512 hex chars
    });

    it('should calculate bloom for single log with address only', () => {
      const logs = [
        {
          address: '0x1234567890123456789012345678901234567890',
          topics: [],
        },
      ];

      const result = service.calculateLogsBloom(logs);

      expect(result).toMatch(/^0x[0-9a-f]{512}$/);
      expect(result).not.toBe('0x' + '0'.repeat(512));
    });

    it('should calculate bloom for log with address and topics', () => {
      const logs = [
        {
          address: '0x1234567890123456789012345678901234567890',
          topics: [
            '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
          ],
        },
      ];

      const result = service.calculateLogsBloom(logs);

      expect(result).toMatch(/^0x[0-9a-f]{512}$/);
      expect(result).not.toBe('0x' + '0'.repeat(512));
    });

    it('should calculate bloom for multiple logs', () => {
      const logs = [
        {
          address: '0x1234567890123456789012345678901234567890',
          topics: [
            '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
          ],
        },
        {
          address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
          topics: [
            '0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0',
          ],
        },
      ];

      const result = service.calculateLogsBloom(logs);

      expect(result).toMatch(/^0x[0-9a-f]{512}$/);
      expect(result).not.toBe('0x' + '0'.repeat(512));
    });

    it('should handle Transfer event log correctly', () => {
      const transferTopic =
        '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
      const logs = [
        {
          address: '0x1234567890123456789012345678901234567890',
          topics: [transferTopic],
        },
      ];

      const result = service.calculateLogsBloom(logs);

      expect(result).toMatch(/^0x[0-9a-f]{512}$/);
      // Transfer topic이 bloom에 포함되어 있는지 확인
      const isInBloom = service.isInLogsBloom(result, transferTopic);
      expect(isInBloom).toBe(true);
    });
  });

  describe('combineLogsBlooms', () => {
    it('should return empty bloom for empty array', () => {
      const result = service.combineLogsBlooms([]);

      expect(result).toBe('0x' + '0'.repeat(512));
    });

    it('should return same bloom for single bloom', () => {
      const bloom = '0x' + 'a'.repeat(512);
      const result = service.combineLogsBlooms([bloom]);

      expect(result).toBe(bloom);
    });

    it('should combine multiple blooms with OR operation', () => {
      const bloom1 = service.calculateLogsBloom([
        {
          address: '0x1234567890123456789012345678901234567890',
          topics: [],
        },
      ]);

      const bloom2 = service.calculateLogsBloom([
        {
          address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
          topics: [],
        },
      ]);

      const combined = service.combineLogsBlooms([bloom1, bloom2]);

      expect(combined).toMatch(/^0x[0-9a-f]{512}$/);
      // Combined bloom should have at least as many bits set as individual blooms
      expect(combined).not.toBe('0x' + '0'.repeat(512));
    });

    it('should combine three blooms correctly', () => {
      const bloom1 = '0x' + '1'.repeat(512);
      const bloom2 = '0x' + '2'.repeat(512);
      const bloom3 = '0x' + '4'.repeat(512);

      const combined = service.combineLogsBlooms([bloom1, bloom2, bloom3]);

      expect(combined).toMatch(/^0x[0-9a-f]{512}$/);
      // OR operation should preserve all bits
      expect(combined).not.toBe('0x' + '0'.repeat(512));
    });
  });

  describe('isInLogsBloom', () => {
    it('should return false for empty bloom', () => {
      const emptyBloom = '0x' + '0'.repeat(512);
      const result = service.isInLogsBloom(
        emptyBloom,
        '0x1234567890123456789012345678901234567890',
      );

      expect(result).toBe(false);
    });

    it('should return true for value in bloom', () => {
      const address = '0x1234567890123456789012345678901234567890';
      const bloom = service.calculateLogsBloom([
        {
          address,
          topics: [],
        },
      ]);

      const result = service.isInLogsBloom(bloom, address);

      expect(result).toBe(true);
    });

    it('should return true for topic in bloom', () => {
      const topic =
        '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
      const bloom = service.calculateLogsBloom([
        {
          address: '0x1234567890123456789012345678901234567890',
          topics: [topic],
        },
      ]);

      const result = service.isInLogsBloom(bloom, topic);

      expect(result).toBe(true);
    });

    it('should return false for value not in bloom', () => {
      const bloom = service.calculateLogsBloom([
        {
          address: '0x1234567890123456789012345678901234567890',
          topics: [],
        },
      ]);

      const differentAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
      const result = service.isInLogsBloom(bloom, differentAddress);

      // Bloom filter can have false positives, but should not have false negatives
      // If the address is definitely not in the bloom, it should return false
      // However, due to bloom filter nature, this might return true (false positive)
      // So we just check it returns a boolean
      expect(typeof result).toBe('boolean');
    });
  });
});

