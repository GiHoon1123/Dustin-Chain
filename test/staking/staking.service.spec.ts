import { Test, TestingModule } from '@nestjs/testing';
import { AccountService } from '../../src/account/account.service';
import { ContractService } from '../../src/contract/contract.service';
import { StakingService } from '../../src/staking/staking.service';

/**
 * StakingService 테스트
 *
 * 테스트 범위:
 * - 스테이킹 예치 (deposit)
 * - 출금 주소 설정 (setWithdrawalAddress)
 * - 출금 요청 (requestWithdrawal)
 * - Validator 정보 조회 (getValidator, getActiveValidators)
 * - 통계 조회 (getStats)
 */
describe('StakingService', () => {
  let service: StakingService;
  let contractService: jest.Mocked<ContractService>;
  let accountService: jest.Mocked<AccountService>;

  const mockStakingAddress = '0x4594d2bc7bc272109ab1a44358e9dfef35cd60a2';
  const mockPrivateKey =
    '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  const mockAddress = '0x742d35cc6634c0532925a3b844bc9e7595f0beb0';
  const mockWithdrawalAddress = '0x8ba1f109551bd432803012645ac136ddd64dba72';

  beforeEach(async () => {
    // ContractService 모킹
    const mockContractService = {
      getDeployedContracts: jest.fn().mockReturnValue({
        staking: {
          address: mockStakingAddress,
          txHash: '0x1234567890abcdef',
        },
      }),
      getGenesisAccount0: jest.fn().mockReturnValue({
        address: mockAddress,
        privateKey: mockPrivateKey,
        index: 0,
        publicKey: '0x1234',
      }),
      encodeFunctionCall: jest.fn().mockReturnValue('0x12345678'),
      executeContractByUser: jest.fn().mockResolvedValue({
        hash: '0xabcdef1234567890',
        status: '0x1',
      }),
      waitForTransaction: jest.fn().mockResolvedValue(true),
      getTransactionReceipt: jest.fn().mockResolvedValue({
        logs: [],
        status: '0x1',
      }),
      callContract: jest.fn().mockResolvedValue({
        result: '0x' + '0'.repeat(512),
        gasUsed: '0x0',
      }),
    } as any;

    // AccountService 모킹
    const mockAccountService = {
      getBalance: jest.fn().mockResolvedValue('0x1bc16d674ec8000000'), // 32 DSTN
      getNonce: jest.fn().mockResolvedValue(0),
      incrementNonce: jest.fn().mockResolvedValue(undefined),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StakingService,
        {
          provide: ContractService,
          useValue: mockContractService,
        },
        {
          provide: AccountService,
          useValue: mockAccountService,
        },
      ],
    }).compile();

    service = module.get<StakingService>(StakingService);
    contractService = module.get(ContractService);
    accountService = module.get(AccountService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('deposit', () => {
    it('should deposit successfully', async () => {
      const amount = '0x1bc16d674ec8000000'; // 32 DSTN

      const result = await service.deposit(mockPrivateKey, amount);

      expect(result).toBeDefined();
      expect(result.hash).toBeDefined();
      expect(contractService.encodeFunctionCall).toHaveBeenCalled();
      expect(contractService.executeContractByUser).toHaveBeenCalled();
    });

    it('should throw error if StakingContract is not deployed', async () => {
      contractService.getDeployedContracts = jest.fn().mockReturnValue({});

      await expect(
        service.deposit(mockPrivateKey, '0x1bc16d674ec8000000'),
      ).rejects.toThrow('StakingContract is not deployed');
    });
  });

  describe('setWithdrawalAddress', () => {
    it('should set withdrawal address successfully', async () => {
      const result = await service.setWithdrawalAddress(
        mockPrivateKey,
        mockWithdrawalAddress,
      );

      expect(result).toBeDefined();
      expect(result.hash).toBeDefined();
      expect(contractService.encodeFunctionCall).toHaveBeenCalledWith(
        'setWithdrawalAddress',
        ['address'],
        [mockWithdrawalAddress],
      );
    });
  });

  describe('requestWithdrawal', () => {
    it('should request withdrawal successfully', async () => {
      const result = await service.requestWithdrawal(mockPrivateKey);

      expect(result).toBeDefined();
      expect(result.hash).toBeDefined();
      expect(contractService.encodeFunctionCall).toHaveBeenCalledWith(
        'requestWithdrawal',
        [],
        [],
      );
    });
  });

  describe('getStats', () => {
    it('should return staking stats', async () => {
      // callContract를 여러 번 호출하도록 모킹
      // getStats는 여러 개의 callContract를 호출하므로 각각 모킹
      contractService.callContract = jest
        .fn()
        .mockResolvedValueOnce({
          result: '0x' + '0'.repeat(64) + '000000000000000000000000000000000000000000000001bc16d674ec800000',
          gasUsed: '0x0',
        }) // totalStaked
        .mockResolvedValueOnce({
          result: '0x' + '0'.repeat(64) + '0000000000000000000000000000000000000000000000000000000000000005',
          gasUsed: '0x0',
        }) // totalValidators
        .mockResolvedValueOnce({
          result: '0x' + '0'.repeat(64) + '0000000000000000000000000000000000000000000000000000000000000003',
          gasUsed: '0x0',
        }) // activeValidators
        .mockResolvedValueOnce({
          result: '0x' + '0'.repeat(64) + '000000000000000000000000000000000000000000000001bc16d674ec800000',
          gasUsed: '0x0',
        }) // minStake
        .mockResolvedValueOnce({
          result: '0x' + '0'.repeat(64) + '0000000000000000000000000000000000000000000000000000000000000064',
          gasUsed: '0x0',
        }) // maxValidators
        .mockResolvedValueOnce({
          result: '0x' + '0'.repeat(64) + '000000000000000000000000000000000000000000000000000000000000003c',
          gasUsed: '0x0',
        }); // withdrawalDelay

      const stats = await service.getStats();

      expect(stats).toBeDefined();
      expect(stats.totalStaked).toBeDefined();
      expect(stats.totalValidators).toBeDefined();
      expect(stats.activeValidators).toBeDefined();
    });
  });
});
