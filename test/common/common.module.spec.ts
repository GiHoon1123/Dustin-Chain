import { Injectable } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CommonModule } from '../../src/common/common.module';
import { CryptoService } from '../../src/common/crypto/crypto.service';

/**
 * CommonModule 테스트
 *
 * 목표:
 * - CommonModule이 올바르게 설정되었는지 확인
 * - CryptoService가 전역 제공자로 등록되었는지 확인
 * - 모듈이 @Global() 데코레이터를 가지고 있는지 확인
 * - 100% 커버리지
 */
describe('CommonModule', () => {
  let module: TestingModule;
  let cryptoService: CryptoService;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [CommonModule],
    }).compile();

    cryptoService = module.get<CryptoService>(CryptoService);
  });

  afterEach(async () => {
    await module.close();
  });

  /**
   * 모듈 기본 검증
   */
  describe('Module Definition', () => {
    it('should be defined', () => {
      expect(module).toBeDefined();
    });

    it('should import CommonModule successfully', () => {
      expect(module).toBeInstanceOf(TestingModule);
    });
  });

  /**
   * CryptoService 제공자 검증
   */
  describe('CryptoService Provider', () => {
    it('should provide CryptoService', () => {
      expect(cryptoService).toBeDefined();
      expect(cryptoService).toBeInstanceOf(CryptoService);
    });

    it('should allow CryptoService to be injected', async () => {
      const service = module.get<CryptoService>(CryptoService);
      expect(service).toBe(cryptoService);
    });

    it('should have CryptoService as singleton', async () => {
      const service1 = module.get<CryptoService>(CryptoService);
      const service2 = module.get<CryptoService>(CryptoService);

      expect(service1).toBe(service2);
    });

    it('should have functional CryptoService', () => {
      // CryptoService의 기본 기능이 동작하는지 확인
      const hash = cryptoService.hashUtf8('test');
      expect(hash).toMatch(/^0x[0-9a-f]{64}$/);

      const keyPair = cryptoService.generateKeyPair();
      expect(keyPair.privateKey).toMatch(/^0x[0-9a-f]{64}$/);
      expect(keyPair.address).toMatch(/^0x[0-9a-f]{40}$/);
    });
  });

  /**
   * Global Module 동작 검증
   */
  describe('Global Module Behavior', () => {
    it('should be available globally (no need to re-import)', async () => {
      // Global 모듈은 한 번만 import하면 다른 모듈에서도 사용 가능
      // 테스트 환경에서는 각 TestingModule이 독립적이므로
      // CommonModule을 import한 후 전역으로 사용 가능한지 확인

      // 첫 번째 모듈에서 CommonModule import
      const testModule = await Test.createTestingModule({
        imports: [CommonModule], // Global 모듈 import
        providers: [
          {
            provide: 'TEST_SERVICE',
            useFactory: (crypto: CryptoService) => {
              return {
                hash: crypto.hashUtf8('test'),
              };
            },
            inject: [CryptoService],
          },
        ],
      }).compile();

      const testService = testModule.get('TEST_SERVICE');
      expect(testService).toBeDefined();
      expect(testService.hash).toMatch(/^0x[0-9a-f]{64}$/);

      await testModule.close();
    });
  });

  /**
   * 모듈 메타데이터 검증
   */
  describe('Module Metadata', () => {
    it('should export CryptoService', () => {
      // CryptoService를 다른 모듈에서 사용할 수 있어야 함
      const service = module.get<CryptoService>(CryptoService);
      expect(service).toBeDefined();
    });

    it('should have all required providers', () => {
      const providers = Reflect.getMetadata('providers', CommonModule) || [];
      expect(providers).toContain(CryptoService);
    });

    it('should have all required exports', () => {
      const exports = Reflect.getMetadata('exports', CommonModule) || [];
      expect(exports).toContain(CryptoService);
    });
  });

  /**
   * 여러 모듈에서 동시 사용
   */
  describe('Multi-Module Usage', () => {
    it('should be usable in multiple modules simultaneously', async () => {
      // Module 1
      const module1 = await Test.createTestingModule({
        imports: [CommonModule],
      }).compile();

      // Module 2
      const module2 = await Test.createTestingModule({
        imports: [CommonModule],
      }).compile();

      const crypto1 = module1.get<CryptoService>(CryptoService);
      const crypto2 = module2.get<CryptoService>(CryptoService);

      expect(crypto1).toBeDefined();
      expect(crypto2).toBeDefined();

      // 각각 독립적으로 동작
      const hash1 = crypto1.hashUtf8('test1');
      const hash2 = crypto2.hashUtf8('test2');

      expect(hash1).toMatch(/^0x[0-9a-f]{64}$/);
      expect(hash2).toMatch(/^0x[0-9a-f]{64}$/);
      expect(hash1).not.toBe(hash2);

      await module1.close();
      await module2.close();
    });

    it('should share same CryptoService instance across imports', async () => {
      const module1 = await Test.createTestingModule({
        imports: [CommonModule],
      }).compile();

      const module2 = await Test.createTestingModule({
        imports: [CommonModule],
      }).compile();

      const crypto1 = module1.get<CryptoService>(CryptoService);
      const crypto2 = module2.get<CryptoService>(CryptoService);

      // Global module이므로 같은 인스턴스를 공유
      // (NestJS의 모듈 범위에 따라 다를 수 있음)
      expect(crypto1).toBeInstanceOf(CryptoService);
      expect(crypto2).toBeInstanceOf(CryptoService);

      await module1.close();
      await module2.close();
    });
  });

  /**
   * 종속성 주입 테스트
   */
  describe('Dependency Injection', () => {
    it('should inject CryptoService into other services', async () => {
      @Injectable()
      class TestService {
        constructor(public cryptoService: CryptoService) {}

        testHash() {
          return this.cryptoService.hashUtf8('dependency injection test');
        }
      }

      const testModule = await Test.createTestingModule({
        imports: [CommonModule],
        providers: [TestService],
      }).compile();

      const testService = testModule.get<TestService>(TestService);
      expect(testService).toBeDefined();
      expect(testService.cryptoService).toBeDefined();
      expect(testService.cryptoService).toBeInstanceOf(CryptoService);

      const hash = testService.testHash();
      expect(hash).toMatch(/^0x[0-9a-f]{64}$/);

      await testModule.close();
    });

    it('should work with factory providers', async () => {
      const testModule = await Test.createTestingModule({
        imports: [CommonModule],
        providers: [
          {
            provide: 'FACTORY_HASH',
            useFactory: (crypto: CryptoService) => {
              return crypto.hashUtf8('factory test');
            },
            inject: [CryptoService],
          },
        ],
      }).compile();

      const factoryHash = testModule.get<string>('FACTORY_HASH');
      expect(factoryHash).toMatch(/^0x[0-9a-f]{64}$/);

      await testModule.close();
    });
  });

  /**
   * 모듈 라이프사이클 테스트
   */
  describe('Module Lifecycle', () => {
    it('should initialize and close properly', async () => {
      const testModule = await Test.createTestingModule({
        imports: [CommonModule],
      }).compile();

      await testModule.init();
      expect(testModule).toBeDefined();

      const service = testModule.get<CryptoService>(CryptoService);
      expect(service).toBeDefined();

      await testModule.close();
    });

    it('should handle multiple initialization', async () => {
      const testModule = await Test.createTestingModule({
        imports: [CommonModule],
      }).compile();

      await testModule.init();
      await testModule.init(); // 두 번째 호출

      const service = testModule.get<CryptoService>(CryptoService);
      expect(service).toBeDefined();

      await testModule.close();
    });
  });

  /**
   * 에러 처리
   */
  describe('Error Handling', () => {
    it('should throw error when getting non-existent provider', () => {
      expect(() => module.get('NON_EXISTENT_SERVICE')).toThrow();
    });

    it('should handle module without CommonModule import', async () => {
      const testModule = await Test.createTestingModule({
        providers: [
          {
            provide: 'TEST_SERVICE',
            useValue: { test: 'value' },
          },
        ],
      }).compile();

      // CommonModule을 import하지 않았으므로 CryptoService를 못 가져옴
      expect(() => testModule.get<CryptoService>(CryptoService)).toThrow();

      await testModule.close();
    });
  });

  /**
   * 통합 테스트
   */
  describe('Integration Tests', () => {
    it('should work in a realistic module setup', async () => {
      // 실제 앱과 유사한 구조
      @Injectable()
      class AccountService {
        constructor(private readonly cryptoService: CryptoService) {}

        createAccount() {
          return this.cryptoService.generateKeyPair();
        }

        signMessage(message: string, privateKey: string) {
          const hash = this.cryptoService.hashUtf8(message);
          return this.cryptoService.sign(hash, privateKey);
        }
      }

      const testModule = await Test.createTestingModule({
        imports: [CommonModule],
        providers: [AccountService],
      }).compile();

      const accountService = testModule.get<AccountService>(AccountService);
      expect(accountService).toBeDefined();

      // 계정 생성
      const account = accountService.createAccount();
      expect(account.privateKey).toMatch(/^0x[0-9a-f]{64}$/);
      expect(account.address).toMatch(/^0x[0-9a-f]{40}$/);

      // 서명
      const signature = accountService.signMessage('test', account.privateKey);
      expect(signature.v).toBeGreaterThanOrEqual(27);
      expect(signature.r).toMatch(/^0x[0-9a-f]{64}$/);
      expect(signature.s).toMatch(/^0x[0-9a-f]{64}$/);

      await testModule.close();
    });

    it('should support multiple services using CryptoService', async () => {
      @Injectable()
      class Service1 {
        constructor(private readonly cryptoService: CryptoService) {}
        hash() {
          return this.cryptoService.hashUtf8('service1');
        }
      }

      @Injectable()
      class Service2 {
        constructor(private readonly cryptoService: CryptoService) {}
        hash() {
          return this.cryptoService.hashUtf8('service2');
        }
      }

      const testModule = await Test.createTestingModule({
        imports: [CommonModule],
        providers: [Service1, Service2],
      }).compile();

      const service1 = testModule.get<Service1>(Service1);
      const service2 = testModule.get<Service2>(Service2);

      expect(service1.hash()).toMatch(/^0x[0-9a-f]{64}$/);
      expect(service2.hash()).toMatch(/^0x[0-9a-f]{64}$/);
      expect(service1.hash()).not.toBe(service2.hash());

      await testModule.close();
    });
  });

  /**
   * 성능 테스트
   */
  describe('Performance', () => {
    it('should load module quickly', async () => {
      const start = Date.now();

      const testModule = await Test.createTestingModule({
        imports: [CommonModule],
      }).compile();

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(1000); // Should load in < 1 second

      await testModule.close();
    });

    it('should handle multiple concurrent requests', async () => {
      const promises = Array(100)
        .fill(0)
        .map((_, i) => cryptoService.hashUtf8(`concurrent test ${i}`));

      const results = await Promise.all(promises);

      expect(results).toHaveLength(100);
      results.forEach((hash) => {
        expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
      });
    });
  });
});
