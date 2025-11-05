import { Test, TestingModule } from '@nestjs/testing';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { CHAIN_ID } from '../../../src/common/constants/blockchain.constants';

/**
 * CryptoService 추가 테스트 (RLP, Hex 변환 등)
 *
 * 테스트 범위:
 * - RLP 인코딩/디코딩
 * - Hex ↔ Bytes 변환
 * - RLP 해시
 */
describe('CryptoService - Additional', () => {
  let service: CryptoService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CryptoService],
    }).compile();

    service = module.get<CryptoService>(CryptoService);
  });

  describe('RLP 인코딩/디코딩', () => {
    it('RLP 인코딩을 수행해야 함', () => {
      const input = ['hello', 'world'];
      const encoded = service.rlpEncode(input);

      expect(encoded).toBeInstanceOf(Uint8Array);
      expect(encoded.length).toBeGreaterThan(0);
    });

    it('RLP 디코딩을 수행해야 함', () => {
      const input = ['hello', 'world'];
      const encoded = service.rlpEncode(input);
      const decoded = service.rlpDecode(encoded);

      // RLP 디코딩은 Uint8Array를 반환하므로 문자열로 변환해서 비교
      expect(Array.isArray(decoded)).toBe(true);
      expect(decoded.length).toBe(2);
    });

    it('숫자를 RLP 인코딩해야 함', () => {
      const input = [0, 1, 255];
      const encoded = service.rlpEncode(input);
      const decoded = service.rlpDecode(encoded);

      // RLP 디코딩은 Uint8Array를 반환
      expect(Array.isArray(decoded)).toBe(true);
      expect(decoded.length).toBe(3);
    });
  });

  describe('RLP 해시', () => {
    it('RLP 해시를 계산해야 함 (Buffer)', () => {
      const input = ['test', 'data'];
      const hash = service.rlpHashBuffer(input);

      expect(hash).toBeInstanceOf(Buffer);
      expect(hash.length).toBe(32); // 32 bytes
    });

    it('RLP 해시를 계산해야 함 (Hex)', () => {
      const input = ['test', 'data'];
      const hash = service.rlpHash(input);

      expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(hash.length).toBe(66);
    });

    it('같은 입력은 같은 해시를 생성해야 함', () => {
      const input = ['test', 'data'];
      const hash1 = service.rlpHash(input);
      const hash2 = service.rlpHash(input);

      expect(hash1).toBe(hash2);
    });
  });

  describe('Hex ↔ Bytes 변환', () => {
    it('Hex를 Bytes로 변환해야 함', () => {
      const hex = '0x48656c6c6f'; // "Hello"
      const bytes = service.hexToBytes(hex);

      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBe(5);
    });

    it('0x 없이 Hex를 Bytes로 변환해야 함', () => {
      const hex = '48656c6c6f';
      const bytes = service.hexToBytes(hex);

      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBe(5);
    });

    it('Bytes를 Hex로 변환해야 함', () => {
      const bytes = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
      const hex = service.bytesToHex(bytes);

      expect(hex).toMatch(/^0x[0-9a-f]+$/);
    });
  });

  describe('복합 연산', () => {
    it('RLP 인코딩 후 해시를 계산해야 함', () => {
      const input = ['nonce', 'to', 'value'];
      const encoded = service.rlpEncode(input);
      const hash = service.hashBuffer(Buffer.from(encoded));

      expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it('트랜잭션 해시 계산 시나리오', () => {
      const nonce = 0;
      const to = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
      const value = 1000n;

      const rlpData = [
        nonce,
        to,
        value,
      ];

      const hash = service.rlpHash(rlpData);

      expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    });
  });
});

