import { Test, TestingModule } from '@nestjs/testing';
import { TransactionController } from '../../src/transaction/transaction.controller';
import { TransactionService } from '../../src/transaction/transaction.service';
import { Transaction } from '../../src/transaction/entities/transaction.entity';
import { CHAIN_ID } from '../../src/common/constants/blockchain.constants';

/**
 * TransactionController 테스트
 */
describe('TransactionController', () => {
  let controller: TransactionController;
  let transactionService: jest.Mocked<TransactionService>;

  beforeEach(async () => {
    const mockTransactionService = {
      signTransaction: jest.fn(),
      submitTransaction: jest.fn(),
      getTransaction: jest.fn(),
      getReceipt: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TransactionController],
      providers: [
        {
          provide: TransactionService,
          useValue: mockTransactionService,
        },
      ],
    }).compile();

    controller = module.get<TransactionController>(TransactionController);
    transactionService = module.get(TransactionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('signTransaction', () => {
    it('트랜잭션을 서명해야 함', async () => {
      const tx = new Transaction(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        1000n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
      );

      transactionService.signTransaction.mockResolvedValue(tx);

      const result = await controller.signTransaction({
        privateKey: '0x' + '1'.repeat(64),
        to: tx.to!,
        value: '1000',
      });

      expect(result.hash).toBe(tx.hash);
    });
  });

  describe('sendTransaction', () => {
    it('트랜잭션을 제출해야 함', async () => {
      const tx = new Transaction(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        1000n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
      );

      transactionService.submitTransaction.mockResolvedValue(tx);

      const result = await controller.sendTransaction({
        from: tx.from,
        to: tx.to!,
        value: '1000',
        nonce: 0,
        v: tx.v,
        r: tx.r,
        s: tx.s,
      });

      expect(result.hash).toBe(tx.hash);
    });
  });

  describe('getTransaction', () => {
    it('트랜잭션을 조회해야 함', async () => {
      const hash = '0x' + 'h'.repeat(64);
      const tx = {
        hash,
        from: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        value: '1000',
      };

      transactionService.getTransaction.mockResolvedValue(tx);

      const result = await controller.getTransaction(hash);

      expect(result.hash).toBe(hash);
    });
  });

  describe('getReceipt', () => {
    it('Receipt를 조회해야 함', async () => {
      const hash = '0x' + 'h'.repeat(64);
      const receipt = {
        transactionHash: hash,
        transactionIndex: 0,
        blockHash: '0x' + 'b'.repeat(64),
        blockNumber: 1,
        from: '0x' + 'f'.repeat(40),
        to: null,
        status: 1 as const,
        gasUsed: 21000n,
        cumulativeGasUsed: 21000n,
        contractAddress: null,
        logs: [],
        logsBloom: '0x' + '0'.repeat(512),
        toJSON: jest.fn().mockReturnValue({
          transactionHash: hash,
          status: '0x1',
          gasUsed: '0x5208',
        }),
      };

      transactionService.getReceipt.mockResolvedValue(receipt);

      const result = await controller.getReceipt(hash);

      expect(receipt.toJSON).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('Receipt가 없으면 null을 반환해야 함', async () => {
      const hash = '0x' + 'h'.repeat(64);
      transactionService.getReceipt.mockResolvedValue(null);

      const result = await controller.getReceipt(hash);

      expect(result).toBeNull();
    });
  });
});

