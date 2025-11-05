import { Test, TestingModule } from '@nestjs/testing';
import { ValidatorController } from '../../src/validator/validator.controller';
import { ValidatorService } from '../../src/validator/validator.service';
import { Validator } from '../../src/validator/entities/validator.entity';

/**
 * ValidatorController 테스트
 */
describe('ValidatorController', () => {
  let controller: ValidatorController;
  let validatorService: jest.Mocked<ValidatorService>;

  beforeEach(async () => {
    const mockValidatorService = {
      getAllValidators: jest.fn(),
      getStats: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ValidatorController],
      providers: [
        {
          provide: ValidatorService,
          useValue: mockValidatorService,
        },
      ],
    }).compile();

    controller = module.get<ValidatorController>(ValidatorController);
    validatorService = module.get(ValidatorService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getValidators', () => {
    it('모든 Validator를 조회해야 함', async () => {
      const validators = [
        new Validator('0x' + '1'.repeat(40)),
        new Validator('0x' + '2'.repeat(40)),
      ];

      validatorService.getAllValidators.mockResolvedValue(validators);

      const result = await controller.getValidators();

      expect(result.total).toBe(2);
      expect(result.validators).toHaveLength(2);
    });
  });

  describe('getStats', () => {
    it('통계를 조회해야 함', async () => {
      const stats = {
        total: 256,
        active: 256,
        inactive: 0,
        committeeSize: 128,
      };

      validatorService.getStats.mockResolvedValue(stats);

      const result = await controller.getStats();

      expect(result).toEqual(stats);
    });
  });
});

