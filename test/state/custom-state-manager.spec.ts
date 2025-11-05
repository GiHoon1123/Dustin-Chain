import { Test, TestingModule } from '@nestjs/testing';
import { Account as EthAccount, createAccount } from '@ethereumjs/util';
import { CustomStateManager } from '../../src/state/custom-state-manager';
import { StateManager } from '../../src/state/state-manager';
import { IStateRepository } from '../../src/storage/repositories/state.repository.interface';
import { CryptoService } from '../../src/common/crypto/crypto.service';
import { EMPTY_HASH, EMPTY_ROOT } from '../../src/common/constants/blockchain.constants';
import { Account } from '../../src/account/entities/account.entity';

/**
 * CustomStateManager 테스트
 *
 * 테스트 범위:
 * - 계정 조회/설정
 * - Checkpoint/Revert
 * - 코드 조회/설정
 * - 스토리지 조회/설정
 */
describe('CustomStateManager', () => {
  let service: CustomStateManager;
  let stateManager: jest.Mocked<StateManager>;
  let stateRepository: jest.Mocked<IStateRepository>;
  let cryptoService: jest.Mocked<CryptoService>;

  beforeEach(async () => {
    const mockStateManager = {
      getAccount: jest.fn(),
      setAccount: jest.fn(),
    } as any;

    const mockStateRepository = {
      getAccount: jest.fn(),
      saveAccount: jest.fn(),
    } as any;

    const mockCryptoService = {
      hexToBytes: jest.fn((hex: string) => {
        const stripped = hex.startsWith('0x') ? hex.slice(2) : hex;
        if (stripped.length === 0) return new Uint8Array(0);
        return new Uint8Array(Buffer.from(stripped, 'hex'));
      }),
      bytesToHex: jest.fn((bytes: Uint8Array) => {
        if (bytes.length === 0) return '0x';
        return '0x' + Buffer.from(bytes).toString('hex');
      }),
      hashBuffer: jest.fn((buffer: Buffer) => {
        return '0x' + 'h'.repeat(64);
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: StateManager,
          useValue: mockStateManager,
        },
        {
          provide: IStateRepository,
          useValue: mockStateRepository,
        },
        {
          provide: CryptoService,
          useValue: mockCryptoService,
        },
        CustomStateManager,
      ],
    }).compile();

    service = module.get<CustomStateManager>(CustomStateManager);
    stateManager = module.get(StateManager);
    stateRepository = module.get(IStateRepository);
    cryptoService = module.get(CryptoService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('계정 조회', () => {
    it('계정을 조회해야 함', async () => {
      const address = '0x' + '1'.repeat(40);
      const account = new Account(address);
      account.balance = 1000n;
      account.nonce = 5;

      stateManager.getAccount.mockResolvedValue(account);

      const ethAccount = await service.getAccount(address);

      expect(ethAccount).toBeInstanceOf(EthAccount);
      expect(ethAccount.balance).toBe(BigInt(1000));
      expect(ethAccount.nonce).toBe(BigInt(5));
    });

    it('계정이 없으면 빈 계정을 반환해야 함', async () => {
      const address = '0x' + '1'.repeat(40);

      stateManager.getAccount.mockResolvedValue(null);
      cryptoService.hexToBytes.mockReturnValue(new Uint8Array(32).fill(0));

      const ethAccount = await service.getAccount(address);

      expect(ethAccount).toBeInstanceOf(EthAccount);
      expect(ethAccount.balance).toBe(BigInt(0));
      expect(ethAccount.nonce).toBe(BigInt(0));
    });
  });

  describe('계정 설정', () => {
    it('계정을 설정해야 함', async () => {
      const address = '0x' + '1'.repeat(40);
      const ethAccount = createAccount({
        nonce: 0n,
        balance: 0n,
      });

      await service.putAccount(address, ethAccount);

      expect(stateManager.setAccount).toHaveBeenCalled();
    });
  });

  describe('Checkpoint/Revert', () => {
    it('Checkpoint를 생성해야 함', async () => {
      stateManager.checkpoint = jest.fn().mockResolvedValue(undefined);

      await service.checkpoint();

      expect(stateManager.checkpoint).toHaveBeenCalled();
    });

    it('Checkpoint를 복구해야 함', async () => {
      stateManager.revertCheckpoint = jest.fn().mockResolvedValue(undefined);

      await service.revert();

      expect(stateManager.revertCheckpoint).toHaveBeenCalled();
    });
  });

  describe('코드 조회/설정', () => {
    it('코드를 조회해야 함', async () => {
      const address = '0x' + '1'.repeat(40);
      
      // kv DB 모킹
      (service as any).kv = {
        get: jest.fn().mockResolvedValue(undefined),
      };

      const code = await service.getCode(address);

      expect(code).toBeInstanceOf(Uint8Array);
    });

    it('코드를 설정해야 함', async () => {
      const address = '0x' + '1'.repeat(40);
      const codeBytes = new Uint8Array([0x60, 0x80, 0x60, 0x40]);

      // kv DB 모킹
      (service as any).kv = {
        put: jest.fn().mockResolvedValue(undefined),
      };
      
      // cryptoService에 hashBuffer 추가
      cryptoService.hashBuffer = jest.fn().mockReturnValue('0x' + 'h'.repeat(64));

      await service.putCode(address, codeBytes);

      expect((service as any).kv.put).toHaveBeenCalled();
    });
  });

  describe('스토리지 조회/설정', () => {
    it('스토리지를 조회해야 함', async () => {
      const address = '0x' + '1'.repeat(40);
      const key = Buffer.from('0'.repeat(32), 'hex');

      // kv DB 모킹
      (service as any).kv = {
        get: jest.fn().mockResolvedValue(''),
      };

      const value = await service.getContractStorage(address, key);

      expect(value).toBeInstanceOf(Uint8Array);
    });

    it('스토리지를 설정해야 함', async () => {
      const address = '0x' + '1'.repeat(40);
      const key = Buffer.from('0'.repeat(32), 'hex');
      const value = Buffer.from('1'.repeat(32), 'hex');

      // kv DB 모킹
      (service as any).kv = {
        put: jest.fn().mockResolvedValue(undefined),
        get: jest.fn().mockResolvedValue(null),
      };
      
      const account = new Account(address);
      account.storageRoot = EMPTY_ROOT;
      stateManager.getAccount.mockResolvedValue(account);
      (stateManager.setAccount as any) = jest.fn().mockResolvedValue(undefined);
      cryptoService.hashBuffer.mockReturnValue('0x' + 'h'.repeat(64));

      await service.putContractStorage(address, key, value);

      expect((service as any).kv.put).toHaveBeenCalled();
    });
  });

  describe('주소 정규화 (Private 메서드)', () => {
    it('문자열 주소를 정규화해야 함', () => {
      const address = '0x' + '1'.repeat(40);
      const normalized = (service as any).normalizeAddress(address);

      expect(normalized).toBe(address);
    });

    it('Uint8Array 주소를 정규화해야 함', () => {
      const addressBytes = new Uint8Array(20).fill(1);
      cryptoService.bytesToHex.mockReturnValue('0x' + '1'.repeat(40));

      const normalized = (service as any).normalizeAddress(addressBytes);

      expect(normalized).toBe('0x' + '1'.repeat(40));
    });

    it('Buffer 주소를 정규화해야 함', () => {
      const addressBuffer = Buffer.from('1'.repeat(40), 'hex');
      cryptoService.bytesToHex.mockReturnValue('0x' + '1'.repeat(40));

      const normalized = (service as any).normalizeAddress(addressBuffer);

      expect(normalized).toBe('0x' + '1'.repeat(40));
    });
  });

  describe('Private 메서드 테스트 (any 캐스팅)', () => {
    it('계정 코드를 조회해야 함', async () => {
      const address = '0x' + '1'.repeat(40);
      
      // kv DB 모킹
      (service as any).kv = {
        get: jest.fn().mockResolvedValue(undefined),
      };

      const code = await (service as any).getContractCode(address);

      expect(code).toBeInstanceOf(Uint8Array);
    });

    it('계정 코드를 설정해야 함', async () => {
      const address = '0x' + '1'.repeat(40);
      const codeBytes = new Uint8Array([0x60, 0x80, 0x60, 0x40]);

      // kv DB 모킹
      (service as any).kv = {
        put: jest.fn().mockResolvedValue(undefined),
      };
      
      cryptoService.hashBuffer.mockReturnValue('0x' + 'h'.repeat(64));
      stateManager.getAccount.mockResolvedValue(new Account(address));

      await (service as any).putContractCode(address, codeBytes);

      expect((service as any).kv.put).toHaveBeenCalled();
    });

    it('EVM 계정으로 변환해야 함', async () => {
      const address = '0x' + '1'.repeat(40);
      const account = new Account(address);
      account.balance = 1000n;
      account.nonce = 5;

      stateManager.getAccount.mockResolvedValue(account);
      stateManager.setAccount = jest.fn().mockResolvedValue(undefined);

      const ethAccount = await (service as any).getAccount(address);

      expect(ethAccount).toBeInstanceOf(require('@ethereumjs/util').Account);
    });

    it('우리 계정으로 변환해야 함', () => {
      const address = '0x' + '1'.repeat(40);
      const ethAccount = createAccount({
        nonce: 5n,
        balance: 1000n,
      });

      const ourAccount = (service as any).toOurAccount(address, ethAccount);

      expect(ourAccount).toBeInstanceOf(Account);
      expect(ourAccount.nonce).toBe(5);
      expect(ourAccount.balance).toBe(1000n);
    });

    it('EVM 계정으로 변환해야 함 (toEthAccount)', async () => {
      const address = '0x' + '1'.repeat(40);
      const account = new Account(address);
      account.balance = 1000n;
      account.nonce = 5;

      const ethAccount = (service as any).toEthAccount(account);

      expect(ethAccount).toBeInstanceOf(require('@ethereumjs/util').Account);
      expect(ethAccount.balance).toBe(BigInt(1000));
      expect(ethAccount.nonce).toBe(BigInt(5));
    });
  });
});

