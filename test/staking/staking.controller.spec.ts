import { Test, TestingModule } from '@nestjs/testing';
import { StakingController } from '../../src/staking/staking.controller';
import { StakingService } from '../../src/staking/staking.service';

/**
 * StakingController 테스트
 *
 * 테스트 범위:
 * - API 엔드포인트 동작 확인
 * - 요청/응답 형식 검증
 */
describe('StakingController', () => {
  let controller: StakingController;
  let stakingService: jest.Mocked<StakingService>;

  beforeEach(async () => {
    const mockStakingService = {
      deposit: jest.fn().mockResolvedValue({
        hash: '0x1234567890abcdef',
        status: '0x1',
      }),
      setWithdrawalAddress: jest.fn().mockResolvedValue({
        hash: '0x1234567890abcdef',
        status: '0x1',
      }),
      requestWithdrawal: jest.fn().mockResolvedValue({
        hash: '0x1234567890abcdef',
        status: '0x1',
      }),
      getValidator: jest.fn().mockResolvedValue({
        validatorAddress: '0x742d35cc6634c0532925a3b844bc9e7595f0beb0',
        status: 'active_ongoing',
        stakedAmount: '0x1bc16d674ec8000000',
        withdrawalAddress: '0x8ba1f109551bd432803012645ac136ddd64dba72',
        activatedAt: '0',
        exitRequestedAt: '0',
        totalRewards: '0x0',
        slashedAmount: '0x0',
      }),
      getActiveValidators: jest.fn().mockResolvedValue([]),
      getStats: jest.fn().mockResolvedValue({
        totalStaked: '0x0',
        totalValidators: 0,
        activeValidators: 0,
      }),
      processWithdrawals: jest.fn().mockResolvedValue({
        hash: '0x1234567890abcdef',
        status: '0x1',
        processed: 0,
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StakingController],
      providers: [
        {
          provide: StakingService,
          useValue: mockStakingService,
        },
      ],
    }).compile();

    controller = module.get<StakingController>(StakingController);
    stakingService = module.get(StakingService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('deposit', () => {
    it('should call stakingService.deposit', async () => {
      const body = {
        privateKey:
          '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        amount: '0x1bc16d674ec8000000',
      };

      await controller.deposit(body);

      expect(stakingService.deposit).toHaveBeenCalledWith(
        body.privateKey,
        body.amount,
      );
    });
  });

  describe('setWithdrawalAddress', () => {
    it('should call stakingService.setWithdrawalAddress', async () => {
      const body = {
        privateKey:
          '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        withdrawalAddress: '0x8ba1f109551bd432803012645ac136ddd64dba72',
      };

      await controller.setWithdrawalAddress(body);

      expect(stakingService.setWithdrawalAddress).toHaveBeenCalledWith(
        body.privateKey,
        body.withdrawalAddress,
      );
    });
  });

  describe('requestWithdrawal', () => {
    it('should call stakingService.requestWithdrawal', async () => {
      const body = {
        privateKey:
          '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      };

      await controller.requestWithdrawal(body);

      expect(stakingService.requestWithdrawal).toHaveBeenCalledWith(
        body.privateKey,
      );
    });
  });

  describe('getValidator', () => {
    it('should call stakingService.getValidator', async () => {
      const address = '0x742d35cc6634c0532925a3b844bc9e7595f0beb0';

      await controller.getValidator(address);

      expect(stakingService.getValidator).toHaveBeenCalledWith(address);
    });
  });

  describe('getValidators', () => {
    it('should call stakingService.getActiveValidators', async () => {
      await controller.getValidators();

      expect(stakingService.getActiveValidators).toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('should call stakingService.getStats', async () => {
      await controller.getStats();

      expect(stakingService.getStats).toHaveBeenCalled();
    });
  });
});

