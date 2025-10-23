import { Test, TestingModule } from '@nestjs/testing';
import { CHAIN_ID } from '../../../src/common/constants/blockchain.constants';
import { CryptoService } from '../../../src/common/crypto/crypto.service';

/**
 * CryptoService 테스트
 *
 * 목표:
 * - 100% 코드 커버리지
 * - 모든 메서드 테스트
 * - 정상 케이스 + 에러 케이스
 * - 이더리움 표준 준수 확인
 *
 * 테스트 범위:
 * 1. 해시 함수들 (hashBuffer, hashHex, hashUtf8)
 * 2. 키 생성 (generatePrivateKey, getPublicKeyFromPrivate, generateKeyPair)
 * 3. 주소 생성 (publicKeyToAddress, privateKeyToAddress)
 * 4. 서명 (sign, signTransaction)
 * 5. 검증 (recoverPublicKey, recoverAddress, verify)
 * 6. RLP (rlpEncode, rlpDecode, rlpHash, rlpHashBuffer)
 * 7. 유틸리티 (hexToBytes, bytesToHex)
 */
describe('CryptoService', () => {
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

  /**
   * ========================================
   * 1. 해시 함수 테스트
   * ========================================
   */
  describe('Hash Functions', () => {
    describe('hashBuffer', () => {
      it('should hash buffer correctly', () => {
        const buffer = Buffer.from('hello', 'utf8');
        const expectedHash =
          '0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8';

        const result = service.hashBuffer(buffer);

        expect(result).toBe(expectedHash);
      });

      it('should return hash with correct format', () => {
        const buffer = Buffer.from('test', 'utf8');
        const result = service.hashBuffer(buffer);

        expect(result).toMatch(/^0x[0-9a-f]{64}$/);
        expect(result.length).toBe(66);
      });

      it('should hash empty buffer', () => {
        const buffer = Buffer.from('', 'utf8');
        const result = service.hashBuffer(buffer);

        expect(result).toMatch(/^0x[0-9a-f]{64}$/);
      });

      it('should produce different hashes for different buffers', () => {
        const buffer1 = Buffer.from('hello', 'utf8');
        const buffer2 = Buffer.from('world', 'utf8');

        expect(service.hashBuffer(buffer1)).not.toBe(
          service.hashBuffer(buffer2),
        );
      });
    });

    describe('hashHex', () => {
      it('should hash hex string with 0x prefix', () => {
        const hex = '0x48656c6c6f'; // "Hello" in hex
        const result = service.hashHex(hex);

        expect(result).toMatch(/^0x[0-9a-f]{64}$/);
      });

      it('should hash hex string without 0x prefix', () => {
        const hex = '48656c6c6f'; // "Hello" in hex
        const result = service.hashHex(hex);

        expect(result).toMatch(/^0x[0-9a-f]{64}$/);
      });

      it('should produce same hash as hashBuffer for same data', () => {
        const text = 'hello';
        const buffer = Buffer.from(text, 'utf8');
        const hex = '0x' + buffer.toString('hex');

        expect(service.hashHex(hex)).toBe(service.hashBuffer(buffer));
      });
    });

    describe('hashUtf8', () => {
      it('should hash "hello" correctly', () => {
        const expectedHash =
          '0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8';

        const result = service.hashUtf8('hello');

        expect(result).toBe(expectedHash);
      });

      it('should return hash with correct format', () => {
        const result = service.hashUtf8('test');

        expect(result).toMatch(/^0x[0-9a-f]{64}$/);
        expect(result.length).toBe(66);
      });

      it('should hash empty string', () => {
        const result = service.hashUtf8('');
        expect(result).toMatch(/^0x[0-9a-f]{64}$/);
      });

      it('should hash unicode characters', () => {
        const result = service.hashUtf8('안녕하세요 🚀');
        expect(result).toMatch(/^0x[0-9a-f]{64}$/);
      });

      it('should produce different hashes for different inputs', () => {
        const hash1 = service.hashUtf8('input1');
        const hash2 = service.hashUtf8('input2');

        expect(hash1).not.toBe(hash2);
      });

      it('should be deterministic', () => {
        const hash1 = service.hashUtf8('test');
        const hash2 = service.hashUtf8('test');

        expect(hash1).toBe(hash2);
      });
    });
  });

  /**
   * ========================================
   * 2. 키 생성 테스트
   * ========================================
   */
  describe('Key Generation', () => {
    describe('generatePrivateKey', () => {
      it('should generate private key with correct format', () => {
        const privateKey = service.generatePrivateKey();

        expect(privateKey).toMatch(/^0x[0-9a-f]{64}$/);
        expect(privateKey.length).toBe(66);
      });

      it('should generate different keys each time', () => {
        const key1 = service.generatePrivateKey();
        const key2 = service.generatePrivateKey();

        expect(key1).not.toBe(key2);
      });

      it('should not generate zero key', () => {
        for (let i = 0; i < 10; i++) {
          const key = service.generatePrivateKey();
          expect(key).not.toBe('0x' + '0'.repeat(64));
        }
      });

      it('should generate valid keys (can derive public key)', () => {
        const privateKey = service.generatePrivateKey();
        expect(() => service.getPublicKeyFromPrivate(privateKey)).not.toThrow();
      });
    });

    describe('getPublicKeyFromPrivate', () => {
      it('should derive public key from private key', () => {
        const privateKey =
          '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

        const publicKey = service.getPublicKeyFromPrivate(privateKey);

        expect(publicKey).toBeDefined();
        expect(publicKey.length).toBe(128); // 64 bytes = 128 hex chars
      });

      it('should be deterministic', () => {
        const privateKey = service.generatePrivateKey();

        const publicKey1 = service.getPublicKeyFromPrivate(privateKey);
        const publicKey2 = service.getPublicKeyFromPrivate(privateKey);

        expect(publicKey1).toBe(publicKey2);
      });

      it('should throw error for invalid private key', () => {
        expect(() => service.getPublicKeyFromPrivate('invalid')).toThrow();
        expect(() => service.getPublicKeyFromPrivate('0x123')).toThrow();
        expect(() =>
          service.getPublicKeyFromPrivate('0x' + '0'.repeat(64)),
        ).toThrow();
      });

      it('should handle edge case private keys', () => {
        // Minimum valid private key (1)
        const minKey =
          '0x0000000000000000000000000000000000000000000000000000000000000001';
        expect(() => service.getPublicKeyFromPrivate(minKey)).not.toThrow();
      });
    });

    describe('generateKeyPair', () => {
      it('should generate complete key pair', () => {
        const keyPair = service.generateKeyPair();

        expect(keyPair.privateKey).toMatch(/^0x[0-9a-f]{64}$/);
        expect(keyPair.publicKey).toHaveLength(128);
        expect(keyPair.address).toMatch(/^0x[0-9a-f]{40}$/);
      });

      it('should have consistent relationships', () => {
        const keyPair = service.generateKeyPair();

        const derivedPublicKey = service.getPublicKeyFromPrivate(
          keyPair.privateKey,
        );
        expect(derivedPublicKey).toBe(keyPair.publicKey);

        const derivedAddress = service.publicKeyToAddress(keyPair.publicKey);
        expect(derivedAddress).toBe(keyPair.address);
      });

      it('should generate different key pairs each time', () => {
        const keyPair1 = service.generateKeyPair();
        const keyPair2 = service.generateKeyPair();

        expect(keyPair1.privateKey).not.toBe(keyPair2.privateKey);
        expect(keyPair1.publicKey).not.toBe(keyPair2.publicKey);
        expect(keyPair1.address).not.toBe(keyPair2.address);
      });
    });
  });

  /**
   * ========================================
   * 3. 주소 생성 테스트
   * ========================================
   */
  describe('Address Generation', () => {
    describe('publicKeyToAddress', () => {
      it('should generate address with correct format', () => {
        const privateKey = service.generatePrivateKey();
        const publicKey = service.getPublicKeyFromPrivate(privateKey);

        const address = service.publicKeyToAddress(publicKey);

        expect(address).toMatch(/^0x[0-9a-f]{40}$/);
        expect(address.length).toBe(42);
      });

      it('should be deterministic', () => {
        const privateKey = service.generatePrivateKey();
        const publicKey = service.getPublicKeyFromPrivate(privateKey);

        const address1 = service.publicKeyToAddress(publicKey);
        const address2 = service.publicKeyToAddress(publicKey);

        expect(address1).toBe(address2);
      });

      it('should generate lowercase address', () => {
        const privateKey = service.generatePrivateKey();
        const publicKey = service.getPublicKeyFromPrivate(privateKey);

        const address = service.publicKeyToAddress(publicKey);

        expect(address).toBe(address.toLowerCase());
      });
    });

    describe('privateKeyToAddress', () => {
      it('should derive address from private key', () => {
        const privateKey = service.generatePrivateKey();

        const address = service.privateKeyToAddress(privateKey);

        expect(address).toMatch(/^0x[0-9a-f]{40}$/);
      });

      it('should match the result of publicKeyToAddress', () => {
        const privateKey = service.generatePrivateKey();

        const publicKey = service.getPublicKeyFromPrivate(privateKey);
        const addressFromPublic = service.publicKeyToAddress(publicKey);
        const addressDirect = service.privateKeyToAddress(privateKey);

        expect(addressDirect).toBe(addressFromPublic);
      });
    });
  });

  /**
   * ========================================
   * 4. 서명 테스트
   * ========================================
   */
  describe('Signing', () => {
    describe('sign (Legacy)', () => {
      it('should create signature with correct structure', () => {
        const privateKey = service.generatePrivateKey();
        const messageHash = service.hashUtf8('test message');

        const signature = service.sign(messageHash, privateKey);

        expect(signature).toHaveProperty('v');
        expect(signature).toHaveProperty('r');
        expect(signature).toHaveProperty('s');
        expect(signature.v).toBeGreaterThanOrEqual(27);
        expect(signature.v).toBeLessThanOrEqual(28);
        expect(signature.r).toMatch(/^0x[0-9a-f]{64}$/);
        expect(signature.s).toMatch(/^0x[0-9a-f]{64}$/);
      });

      it('should be deterministic with canonical signature', () => {
        const privateKey = service.generatePrivateKey();
        const messageHash = service.hashUtf8('test message');

        const sig1 = service.sign(messageHash, privateKey);
        const sig2 = service.sign(messageHash, privateKey);

        expect(sig1.r).toBe(sig2.r);
        expect(sig1.s).toBe(sig2.s);
        expect(sig1.v).toBe(sig2.v);
      });

      it('should throw error for invalid hash', () => {
        const privateKey = service.generatePrivateKey();
        expect(() => service.sign('invalid', privateKey)).toThrow(
          'Invalid message hash',
        );
        expect(() => service.sign('0x123', privateKey)).toThrow();
      });

      it('should throw error for invalid private key', () => {
        const messageHash = service.hashUtf8('test');
        expect(() => service.sign(messageHash, 'invalid')).toThrow(
          'Invalid private key',
        );
        expect(() =>
          service.sign(messageHash, '0x' + '0'.repeat(64)),
        ).toThrow();
      });
    });

    describe('signTransaction (EIP-155)', () => {
      it('should create EIP-155 signature', () => {
        const privateKey = service.generatePrivateKey();
        const txHash = service.hashUtf8('transaction data');

        const signature = service.signTransaction(txHash, privateKey);

        const minV = CHAIN_ID * 2 + 35;
        expect(signature.v).toBeGreaterThanOrEqual(minV);
        expect(signature.v).toBeLessThanOrEqual(minV + 1);

        expect(signature.r).toMatch(/^0x[0-9a-f]{64}$/);
        expect(signature.s).toMatch(/^0x[0-9a-f]{64}$/);
      });

      it('should include chainId in signature', () => {
        const privateKey = service.generatePrivateKey();
        const txHash = service.hashUtf8('transaction data');

        const signature = service.signTransaction(txHash, privateKey);

        const recoveredChainId = Math.floor((signature.v - 35) / 2);
        expect(recoveredChainId).toBe(CHAIN_ID);
      });

      it('should work with custom chainId', () => {
        const privateKey = service.generatePrivateKey();
        const txHash = service.hashUtf8('transaction data');
        const customChainId = 1; // Ethereum mainnet

        const signature = service.signTransaction(
          txHash,
          privateKey,
          customChainId,
        );

        const recoveredChainId = Math.floor((signature.v - 35) / 2);
        expect(recoveredChainId).toBe(customChainId);
      });

      it('should be deterministic', () => {
        const privateKey = service.generatePrivateKey();
        const txHash = service.hashUtf8('transaction data');

        const sig1 = service.signTransaction(txHash, privateKey);
        const sig2 = service.signTransaction(txHash, privateKey);

        expect(sig1).toEqual(sig2);
      });

      it('should throw error for invalid hash', () => {
        const privateKey = service.generatePrivateKey();
        expect(() => service.signTransaction('invalid', privateKey)).toThrow(
          'Invalid transaction hash',
        );
      });

      it('should throw error for invalid private key', () => {
        const txHash = service.hashUtf8('test');
        expect(() => service.signTransaction(txHash, 'invalid')).toThrow(
          'Invalid private key',
        );
      });
    });
  });

  /**
   * ========================================
   * 5. 서명 검증 테스트
   * ========================================
   */
  describe('Signature Verification', () => {
    describe('recoverPublicKey', () => {
      it('should recover correct public key from legacy signature', () => {
        const keyPair = service.generateKeyPair();
        const messageHash = service.hashUtf8('test message');

        const signature = service.sign(messageHash, keyPair.privateKey);
        const recoveredPublicKey = service.recoverPublicKey(
          messageHash,
          signature,
        );

        expect(recoveredPublicKey).toBe(keyPair.publicKey);
      });

      it('should recover correct public key from EIP-155 signature', () => {
        const keyPair = service.generateKeyPair();
        const txHash = service.hashUtf8('transaction data');

        const signature = service.signTransaction(txHash, keyPair.privateKey);
        const recoveredPublicKey = service.recoverPublicKey(txHash, signature);

        expect(recoveredPublicKey).toBe(keyPair.publicKey);
      });

      it('should throw error for invalid hash', () => {
        const keyPair = service.generateKeyPair();
        const messageHash = service.hashUtf8('test');
        const signature = service.sign(messageHash, keyPair.privateKey);

        expect(() => service.recoverPublicKey('invalid', signature)).toThrow(
          'Invalid message hash',
        );
      });

      it('should throw error for invalid recovery id', () => {
        const messageHash = service.hashUtf8('test');
        const invalidSignature = {
          v: 30, // Invalid v value (레거시면 27/28만 유효, recoveryId = 30-27 = 3)
          r: '0x' + '12'.repeat(32),
          s: '0x' + '34'.repeat(32),
        };

        expect(() =>
          service.recoverPublicKey(messageHash, invalidSignature),
        ).toThrow('Invalid recovery id');
      });
    });

    describe('recoverAddress', () => {
      it('should recover correct address from signature', () => {
        const keyPair = service.generateKeyPair();
        const messageHash = service.hashUtf8('test message');

        const signature = service.sign(messageHash, keyPair.privateKey);
        const recoveredAddress = service.recoverAddress(messageHash, signature);

        expect(recoveredAddress.toLowerCase()).toBe(
          keyPair.address.toLowerCase(),
        );
      });

      it('should recover address from EIP-155 signature', () => {
        const keyPair = service.generateKeyPair();
        const txHash = service.hashUtf8('transaction data');

        const signature = service.signTransaction(txHash, keyPair.privateKey);
        const recoveredAddress = service.recoverAddress(txHash, signature);

        expect(recoveredAddress.toLowerCase()).toBe(
          keyPair.address.toLowerCase(),
        );
      });
    });

    describe('verify', () => {
      it('should verify valid legacy signature', () => {
        const keyPair = service.generateKeyPair();
        const messageHash = service.hashUtf8('test message');

        const signature = service.sign(messageHash, keyPair.privateKey);
        const isValid = service.verify(messageHash, signature, keyPair.address);

        expect(isValid).toBe(true);
      });

      it('should verify valid EIP-155 signature', () => {
        const keyPair = service.generateKeyPair();
        const txHash = service.hashUtf8('transaction data');

        const signature = service.signTransaction(txHash, keyPair.privateKey);
        const isValid = service.verify(txHash, signature, keyPair.address);

        expect(isValid).toBe(true);
      });

      it('should reject signature with wrong address', () => {
        const keyPair1 = service.generateKeyPair();
        const keyPair2 = service.generateKeyPair();
        const messageHash = service.hashUtf8('test message');

        const signature = service.sign(messageHash, keyPair1.privateKey);
        const isValid = service.verify(
          messageHash,
          signature,
          keyPair2.address,
        );

        expect(isValid).toBe(false);
      });

      it('should reject signature with tampered message', () => {
        const keyPair = service.generateKeyPair();
        const messageHash1 = service.hashUtf8('original message');
        const messageHash2 = service.hashUtf8('tampered message');

        const signature = service.sign(messageHash1, keyPair.privateKey);
        const isValid = service.verify(
          messageHash2,
          signature,
          keyPair.address,
        );

        expect(isValid).toBe(false);
      });

      it('should be case-insensitive for address', () => {
        const keyPair = service.generateKeyPair();
        const messageHash = service.hashUtf8('test message');

        const signature = service.sign(messageHash, keyPair.privateKey);
        const isValid = service.verify(
          messageHash,
          signature,
          keyPair.address.toUpperCase(),
        );

        expect(isValid).toBe(true);
      });

      it('should return false for invalid signature (not throw)', () => {
        const keyPair = service.generateKeyPair();
        const messageHash = service.hashUtf8('test');
        const invalidSignature = {
          v: 27,
          r: '0xinvalidhex',
          s: '0x' + '34'.repeat(32),
        };

        const isValid = service.verify(
          messageHash,
          invalidSignature,
          keyPair.address,
        );

        expect(isValid).toBe(false);
      });
    });
  });

  /**
   * ========================================
   * 6. RLP 인코딩/디코딩 테스트
   * ========================================
   */
  describe('RLP Encoding/Decoding', () => {
    describe('rlpEncode', () => {
      it('should encode number', () => {
        const encoded = service.rlpEncode(5);
        expect(encoded).toBeInstanceOf(Uint8Array);
        expect(encoded.length).toBeGreaterThan(0);
      });

      it('should encode string', () => {
        const encoded = service.rlpEncode('hello');
        expect(encoded).toBeInstanceOf(Uint8Array);
      });

      it('should encode array', () => {
        const encoded = service.rlpEncode([1, 2, 3]);
        expect(encoded).toBeInstanceOf(Uint8Array);
      });

      it('should encode nested array', () => {
        const encoded = service.rlpEncode([1, [2, 3], 4]);
        expect(encoded).toBeInstanceOf(Uint8Array);
      });

      it('should encode empty array', () => {
        const encoded = service.rlpEncode([]);
        expect(encoded).toBeInstanceOf(Uint8Array);
      });

      it('should encode bigint', () => {
        const encoded = service.rlpEncode(BigInt(1000));
        expect(encoded).toBeInstanceOf(Uint8Array);
      });
    });

    describe('rlpDecode', () => {
      it('should decode encoded number', () => {
        const original = 5;
        const encoded = service.rlpEncode(original);
        const decoded = service.rlpDecode(encoded);

        expect(Buffer.from(decoded).toString('hex')).toBe('05');
      });

      it('should decode encoded array', () => {
        const original = [1, 2, 3];
        const encoded = service.rlpEncode(original);
        const decoded = service.rlpDecode(encoded);

        expect(Array.isArray(decoded)).toBe(true);
      });

      it('should round-trip encode/decode', () => {
        const original = ['hello', 123, Buffer.from('world')];
        const encoded = service.rlpEncode(original);
        const decoded = service.rlpDecode(encoded);

        expect(Array.isArray(decoded)).toBe(true);
        expect(decoded).toHaveLength(3);
      });
    });

    describe('rlpHashBuffer', () => {
      it('should return Buffer', () => {
        const hash = service.rlpHashBuffer([1, 2, 3]);
        expect(hash).toBeInstanceOf(Buffer);
        expect(hash.length).toBe(32); // 32 bytes
      });

      it('should be deterministic', () => {
        const hash1 = service.rlpHashBuffer([1, 2, 3]);
        const hash2 = service.rlpHashBuffer([1, 2, 3]);

        expect(hash1.toString('hex')).toBe(hash2.toString('hex'));
      });

      it('should produce different hashes for different inputs', () => {
        const hash1 = service.rlpHashBuffer([1, 2, 3]);
        const hash2 = service.rlpHashBuffer([1, 2, 4]);

        expect(hash1.toString('hex')).not.toBe(hash2.toString('hex'));
      });
    });

    describe('rlpHash', () => {
      it('should return hex string with 0x prefix', () => {
        const hash = service.rlpHash([1, 2, 3]);
        expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
        expect(hash.length).toBe(66);
      });

      it('should be deterministic', () => {
        const hash1 = service.rlpHash([1, 2, 3]);
        const hash2 = service.rlpHash([1, 2, 3]);

        expect(hash1).toBe(hash2);
      });

      it('should match rlpHashBuffer output', () => {
        const input = [1, 2, 3];
        const bufferHash = service.rlpHashBuffer(input);
        const stringHash = service.rlpHash(input);

        expect(stringHash).toBe('0x' + bufferHash.toString('hex'));
      });

      it('should handle complex nested structures', () => {
        const input = [1, [2, 3], 'hello', BigInt(1000)];
        const hash = service.rlpHash(input);

        expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
      });
    });
  });

  /**
   * ========================================
   * 7. Hex 변환 유틸리티 테스트
   * ========================================
   */
  describe('Hex Conversion Utilities', () => {
    describe('hexToBytes', () => {
      it('should convert hex with 0x prefix to Uint8Array', () => {
        const bytes = service.hexToBytes('0x1234');
        expect(bytes).toBeInstanceOf(Uint8Array);
        expect(bytes.length).toBe(2);
        expect(bytes[0]).toBe(0x12);
        expect(bytes[1]).toBe(0x34);
      });

      it('should convert hex without 0x prefix to Uint8Array', () => {
        const bytes = service.hexToBytes('1234');
        expect(bytes).toBeInstanceOf(Uint8Array);
        expect(bytes.length).toBe(2);
      });

      it('should handle empty hex', () => {
        const bytes = service.hexToBytes('0x');
        expect(bytes).toBeInstanceOf(Uint8Array);
        expect(bytes.length).toBe(0);
      });

      it('should convert long hex strings', () => {
        const hex = '0x' + '12'.repeat(32); // 32 bytes
        const bytes = service.hexToBytes(hex);
        expect(bytes.length).toBe(32);
      });
    });

    describe('bytesToHex', () => {
      it('should convert Uint8Array to hex with 0x prefix', () => {
        const bytes = new Uint8Array([0x12, 0x34, 0x56]);
        const hex = service.bytesToHex(bytes);

        expect(hex).toBe('0x123456');
      });

      it('should handle empty array', () => {
        const bytes = new Uint8Array([]);
        const hex = service.bytesToHex(bytes);

        expect(hex).toBe('0x');
      });

      it('should convert Buffer to hex', () => {
        const buffer = Buffer.from([0x12, 0x34]);
        const hex = service.bytesToHex(buffer);

        expect(hex).toBe('0x1234');
      });

      it('should produce lowercase hex', () => {
        const bytes = new Uint8Array([0xab, 0xcd, 0xef]);
        const hex = service.bytesToHex(bytes);

        expect(hex).toBe('0xabcdef');
      });
    });

    describe('hexToBytes + bytesToHex round-trip', () => {
      it('should be reversible', () => {
        const original = '0xabcdef123456';
        const bytes = service.hexToBytes(original);
        const restored = service.bytesToHex(bytes);

        expect(restored).toBe(original);
      });

      it('should normalize hex without prefix', () => {
        const original = 'abcdef';
        const bytes = service.hexToBytes(original);
        const restored = service.bytesToHex(bytes);

        expect(restored).toBe('0x' + original);
      });
    });
  });

  /**
   * ========================================
   * 8. 통합 테스트
   * ========================================
   */
  describe('Integration Tests', () => {
    it('should complete legacy signing and verification flow', () => {
      const sender = service.generateKeyPair();
      const recipient = service.generateKeyPair();

      const txData = {
        from: sender.address,
        to: recipient.address,
        value: '1000000000000000000',
        nonce: 0,
      };

      const txHash = service.hashUtf8(JSON.stringify(txData));
      const signature = service.sign(txHash, sender.privateKey);
      const isValid = service.verify(txHash, signature, sender.address);

      expect(isValid).toBe(true);

      const recoveredAddress = service.recoverAddress(txHash, signature);
      expect(recoveredAddress.toLowerCase()).toBe(sender.address.toLowerCase());
    });

    it('should complete EIP-155 transaction flow', () => {
      const sender = service.generateKeyPair();
      const recipient = service.generateKeyPair();

      const txData = {
        from: sender.address,
        to: recipient.address,
        value: '1000000000000000000',
        nonce: 0,
        chainId: CHAIN_ID,
      };

      const txHash = service.hashUtf8(JSON.stringify(txData));
      const signature = service.signTransaction(txHash, sender.privateKey);

      const recoveredChainId = Math.floor((signature.v - 35) / 2);
      expect(recoveredChainId).toBe(CHAIN_ID);

      const isValid = service.verify(txHash, signature, sender.address);
      expect(isValid).toBe(true);

      const recoveredAddress = service.recoverAddress(txHash, signature);
      expect(recoveredAddress.toLowerCase()).toBe(sender.address.toLowerCase());
    });

    it('should create block hash using RLP', () => {
      const blockData = [
        0, // number
        '0x' + '0'.repeat(64), // parentHash
        Date.now(), // timestamp
        '0x' + '12'.repeat(20), // proposer
      ];

      const blockHash = service.rlpHash(blockData);

      expect(blockHash).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it('should verify address derivation chain', () => {
      const privateKey = service.generatePrivateKey();
      const publicKey = service.getPublicKeyFromPrivate(privateKey);
      const address = service.publicKeyToAddress(publicKey);

      // Verify full chain
      expect(service.privateKeyToAddress(privateKey)).toBe(address);

      // Sign and recover
      const message = service.hashUtf8('test');
      const signature = service.sign(message, privateKey);
      const recoveredAddress = service.recoverAddress(message, signature);

      expect(recoveredAddress.toLowerCase()).toBe(address.toLowerCase());
    });
  });

  /**
   * ========================================
   * 9. 엣지 케이스 및 에러 처리
   * ========================================
   */
  describe('Edge Cases and Error Handling', () => {
    it('should handle maximum safe integer in RLP', () => {
      const maxSafe = Number.MAX_SAFE_INTEGER;
      const encoded = service.rlpEncode(maxSafe);
      expect(encoded).toBeInstanceOf(Uint8Array);
    });

    it('should handle very large bigint in RLP', () => {
      const largeBigInt = BigInt('999999999999999999999999');
      const encoded = service.rlpEncode(largeBigInt);
      expect(encoded).toBeInstanceOf(Uint8Array);
    });

    it('should handle special characters in hash', () => {
      const hash = service.hashUtf8('!@#$%^&*()_+-={}[]|:;<>?,./');
      expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it('should handle long strings in hash', () => {
      const longString = 'a'.repeat(10000);
      const hash = service.hashUtf8(longString);
      expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    });
  });

  /**
   * ========================================
   * 10. 성능 테스트
   * ========================================
   */
  describe('Performance Tests', () => {
    it('should generate 100 key pairs quickly', () => {
      const start = Date.now();

      for (let i = 0; i < 100; i++) {
        service.generateKeyPair();
      }

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(5000); // Should complete in < 5 seconds
    });

    it('should hash 1000 messages quickly', () => {
      const start = Date.now();

      for (let i = 0; i < 1000; i++) {
        service.hashUtf8(`message ${i}`);
      }

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(1000); // Should complete in < 1 second
    });

    it('should sign and verify 100 messages quickly', () => {
      const keyPair = service.generateKeyPair();
      const start = Date.now();

      for (let i = 0; i < 100; i++) {
        const message = service.hashUtf8(`message ${i}`);
        const signature = service.sign(message, keyPair.privateKey);
        service.verify(message, signature, keyPair.address);
      }

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(20000); // Should complete in < 20 seconds (암호화 연산은 시간이 오래 걸림)
    });
  });
});
