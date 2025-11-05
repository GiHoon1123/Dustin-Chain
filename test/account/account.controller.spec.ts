import { Test, TestingModule } from '@nestjs/testing';
import { AccountController } from '../../src/account/account.controller';
import { AccountService } from '../../src/account/account.service';
import { CryptoService } from '../../src/common/crypto/crypto.service';
import { Account } from '../../src/account/entities/account.entity';

/**
 * AccountController 테스트
 */
describe('AccountController', () => {
  let controller: AccountController;
  let accountService: jest.Mocked<AccountService>;
  let cryptoService: jest.Mocked<CryptoService>;

  beforeEach(async () => {
    const mockAccountService = {
      getOrCreateAccount: jest.fn(),
      getAccount: jest.fn(),
      getBalance: jest.fn(),
      addBalance: jest.fn(),
    } as any;

    const mockCryptoService = {
      generateKeyPair: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AccountController],
      providers: [
        {
          provide: AccountService,
          useValue: mockAccountService,
        },
        {
          provide: CryptoService,
          useValue: mockCryptoService,
        },
      ],
    }).compile();

    controller = module.get<AccountController>(AccountController);
    accountService = module.get(AccountService);
    cryptoService = module.get(CryptoService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createWallet', () => {
    it('지갑을 생성해야 함', async () => {
      const keyPair = {
        privateKey: '0x' + '1'.repeat(64),
        publicKey: '0x' + '2'.repeat(128),
        address: '0x' + '3'.repeat(40),
      };

      const account = new Account(keyPair.address);

      cryptoService.generateKeyPair.mockReturnValue(keyPair);
      accountService.getOrCreateAccount.mockResolvedValue(account);

      const result = await controller.createWallet();

      expect(result).toHaveProperty('privateKey');
      expect(result).toHaveProperty('address');
      expect(result.address).toBe(keyPair.address);
    });
  });

  describe('getAccount', () => {
    it('계정을 조회해야 함', async () => {
      const address = '0x' + '1'.repeat(40);
      const account = new Account(address);
      account.balance = 1000n;

      accountService.getOrCreateAccount.mockResolvedValue(account);

      const result = await controller.getAccount(address);

      expect(result.address).toBe(address);
      expect(result.balance).toBe('0x3e8');
    });
  });

  describe('addBalance', () => {
    it('잔액을 추가해야 함', async () => {
      const address = '0x' + '1'.repeat(40);
      const amount = '1000000000000000000';

      accountService.getBalance.mockResolvedValue(BigInt(amount));

      const result = await controller.addBalance({
        address,
        amount,
      });

      expect(result.success).toBe(true);
      expect(result.address).toBe(address);
      expect(accountService.addBalance).toHaveBeenCalledWith(
        address,
        BigInt(amount),
      );
    });
  });
});

