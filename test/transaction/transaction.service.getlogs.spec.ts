import { Test, TestingModule } from '@nestjs/testing';
import { CryptoService } from '../../src/common/crypto/crypto.service';
import { IBlockRepository } from '../../src/storage/repositories/block.repository.interface';
import { BlockLevelDBRepository } from '../../src/storage/repositories/block-leveldb.repository';
import { TransactionService } from '../../src/transaction/transaction.service';
import { TransactionPool } from '../../src/transaction/pool/transaction.pool';
import { AccountService } from '../../src/account/account.service';
import { Block } from '../../src/block/entities/block.entity';
import { Transaction } from '../../src/transaction/entities/transaction.entity';
import { TransactionReceipt } from '../../src/transaction/entities/transaction-receipt.entity';

/**
 * TransactionService - getLogs 테스트
 *
 * 이더리움 표준:
 * - eth_getLogs RPC 메서드와 동일한 동작
 * - logsBloom을 활용한 빠른 필터링
 *
 * 테스트 항목:
 * 1. 빈 로그 반환 (블록 없음)
 * 2. 모든 로그 반환 (필터 없음)
 * 3. 블록 범위 필터링
 * 4. address 필터링
 * 5. topics 필터링
 * 6. 복합 필터링
 */
describe('TransactionService - getLogs', () => {
  let service: TransactionService;
  let blockRepository: jest.Mocked<IBlockRepository>;
  let cryptoService: jest.Mocked<CryptoService>;
  let levelDbRepo: jest.Mocked<BlockLevelDBRepository>;

  beforeEach(async () => {
    const mockBlockRepository = {
      findLatest: jest.fn(),
      findByNumber: jest.fn(),
      findByHash: jest.fn(),
    } as any;

    const mockCryptoService = {
      isInLogsBloom: jest.fn(),
    } as any;

    const mockLevelDbRepo = {
      findReceipt: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: IBlockRepository,
          useValue: mockBlockRepository,
        },
        {
          provide: CryptoService,
          useValue: mockCryptoService,
        },
        {
          provide: TransactionPool,
          useClass: TransactionPool,
        },
        {
          provide: AccountService,
          useValue: {},
        },
        TransactionService,
      ],
    }).compile();

    service = module.get<TransactionService>(TransactionService);
    blockRepository = module.get(IBlockRepository);
    cryptoService = module.get(CryptoService);
    levelDbRepo = blockRepository as any;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getLogs', () => {
    it('should return empty array when no blocks exist', async () => {
      blockRepository.findLatest = jest.fn().mockResolvedValue(null);

      const result = await service.getLogs('0x0', 'latest');

      expect(result).toEqual([]);
    });

    it('should return logs from single block', async () => {
      const mockReceipt = new TransactionReceipt(
        '0xtx1',
        0,
        '0xblock1',
        1,
        '0xfrom',
        '0xto',
        1,
        21000n,
        21000n,
      );
      mockReceipt.logs = [
        {
          address: '0xcontract1',
          topics: ['0xtopic1'],
          data: '0xdata1',
          blockNumber: 1,
          transactionHash: '0xtx1',
          transactionIndex: 0,
          blockHash: '0xblock1',
          logIndex: 0,
          removed: false,
        },
      ];
      mockReceipt.logsBloom = '0x' + '1'.repeat(512);

      const mockBlock = {
        number: 1,
        transactions: [
          {
            hash: '0xtx1',
          },
        ],
        getHeader: jest.fn().mockReturnValue({
          logsBloom: '0x' + '1'.repeat(512),
        }),
      } as any;

      blockRepository.findLatest = jest.fn().mockResolvedValue(mockBlock);
      blockRepository.findByNumber = jest.fn().mockResolvedValue(mockBlock);
      levelDbRepo.findReceipt = jest.fn().mockResolvedValue(mockReceipt);
      cryptoService.isInLogsBloom = jest.fn().mockReturnValue(true);

      const result = await service.getLogs('0x1', '0x1');

      expect(result).toHaveLength(1);
      expect(result[0].address).toBe('0xcontract1');
      expect(result[0].blockNumber).toBe('0x1');
    });

    it('should filter by block range', async () => {
      const mockBlock1 = {
        number: 1,
        transactions: [],
        getHeader: jest.fn().mockReturnValue({
          logsBloom: '0x' + '0'.repeat(512),
        }),
      } as any;

      const mockBlock2 = {
        number: 2,
        transactions: [],
        getHeader: jest.fn().mockReturnValue({
          logsBloom: '0x' + '0'.repeat(512),
        }),
      } as any;

      blockRepository.findLatest = jest.fn().mockResolvedValue(mockBlock2);
      blockRepository.findByNumber = jest
        .fn()
        .mockResolvedValueOnce(mockBlock1)
        .mockResolvedValueOnce(mockBlock2);

      const result = await service.getLogs('0x1', '0x2');

      expect(blockRepository.findByNumber).toHaveBeenCalledWith(1);
      expect(blockRepository.findByNumber).toHaveBeenCalledWith(2);
      expect(result).toEqual([]);
    });

    it('should filter by address using logsBloom', async () => {
      const address = '0xcontract1';
      const mockReceipt = new TransactionReceipt(
        '0xtx1',
        0,
        '0xblock1',
        1,
        '0xfrom',
        '0xto',
        1,
        21000n,
        21000n,
      );
      mockReceipt.logs = [
        {
          address,
          topics: [],
          data: '0x',
          blockNumber: 1,
          transactionHash: '0xtx1',
          transactionIndex: 0,
          blockHash: '0xblock1',
          logIndex: 0,
          removed: false,
        },
      ];
      mockReceipt.logsBloom = '0x' + '1'.repeat(512);

      const mockBlock = {
        number: 1,
        transactions: [{ hash: '0xtx1' }],
        getHeader: jest.fn().mockReturnValue({
          logsBloom: '0x' + '1'.repeat(512),
        }),
      } as any;

      blockRepository.findLatest = jest.fn().mockResolvedValue(mockBlock);
      blockRepository.findByNumber = jest.fn().mockResolvedValue(mockBlock);
      levelDbRepo.findReceipt = jest.fn().mockResolvedValue(mockReceipt);
      cryptoService.isInLogsBloom = jest
        .fn()
        .mockReturnValueOnce(true) // 블록 레벨 필터링
        .mockReturnValueOnce(true); // 로그 레벨 필터링

      const result = await service.getLogs('0x1', '0x1', [address]);

      expect(cryptoService.isInLogsBloom).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].address).toBe(address);
    });

    it('should filter by topics using logsBloom', async () => {
      const topic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
      const mockReceipt = new TransactionReceipt(
        '0xtx1',
        0,
        '0xblock1',
        1,
        '0xfrom',
        '0xto',
        1,
        21000n,
        21000n,
      );
      mockReceipt.logs = [
        {
          address: '0xcontract1',
          topics: [topic],
          data: '0x',
          blockNumber: 1,
          transactionHash: '0xtx1',
          transactionIndex: 0,
          blockHash: '0xblock1',
          logIndex: 0,
          removed: false,
        },
      ];
      mockReceipt.logsBloom = '0x' + '1'.repeat(512);

      const mockBlock = {
        number: 1,
        transactions: [{ hash: '0xtx1' }],
        getHeader: jest.fn().mockReturnValue({
          logsBloom: '0x' + '1'.repeat(512),
        }),
      } as any;

      blockRepository.findLatest = jest.fn().mockResolvedValue(mockBlock);
      blockRepository.findByNumber = jest.fn().mockResolvedValue(mockBlock);
      levelDbRepo.findReceipt = jest.fn().mockResolvedValue(mockReceipt);
      cryptoService.isInLogsBloom = jest
        .fn()
        .mockReturnValueOnce(true) // 블록 레벨 필터링
        .mockReturnValueOnce(true); // 로그 레벨 필터링

      const result = await service.getLogs('0x1', '0x1', undefined, [[topic]]);

      expect(cryptoService.isInLogsBloom).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].topics).toContain(topic);
    });

    it('should parse block number correctly', async () => {
      const mockBlock = {
        number: 100,
        transactions: [],
        getHeader: jest.fn().mockReturnValue({
          logsBloom: '0x' + '0'.repeat(512),
        }),
      } as any;

      blockRepository.findLatest = jest.fn().mockResolvedValue(mockBlock);
      blockRepository.findByNumber = jest.fn().mockResolvedValue(mockBlock);

      await service.getLogs('0x64', '0x64'); // 100 in hex

      expect(blockRepository.findByNumber).toHaveBeenCalledWith(100);
    });

    it('should use latest block when fromBlock is latest', async () => {
      const mockBlock = {
        number: 100,
        transactions: [],
        getHeader: jest.fn().mockReturnValue({
          logsBloom: '0x' + '0'.repeat(512),
        }),
      } as any;

      blockRepository.findLatest = jest.fn().mockResolvedValue(mockBlock);
      blockRepository.findByNumber = jest.fn().mockResolvedValue(mockBlock);

      await service.getLogs('latest', 'latest');

      expect(blockRepository.findByNumber).toHaveBeenCalledWith(100);
    });
  });
});

