import { Test, TestingModule } from '@nestjs/testing';
import { StablecoinController } from '../../src/contract/stablecoin.controller';
import { StablecoinService } from '../../src/contract/stablecoin.service';

/**
 * StablecoinController 테스트
 */
describe('StablecoinController', () => {
  let controller: StablecoinController;
  let stablecoinService: jest.Mocked<StablecoinService>;

  beforeEach(async () => {
    const mockStablecoinService = {
      depositCollateral: jest.fn(),
      mintStablecoin: jest.fn(),
      redeemStablecoin: jest.fn(),
      withdrawCollateral: jest.fn(),
      liquidate: jest.fn(),
      getPosition: jest.fn(),
      isHealthy: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StablecoinController],
      providers: [
        {
          provide: StablecoinService,
          useValue: mockStablecoinService,
        },
      ],
    }).compile();

    controller = module.get<StablecoinController>(StablecoinController);
    stablecoinService = module.get(StablecoinService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('depositCollateral', () => {
    it('담보를 예치해야 함', async () => {
      const request = {
        privateKey: '0x' + '1'.repeat(64),
        amount: '0x3635c9adc5dea00000', // 1000 DSTN
      };
      const response = {
        hash: '0x' + 'h'.repeat(64),
        status: 'pending',
      };

      stablecoinService.depositCollateral.mockResolvedValue(response);

      const result = await controller.depositCollateral(request);

      expect(result).toEqual(response);
      expect(stablecoinService.depositCollateral).toHaveBeenCalledWith(
        request.privateKey,
        request.amount,
      );
    });
  });

  describe('mintStablecoin', () => {
    it('스테이블코인을 발행해야 함', async () => {
      const request = {
        privateKey: '0x' + '1'.repeat(64),
        stablecoinAmount: '0x1b1ae4d6e2ef500000', // 500 DSTN
      };
      const response = {
        hash: '0x' + 'h'.repeat(64),
        status: 'pending',
      };

      stablecoinService.mintStablecoin.mockResolvedValue(response);

      const result = await controller.mintStablecoin(request);

      expect(result).toEqual(response);
      expect(stablecoinService.mintStablecoin).toHaveBeenCalledWith(
        request.privateKey,
        request.stablecoinAmount,
      );
    });
  });

  describe('redeemStablecoin', () => {
    it('스테이블코인을 상환해야 함', async () => {
      const request = {
        privateKey: '0x' + '1'.repeat(64),
        stablecoinAmount: '0x2c68af0bb1400000000', // 200 DSTN
      };
      const response = {
        hash: '0x' + 'h'.repeat(64),
        status: 'pending',
      };

      stablecoinService.redeemStablecoin.mockResolvedValue(response);

      const result = await controller.redeemStablecoin(request);

      expect(result).toEqual(response);
      expect(stablecoinService.redeemStablecoin).toHaveBeenCalledWith(
        request.privateKey,
        request.stablecoinAmount,
      );
    });
  });

  describe('withdrawCollateral', () => {
    it('담보를 인출해야 함', async () => {
      const request = {
        privateKey: '0x' + '1'.repeat(64),
        amount: '0x56bc75e2d63100000', // 100 DSTN
      };
      const response = {
        hash: '0x' + 'h'.repeat(64),
        status: 'pending',
      };

      stablecoinService.withdrawCollateral.mockResolvedValue(response);

      const result = await controller.withdrawCollateral(request);

      expect(result).toEqual(response);
      expect(stablecoinService.withdrawCollateral).toHaveBeenCalledWith(
        request.privateKey,
        request.amount,
      );
    });
  });

  describe('liquidate', () => {
    it('청산을 실행해야 함', async () => {
      const request = {
        privateKey: '0x' + '1'.repeat(64),
        userAddress: '0x' + '3'.repeat(40),
      };
      const response = {
        hash: '0x' + 'h'.repeat(64),
        status: 'pending',
      };

      stablecoinService.liquidate.mockResolvedValue(response);

      const result = await controller.liquidate(request);

      expect(result).toEqual(response);
      expect(stablecoinService.liquidate).toHaveBeenCalledWith(
        request.privateKey,
        request.userAddress,
      );
    });
  });

  describe('getPosition', () => {
    it('포지션을 조회해야 함', async () => {
      const userAddress = '0x' + '3'.repeat(40);
      const response = {
        collateralAmount: '0x' + '0'.repeat(24) + '3635c9adc5dea00000',
        debtAmount: '0x' + '0'.repeat(24) + '1b1ae4d6e2ef500000',
        collateralRatio: '0x' + '0'.repeat(24) + '30d40',
      };

      stablecoinService.getPosition.mockResolvedValue(response);

      const result = await controller.getPosition(userAddress);

      expect(result).toEqual(response);
      expect(stablecoinService.getPosition).toHaveBeenCalledWith(userAddress);
    });
  });

  describe('getHealth', () => {
    it('건강도를 확인해야 함', async () => {
      const userAddress = '0x' + '3'.repeat(40);
      const response = {
        result: '0x0000000000000000000000000000000000000000000000000000000000000001',
      };

      stablecoinService.isHealthy.mockResolvedValue(response.result);

      const result = await controller.getHealth(userAddress);

      expect(result).toEqual(response);
      expect(stablecoinService.isHealthy).toHaveBeenCalledWith(userAddress);
    });
  });
});

