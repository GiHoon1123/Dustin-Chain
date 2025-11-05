import { Test, TestingModule } from '@nestjs/testing';
import { ConsensusController } from '../../src/consensus/consensus.controller';
import { ConsensusService } from '../../src/consensus/consensus.service';

/**
 * ConsensusController 테스트
 */
describe('ConsensusController', () => {
  let controller: ConsensusController;
  let consensusService: jest.Mocked<ConsensusService>;

  beforeEach(async () => {
    const mockConsensusService = {
      getStats: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConsensusController],
      providers: [
        {
          provide: ConsensusService,
          useValue: mockConsensusService,
        },
      ],
    }).compile();

    controller = module.get<ConsensusController>(ConsensusController);
    consensusService = module.get(ConsensusService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getStats', () => {
    it('통계를 조회해야 함', async () => {
      const stats = {
        genesisTime: new Date().toISOString(),
        currentSlot: 100,
        currentEpoch: 3,
        epochStartSlot: 96,
        epochEndSlot: 127,
        slotsPerEpoch: 32,
      };

      consensusService.getStats.mockReturnValue(stats);

      const result = await controller.getStats();

      expect(result).toEqual(stats);
    });
  });
});

