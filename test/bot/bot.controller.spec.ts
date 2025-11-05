import { Test, TestingModule } from '@nestjs/testing';
import { BotController } from '../../src/bot/bot.controller';
import { TransactionBotService } from '../../src/bot/transaction-bot.service';

/**
 * BotController 테스트
 */
describe('BotController', () => {
  let controller: BotController;
  let botService: jest.Mocked<TransactionBotService>;

  beforeEach(async () => {
    const mockBotService = {
      start: jest.fn(),
      stop: jest.fn(),
      getStatus: jest.fn(),
      getStats: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BotController],
      providers: [
        {
          provide: TransactionBotService,
          useValue: mockBotService,
        },
      ],
    }).compile();

    controller = module.get<BotController>(BotController);
    botService = module.get(TransactionBotService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getStatus', () => {
    it('봇 상태를 조회해야 함', () => {
      const status = {
        isRunning: true,
        accountCount: 156,
        minBalance: '1000000000000000000',
        targetRate: '0.4-0.5 tx/sec',
        totalTransactions: 1000,
        contractDeployments: 10,
      };

      botService.getStatus.mockReturnValue(status);

      const result = controller.getStatus();

      expect(result).toEqual(status);
    });
  });

  describe('start', () => {
    it('봇을 시작해야 함', () => {
      controller.start();

      expect(botService.start).toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    it('봇을 중지해야 함', () => {
      controller.stop();

      expect(botService.stop).toHaveBeenCalled();
    });
  });

});

