import { Test, TestingModule } from '@nestjs/testing';
import { CHAIN_ID } from '../../../src/common/constants/blockchain.constants';
import { CryptoService } from '../../../src/common/crypto/crypto.service';

/**
 * CryptoService 테스트
 *
 * 왜 테스트가 중요한가:
 * - 암호화 함수는 정확성이 생명
 * - 이더리움 호환성 확인 필요
 * - 잘못된 암호화 = 자산 손실
 *
 * 테스트 항목:
 * 1. 키 생성 및 형식 검증
 * 2. 주소 생성 (이더리움 호환)
 * 3. 서명 생성 및 검증
 * 4. 해시 함수 검증
 * 5. EIP-155 트랜잭션 서명
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
   * 테스트: Keccak-256 해시 - UTF-8 입력
   */
  describe('hashUtf8', () => {
    it('should hash "hello" correctly', () => {
      // 이더리움에서 "hello"를 keccak256으로 해싱한 결과
      const expectedHash =
        '0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8';

      const result = service.hashUtf8('hello');

      expect(result).toBe(expectedHash);
    });

    it('should return hash with 0x prefix and 64 hex characters', () => {
      const result = service.hashUtf8('test');

      expect(result).toMatch(/^0x[0-9a-f]{64}$/);
      expect(result.length).toBe(66);
    });

    it('should produce different hashes for different inputs', () => {
      const hash1 = service.hashUtf8('input1');
      const hash2 = service.hashUtf8('input2');

      expect(hash1).not.toBe(hash2);
    });
  });

  /**
   * 테스트: Keccak-256 해시 - Buffer 입력
   */
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
  });

  /**
   * 테스트: Keccak-256 해시 - HEX 입력
   */
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
  });

  /**
   * 테스트: 개인키 생성
   */
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
      // 여러 번 생성해서 0이 나오지 않는지 확인
      for (let i = 0; i < 10; i++) {
        const key = service.generatePrivateKey();
        expect(key).not.toBe('0x' + '0'.repeat(64));
      }
    });
  });

  /**
   * 테스트: 공개키 생성
   */
  describe('getPublicKeyFromPrivate', () => {
    it('should derive public key from private key', () => {
      const privateKey =
        '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

      const publicKey = service.getPublicKeyFromPrivate(privateKey);

      expect(publicKey).toBeDefined();
      expect(publicKey.length).toBe(128);
    });

    it('should be deterministic', () => {
      const privateKey = service.generatePrivateKey();

      const publicKey1 = service.getPublicKeyFromPrivate(privateKey);
      const publicKey2 = service.getPublicKeyFromPrivate(privateKey);

      expect(publicKey1).toBe(publicKey2);
    });

    it('should throw error for invalid private key', () => {
      expect(() => service.getPublicKeyFromPrivate('invalid')).toThrow();
    });
  });

  /**
   * 테스트: 주소 생성
   */
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
  });

  /**
   * 테스트: 개인키 → 주소 직접 변환
   */
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

  /**
   * 테스트: 키 쌍 생성
   */
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
  });

  /**
   * 테스트: 메시지 서명 (레거시)
   */
  describe('sign', () => {
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
      expect(() => service.sign('invalid', privateKey)).toThrow();
    });

    it('should throw error for invalid private key', () => {
      const messageHash = service.hashUtf8('test');
      expect(() => service.sign(messageHash, 'invalid')).toThrow();
    });
  });

  /**
   * 테스트: 트랜잭션 서명 (EIP-155)
   */
  describe('signTransaction', () => {
    it('should create EIP-155 signature', () => {
      const privateKey = service.generatePrivateKey();
      const txHash = service.hashUtf8('transaction data');

      const signature = service.signTransaction(txHash, privateKey);

      // v 값이 EIP-155 형식이어야 함 (chainId * 2 + 35 + recoveryId)
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

      // v에서 chainId 추출
      const recoveredChainId = Math.floor((signature.v - 35) / 2);
      expect(recoveredChainId).toBe(CHAIN_ID);
    });

    it('should work with custom chainId', () => {
      const privateKey = service.generatePrivateKey();
      const txHash = service.hashUtf8('transaction data');
      const customChainId = 1; // 이더리움 메인넷

      const signature = service.signTransaction(
        txHash,
        privateKey,
        customChainId,
      );

      const recoveredChainId = Math.floor((signature.v - 35) / 2);
      expect(recoveredChainId).toBe(customChainId);
    });
  });

  /**
   * 테스트: 공개키 복구
   */
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
  });

  /**
   * 테스트: 주소 복구
   */
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

  /**
   * 테스트: 서명 검증
   */
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
      const isValid = service.verify(messageHash, signature, keyPair2.address);

      expect(isValid).toBe(false);
    });

    it('should reject signature with tampered message', () => {
      const keyPair = service.generateKeyPair();
      const messageHash1 = service.hashUtf8('original message');
      const messageHash2 = service.hashUtf8('tampered message');

      const signature = service.sign(messageHash1, keyPair.privateKey);
      const isValid = service.verify(messageHash2, signature, keyPair.address);

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
  });

  /**
   * 통합 테스트: 전체 플로우
   */
  describe('Integration: Complete Flow', () => {
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

      // 서명에서 체인 ID 확인
      const recoveredChainId = Math.floor((signature.v - 35) / 2);
      expect(recoveredChainId).toBe(CHAIN_ID);

      // 검증
      const isValid = service.verify(txHash, signature, sender.address);
      expect(isValid).toBe(true);

      // 주소 복구
      const recoveredAddress = service.recoverAddress(txHash, signature);
      expect(recoveredAddress.toLowerCase()).toBe(sender.address.toLowerCase());
    });
  });
});
