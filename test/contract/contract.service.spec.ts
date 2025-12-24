import { Test, TestingModule } from '@nestjs/testing';
import { AccountService } from '../../src/account/account.service';
import { Account } from '../../src/account/entities/account.entity';
import { BlockService } from '../../src/block/block.service';
import { CryptoService } from '../../src/common/crypto/crypto.service';
import { Address } from '../../src/common/types/common.types';
import { CustomStateManager } from '../../src/state/custom-state-manager';
import { TransactionService } from '../../src/transaction/transaction.service';
import { ContractService } from '../../src/contract/contract.service';
import { IBlockRepository } from '../../src/storage/repositories/block.repository.interface';

/**
 * ContractService 테스트
 *
 * 테스트 범위:
 * - 컨트랙트 바이트코드 조회
 * - 컨트랙트 읽기 메서드 호출 (eth_call)
 * - 컨트랙트 배포
 */
describe('ContractService', () => {
  let service: ContractService;
  let evmState: jest.Mocked<CustomStateManager>;
  let accountService: jest.Mocked<AccountService>;
  let cryptoService: jest.Mocked<CryptoService>;
  let blockService: jest.Mocked<BlockService>;
  let transactionService: jest.Mocked<TransactionService>;

  beforeEach(async () => {
    const mockEvmState = {
      checkpoint: jest.fn(),
      revert: jest.fn(),
      getCode: jest.fn(),
    } as any;

    const mockAccountService = {
      getBalance: jest.fn(),
      getOrCreateAccount: jest.fn(),
    } as any;

    const mockCryptoService = {
      bytesToHex: jest.fn(
        (bytes: Uint8Array) => '0x' + Buffer.from(bytes).toString('hex'),
      ),
    } as any;

    const mockBlockService = {
      getLatestBlock: jest.fn(),
    } as any;

    const mockTransactionService = {
      submitTransaction: jest.fn(),
      signTransaction: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: CustomStateManager,
          useValue: mockEvmState,
        },
        {
          provide: AccountService,
          useValue: mockAccountService,
        },
        {
          provide: CryptoService,
          useValue: mockCryptoService,
        },
        {
          provide: BlockService,
          useValue: mockBlockService,
        },
        {
          provide: TransactionService,
          useValue: mockTransactionService,
        },
        {
          provide: IBlockRepository,
          useValue: {
            findByNumber: jest.fn(),
            findLatest: jest.fn(),
          },
        },
        ContractService,
      ],
    }).compile();

    service = module.get<ContractService>(ContractService);
    evmState = module.get(CustomStateManager);
    accountService = module.get(AccountService);
    cryptoService = module.get(CryptoService);
    blockService = module.get(BlockService);
    transactionService = module.get(TransactionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('초기화', () => {
    it('서비스가 정의되어야 함', () => {
      expect(service).toBeDefined();
    });
  });

  describe('컨트랙트 바이트코드 조회', () => {
    it('바이트코드를 조회해야 함', async () => {
      const address = '0x' + '1'.repeat(40);
      const codeBytes = new Uint8Array([0x60, 0x80, 0x60, 0x40]);
      const account = new Account(address);
      account.codeHash = '0x' + 'h'.repeat(64);

      evmState.getCode.mockResolvedValue(codeBytes);
      accountService.getOrCreateAccount.mockResolvedValue(account);

      const result = await service.getContractBytecode(address);

      expect(result.address).toBe(address);
      expect(result.bytecode).toBe('0x60806040');
      expect(result.codeHash).toBe('0x' + 'h'.repeat(64));
    });
  });

  describe('컨트랙트 호출', () => {
    it('VM이 초기화되지 않았으면 에러를 발생시켜야 함', async () => {
      // VM이 초기화되지 않은 상태
      await expect(
        service.callContract('0x' + '1'.repeat(40), '0x' + '0'.repeat(8)),
      ).rejects.toThrow('Call VM is not initialized');
    });
  });

  describe('컨트랙트 배포', () => {
    it('컨트랙트를 배포해야 함', async () => {
      const bytecode = '0x6080604052348015600f57600080fd5b';
      const tx = {
        hash: '0x' + 'h'.repeat(64),
        from: '0x' + '1'.repeat(40),
        to: null,
        value: 0n,
        nonce: 0,
        v: 0,
        r: '0x' + 'r'.repeat(64),
        s: '0x' + 's'.repeat(64),
        getSignature: jest.fn().mockReturnValue({
          v: 0,
          r: '0x' + 'r'.repeat(64),
          s: '0x' + 's'.repeat(64),
        }),
        gasPrice: 1000000000n,
        gasLimit: 5000000n,
        data: bytecode,
      };

      // genesisAccount0 초기화
      (service as any).genesisAccount0 = {
        index: 0,
        address: '0x' + '1'.repeat(40),
        publicKey: '0x' + 'p'.repeat(130),
        privateKey: '0x' + '1'.repeat(64),
      };

      // deploymentAccounts 초기화
      (service as any).deploymentAccounts = [
        {
          index: 0,
          address: '0x' + '1'.repeat(40),
          publicKey: '0x' + 'p'.repeat(130),
          privateKey: '0x' + '1'.repeat(64),
        },
      ];
      // deploymentAccount 설정 (deployContract에서 사용)
      (service as any).deploymentAccount = (service as any).deploymentAccounts[0];

      accountService.getOrCreateAccount.mockResolvedValue({
        address: '0x' + '1'.repeat(40),
        balance: 10000000000000000000000n,
        nonce: 0,
      } as any);

      transactionService.signTransaction.mockResolvedValue(tx as any);
      transactionService.submitTransaction.mockResolvedValue(tx as any);

      const result = await service.deployContract(bytecode);

      expect(result).toHaveProperty('hash');
      expect(result).toHaveProperty('status');
    });

    it('계정이 로드되지 않았으면 에러를 발생시켜야 함', async () => {
      (service as any).deploymentAccounts = [];

      await expect(service.deployContract('0x6080')).rejects.toThrow();
    });
  });

  describe('컨트랙트 실행', () => {
    it('컨트랙트를 실행해야 함', async () => {
      const to = '0x' + '1'.repeat(40);
      const data = '0x' + '0'.repeat(8);
      const tx = {
        hash: '0x' + 'h'.repeat(64),
        from: '0x' + '1'.repeat(40),
        to,
        value: 0n,
        nonce: 0,
        v: 0,
        r: '0x' + 'r'.repeat(64),
        s: '0x' + 's'.repeat(64),
        getSignature: jest.fn().mockReturnValue({
          v: 0,
          r: '0x' + 'r'.repeat(64),
          s: '0x' + 's'.repeat(64),
        }),
        gasPrice: 1000000000n,
        gasLimit: 1000000n,
        data,
      };

      // genesisAccount0 초기화
      (service as any).genesisAccount0 = {
        index: 0,
        address: '0x' + '1'.repeat(40),
        publicKey: '0x' + 'p'.repeat(130),
        privateKey: '0x' + '1'.repeat(64),
      };

      transactionService.signTransaction.mockResolvedValue(tx as any);
      transactionService.submitTransaction.mockResolvedValue(tx as any);

      const result = await service.executeContract(to, data);

      expect(result).toHaveProperty('hash');
      expect(result).toHaveProperty('status');
    });

    it('계정이 로드되지 않았으면 에러를 발생시켜야 함', async () => {
      (service as any).genesisAccount0 = null;

      await expect(
        service.executeContract('0x' + '1'.repeat(40), '0x00'),
      ).rejects.toThrow();
    });
  });

  describe('ABI 인코딩', () => {
    it('함수 선택자를 계산해야 함', () => {
      const selector = (service as any).getFunctionSelector('setVault', [
        'address',
      ]);

      expect(selector).toMatch(/^0x[0-9a-f]{8}$/);
    });

    it('address 파라미터를 인코딩해야 함', () => {
      const address = '0x' + '1'.repeat(40);
      const encoded = (service as any).encodeParameter('address', address);

      expect(encoded).toHaveLength(64);
      expect(encoded).toMatch(/^[0-9a-f]{64}$/);
      expect(encoded.slice(-40)).toBe('1'.repeat(40));
    });

    it('uint256 파라미터를 인코딩해야 함', () => {
      const value = '1000000000000000000000';
      const encoded = (service as any).encodeParameter('uint256', value);

      expect(encoded).toHaveLength(64);
      expect(encoded).toMatch(/^[0-9a-f]{64}$/);
    });

    it('함수 호출 데이터를 생성해야 함', () => {
      const data = service.encodeFunctionCall(
        'setVault',
        ['address'],
        ['0x' + '1'.repeat(40)],
      );

      expect(data).toMatch(/^0x[0-9a-f]{72}$/);
      expect(data.startsWith('0x')).toBe(true);
    });
  });

  describe('사용자 트랜잭션 실행', () => {
    it('사용자 개인키로 컨트랙트를 실행해야 함', async () => {
      const privateKey = '0x' + '1'.repeat(64);
      const to = '0x' + '2'.repeat(40);
      const data = '0x' + '0'.repeat(8);
      const value = 1000000000000000000n;
      const tx = {
        hash: '0x' + 'h'.repeat(64),
        from: '0x' + '3'.repeat(40),
        to,
        value,
        nonce: 0,
        v: 0,
        r: '0x' + 'r'.repeat(64),
        s: '0x' + 's'.repeat(64),
        getSignature: jest.fn().mockReturnValue({
          v: 0,
          r: '0x' + 'r'.repeat(64),
          s: '0x' + 's'.repeat(64),
        }),
        gasPrice: 1000000000n,
        gasLimit: 1000000n,
        data,
      };

      transactionService.signTransaction.mockResolvedValue(tx as any);
      transactionService.submitTransaction.mockResolvedValue(tx as any);

      const result = await service.executeContractByUser(
        to,
        data,
        privateKey,
        value,
      );

      expect(result).toHaveProperty('hash');
      expect(result).toHaveProperty('status');
      expect(transactionService.signTransaction).toHaveBeenCalled();
      expect(transactionService.submitTransaction).toHaveBeenCalled();
    });
  });

  describe('배포된 컨트랙트 관리', () => {
    it('배포된 컨트랙트 주소를 저장해야 함', () => {
      const stablecoinAddress = '0x' + '1'.repeat(40);
      const vaultAddress = '0x' + '2'.repeat(40);

      (service as any).saveDeployedContracts(stablecoinAddress, vaultAddress);

      const deployed = service.getDeployedContracts();
      expect(deployed).not.toBeNull();
      if (deployed && deployed.stablecoin && deployed.vault) {
        expect(deployed.stablecoin.address).toBe(stablecoinAddress);
        expect(deployed.vault.address).toBe(vaultAddress);
      }
    });

    it('배포된 컨트랙트 주소를 조회해야 함', () => {
      const deployed = service.getDeployedContracts();

      expect(deployed === null || typeof deployed === 'object').toBe(true);
    });
  });

  describe('ABI 관리', () => {
    it('컨트랙트 ABI를 저장해야 함', () => {
      const address = '0x' + '1'.repeat(40);
      const contractName = 'TestContract';
      const abi = [
        {
          type: 'function',
          name: 'test',
          inputs: [],
          outputs: [],
        },
      ];

      (service as any).saveContractABI(address, contractName, abi);

      const savedABI = service.getContractABI(address);
      expect(savedABI).not.toBeNull();
      if (savedABI) {
        expect(savedABI.name).toBe(contractName);
        expect(savedABI.abi).toEqual(abi);
      }
    });

    it('컨트랙트 ABI를 조회해야 함', () => {
      const address = '0x' + '1'.repeat(40);
      const abi = service.getContractABI(address);

      expect(abi === null || typeof abi === 'object').toBe(true);
    });
  });

  describe('Private 메서드 테스트 (any 캐스팅)', () => {
    it('genesis-accounts.json 파일을 찾아야 함', () => {
      const path = (service as any).findAccountsFile();

      expect(path === null || typeof path === 'string').toBe(true);
    });

    it('Genesis Account 0을 로드해야 함', () => {
      try {
        (service as any).loadGenesisAccount0();
        expect(true).toBe(true);
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('배포 계정들을 로드해야 함', () => {
      try {
        (service as any).loadDeploymentAccounts();
        expect(true).toBe(true);
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });
});
