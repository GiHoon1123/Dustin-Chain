import { Test, TestingModule } from '@nestjs/testing';
import { BlockController } from '../../src/block/block.controller';
import { BlockService } from '../../src/block/block.service';
import { BlockProducer } from '../../src/block/producer/block.producer';
import { Block } from '../../src/block/entities/block.entity';
import { EMPTY_ROOT } from '../../src/common/constants/blockchain.constants';

/**
 * BlockController 테스트
 */
describe('BlockController', () => {
  let controller: BlockController;
  let blockService: jest.Mocked<BlockService>;
  let blockProducer: jest.Mocked<BlockProducer>;

  beforeEach(async () => {
    const mockBlockService = {
      getBlockByNumber: jest.fn(),
      getBlockByHash: jest.fn(),
      getLatestBlock: jest.fn(),
      getChainStats: jest.fn(),
    } as any;

    const mockBlockProducer = {
      getStats: jest.fn(),
      getStatus: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BlockController],
      providers: [
        {
          provide: BlockService,
          useValue: mockBlockService,
        },
        {
          provide: BlockProducer,
          useValue: mockBlockProducer,
        },
      ],
    }).compile();

    controller = module.get<BlockController>(BlockController);
    blockService = module.get(BlockService);
    blockProducer = module.get(BlockProducer);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getBlockByNumber', () => {
    it('블록 번호로 조회해야 함', async () => {
      const block = new Block(
        1,
        '0x' + '0'.repeat(64),
        Date.now(),
        '0x' + '0'.repeat(64),
        [],
        EMPTY_ROOT,
        EMPTY_ROOT,
        EMPTY_ROOT,
        '0x' + '1'.repeat(64),
      );

      blockService.getBlockByNumber.mockResolvedValue(block);

      const result = await controller.getBlockByNumber('1');

      expect(result).toBeDefined();
      expect(result.number).toBe('0x1'); // Hex string
    });

    it('잘못된 블록 번호를 거부해야 함', async () => {
      await expect(controller.getBlockByNumber('abc')).rejects.toThrow();
      await expect(controller.getBlockByNumber('-1')).rejects.toThrow();
    });

    it('블록이 없으면 에러를 발생시켜야 함', async () => {
      blockService.getBlockByNumber.mockResolvedValue(null);

      await expect(controller.getBlockByNumber('999')).rejects.toThrow();
    });
  });

  describe('getBlockByHash', () => {
    it('블록 해시로 조회해야 함', async () => {
      const hash = '0x' + '1'.repeat(64);
      const block = new Block(
        1,
        '0x' + '0'.repeat(64),
        Date.now(),
        '0x' + '0'.repeat(64),
        [],
        EMPTY_ROOT,
        EMPTY_ROOT,
        EMPTY_ROOT,
        hash,
      );

      blockService.getBlockByHash.mockResolvedValue(block);

      const result = await controller.getBlockByHash(hash);

      expect(result.hash).toBe(hash);
    });

    it('블록이 없으면 에러를 발생시켜야 함', async () => {
      const hash = '0x' + '1'.repeat(64);
      blockService.getBlockByHash.mockResolvedValue(null);

      await expect(controller.getBlockByHash(hash)).rejects.toThrow();
    });
  });

  describe('getLatestBlock', () => {
    it('최신 블록을 조회해야 함', async () => {
      const block = new Block(
        10,
        '0x' + '0'.repeat(64),
        Date.now(),
        '0x' + '0'.repeat(64),
        [],
        EMPTY_ROOT,
        EMPTY_ROOT,
        EMPTY_ROOT,
        '0x' + '1'.repeat(64),
      );

      blockService.getLatestBlock.mockResolvedValue(block);

      const result = await controller.getLatestBlock();

      expect(result).toBeDefined();
      expect(result.number).toBe('0xa'); // Hex string
    });

    it('블록이 없으면 에러를 발생시켜야 함', async () => {
      blockService.getLatestBlock.mockResolvedValue(null);

      await expect(controller.getLatestBlock()).rejects.toThrow();
    });
  });

  describe('getChainStats', () => {
    it('체인 통계를 조회해야 함', async () => {
      const stats = {
        height: 100,
        latestBlockNumber: 99,
        latestBlockHash: '0x' + '1'.repeat(64),
        totalTransactions: 500,
        genesisProposer: '0x' + '1'.repeat(40),
      };

      blockService.getChainStats.mockResolvedValue(stats);

      const result = await controller.getChainStats();

      expect(result).toEqual(stats);
    });
  });

  describe('getProducerStatus', () => {
    it('Producer 상태를 조회해야 함', () => {
      const status = {
        isRunning: true,
        genesisTime: new Date().toISOString(),
        currentSlot: 100,
        blockTime: 12,
      };

      blockProducer.getStatus.mockReturnValue(status);

      const result = controller.getProducerStatus();

      expect(result).toEqual(status);
    });
  });

  describe('startMining', () => {
    it('블록 생성을 시작해야 함', () => {
      const status = {
        isRunning: true,
        genesisTime: new Date().toISOString(),
        currentSlot: 100,
        blockTime: 12,
      };

      blockProducer.getStatus.mockReturnValue(status);

      const result = controller.startMining();

      expect(blockProducer.start).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.status).toEqual(status);
    });
  });

  describe('stopMining', () => {
    it('블록 생성을 중지해야 함', () => {
      const status = {
        isRunning: false,
        genesisTime: new Date().toISOString(),
        currentSlot: 100,
        blockTime: 12,
      };

      blockProducer.getStatus.mockReturnValue(status);

      const result = controller.stopMining();

      expect(blockProducer.stop).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.status).toEqual(status);
    });
  });
});

