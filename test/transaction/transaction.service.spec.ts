import { Test, TestingModule } from '@nestjs/testing';
import { AccountService } from '../../src/account/account.service';
import { CHAIN_ID } from '../../src/common/constants/blockchain.constants';
import { CryptoService } from '../../src/common/crypto/crypto.service';
import { Address } from '../../src/common/types/common.types';
import { IBlockRepository } from '../../src/storage/repositories/block.repository.interface';
import { Transaction } from '../../src/transaction/entities/transaction.entity';
import { TransactionPool } from '../../src/transaction/pool/transaction.pool';
import { TransactionService } from '../../src/transaction/transaction.service';

/**
 * TransactionService 테스트
 *
 * 테스트 범위:
 * - 트랜잭션 서명 생성
 * - 트랜잭션 검증 (서명, nonce, 잔액)
 * - 트랜잭션 제출
 * - 트랜잭션 조회
 */
describe('TransactionService', () => {
  let service: TransactionService;
  let cryptoService: jest.Mocked<CryptoService>;
  let accountService: jest.Mocked<AccountService>;
  let txPool: TransactionPool;
  let blockRepository: jest.Mocked<IBlockRepository>;

  beforeEach(async () => {
    const mockCryptoService = {
      privateKeyToAddress: jest.fn(),
      hashUtf8: jest.fn(),
      hashBuffer: jest.fn(),
      signTransaction: jest.fn(),
      rlpEncode: jest.fn(),
      hashHex: jest.fn(),
      recoverAddress: jest.fn(),
      verify: jest.fn(),
      hexToBytes: jest.fn(),
    } as any;

    const mockAccountService = {
      getNonce: jest.fn(),
      getBalance: jest.fn(),
      subtractBalance: jest.fn(),
      addBalance: jest.fn(),
    } as any;

    const mockBlockRepository = {
      getTransactionReceipt: jest.fn(),
      saveTransactionReceipt: jest.fn(),
      findTxLookup: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: CryptoService,
          useValue: mockCryptoService,
        },
        {
          provide: AccountService,
          useValue: mockAccountService,
        },
        {
          provide: TransactionPool,
          useClass: TransactionPool,
        },
        {
          provide: IBlockRepository,
          useValue: mockBlockRepository,
        },
        TransactionService,
      ],
    }).compile();

    service = module.get<TransactionService>(TransactionService);
    cryptoService = module.get(CryptoService);
    accountService = module.get(AccountService);
    txPool = module.get<TransactionPool>(TransactionPool);
    blockRepository = module.get(IBlockRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
    txPool.clear();
  });

  describe('트랜잭션 서명 생성', () => {
    it('트랜잭션을 서명해야 함', async () => {
      const privateKey = '0x' + '1'.repeat(64);
      const from = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const to = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
      const value = 1000n;

      cryptoService.privateKeyToAddress.mockReturnValue(from);
      accountService.getNonce.mockResolvedValue(0);
      cryptoService.hashUtf8.mockReturnValue('0x' + 'a'.repeat(64));
      cryptoService.signTransaction.mockReturnValue({
        v: CHAIN_ID * 2 + 35,
        r: '0x' + 'r'.repeat(64),
        s: '0x' + 's'.repeat(64),
      });
      cryptoService.rlpEncode.mockReturnValue(Buffer.from('test'));
      cryptoService.hashBuffer.mockReturnValue('0x' + 'h'.repeat(64));
      cryptoService.hexToBytes.mockReturnValue(new Uint8Array(0));

      const tx = await service.signTransaction(privateKey, to, value);

      expect(tx).toBeDefined();
      expect(tx.from).toBe(from);
      expect(tx.to).toBe(to);
      expect(tx.value).toBe(value);
      expect(tx.nonce).toBe(0);
    });

    it('Pool에 pending 트랜잭션이 있으면 nonce를 조정해야 함', async () => {
      const privateKey = '0x' + '1'.repeat(64);
      const from = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const to = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

      // 기존 pending 트랜잭션 추가
      const existingTx = new Transaction(
        from,
        to,
        1000n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'e'.repeat(64),
      );
      txPool.add(existingTx, 0);

      cryptoService.privateKeyToAddress.mockReturnValue(from);
      accountService.getNonce.mockResolvedValue(0);
      cryptoService.hashUtf8.mockReturnValue('0x' + 'a'.repeat(64));
      cryptoService.signTransaction.mockReturnValue({
        v: CHAIN_ID * 2 + 35,
        r: '0x' + 'r'.repeat(64),
        s: '0x' + 's'.repeat(64),
      });
      cryptoService.rlpEncode.mockReturnValue(Buffer.from('test'));
      cryptoService.hashBuffer.mockReturnValue('0x' + 'h'.repeat(64));
      cryptoService.hexToBytes.mockReturnValue(new Uint8Array(0));

      const tx = await service.signTransaction(privateKey, to, 1000n);

      expect(tx.nonce).toBe(1); // maxNonceInPool + 1
    });
  });

  describe('트랜잭션 검증', () => {
    it('유효한 서명을 검증해야 함', () => {
      const from = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const tx = new Transaction(
        from,
        null,
        0n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
      );

      cryptoService.rlpEncode.mockReturnValue(Buffer.from('test'));
      cryptoService.hashBuffer.mockReturnValue('0x' + 'h'.repeat(64));
      cryptoService.recoverAddress.mockReturnValue(from);
      cryptoService.hexToBytes.mockReturnValue(new Uint8Array(0));

      expect(() => service.verifySignature(tx)).not.toThrow();
    });

    it('잘못된 서명을 거부해야 함', () => {
      const from = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const tx = new Transaction(
        from,
        null,
        0n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
      );

      cryptoService.rlpEncode.mockReturnValue(Buffer.from('test'));
      cryptoService.hashBuffer.mockReturnValue('0x' + 'h'.repeat(64));
      cryptoService.recoverAddress.mockReturnValue(
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      );
      cryptoService.hexToBytes.mockReturnValue(new Uint8Array(0));

      expect(() => service.verifySignature(tx)).toThrow();
    });

    it('유효한 nonce를 검증해야 함', async () => {
      const from = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const tx = new Transaction(
        from,
        null,
        0n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
      );

      accountService.getNonce.mockResolvedValue(0);

      await expect(service.validateNonce(tx)).resolves.not.toThrow();
    });

    it('너무 작은 nonce를 거부해야 함', async () => {
      const from = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const tx = new Transaction(
        from,
        null,
        0n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
      );

      accountService.getNonce.mockResolvedValue(5);

      await expect(service.validateNonce(tx)).rejects.toThrow();
    });

    it('중복 nonce를 거부해야 함', async () => {
      const from = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const tx = new Transaction(
        from,
        null,
        0n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
      );

      const existingTx = new Transaction(
        from,
        null,
        0n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'e'.repeat(64),
      );
      txPool.add(existingTx, 0);

      accountService.getNonce.mockResolvedValue(0);

      await expect(service.validateNonce(tx)).rejects.toThrow();
    });
  });

  describe('트랜잭션 제출', () => {
    it('트랜잭션을 제출해야 함', async () => {
      const from = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const to = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
      const value = 1000n;
      const nonce = 0;
      const signature = {
        v: CHAIN_ID * 2 + 35,
        r: '0x' + 'r'.repeat(64),
        s: '0x' + 's'.repeat(64),
      };
      const hash = '0x' + 'h'.repeat(64);

      cryptoService.rlpEncode.mockReturnValue(Buffer.from('test'));
      cryptoService.hashBuffer.mockReturnValue(hash);
      cryptoService.recoverAddress.mockReturnValue(from);
      cryptoService.hexToBytes.mockReturnValue(new Uint8Array(0));
      accountService.getNonce.mockResolvedValue(0);
      // gas fee 계산: 1000000000 * 21000 = 21000000000000
      // value: 1000
      // total: 21000000001000
      accountService.getBalance.mockResolvedValue(30000000000000n);

      const tx = await service.submitTransaction(
        from,
        to,
        value,
        nonce,
        signature,
      );

      expect(tx).toBeDefined();
      expect(tx.from).toBe(from);
      expect(tx.to).toBe(to);
      expect(tx.value).toBe(value);
      expect(txPool.get(hash)).toBeDefined();
    });

    it('잔액 부족 시 제출을 거부해야 함', async () => {
      const from = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const to = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
      const value = 10000n;
      const nonce = 0;
      const signature = {
        v: CHAIN_ID * 2 + 35,
        r: '0x' + 'r'.repeat(64),
        s: '0x' + 's'.repeat(64),
      };

      cryptoService.rlpEncode.mockReturnValue(Buffer.from('test'));
      cryptoService.hashBuffer.mockReturnValue('0x' + 'h'.repeat(64));
      cryptoService.recoverAddress.mockReturnValue(from);
      cryptoService.hexToBytes.mockReturnValue(new Uint8Array(0));
      accountService.getNonce.mockResolvedValue(0);
      accountService.getBalance.mockResolvedValue(1000n); // 부족

      await expect(
        service.submitTransaction(from, to, value, nonce, signature),
      ).rejects.toThrow();
    });
  });

  describe('가스 파라미터 검증', () => {
    it('유효한 가스 파라미터를 검증해야 함', () => {
      const from = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const tx = new Transaction(
        from,
        null,
        1000n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
        '',
        BigInt('1000000000'),
        BigInt(21000),
      );

      expect(() => service.validateGasParameters(tx)).not.toThrow();
    });

    it('0인 가스 가격을 거부해야 함', () => {
      const from = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const tx = new Transaction(
        from,
        null,
        1000n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
        '',
        0n,
        BigInt(21000),
      );

      expect(() => service.validateGasParameters(tx)).toThrow();
    });

    it('0인 가스 한도를 거부해야 함', () => {
      const from = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const tx = new Transaction(
        from,
        null,
        1000n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
        '',
        BigInt('1000000000'),
        0n,
      );

      expect(() => service.validateGasParameters(tx)).toThrow();
    });
  });

  describe('잔액 검증', () => {
    it('충분한 잔액을 검증해야 함', async () => {
      const from = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const tx = new Transaction(
        from,
        null,
        1000n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
        '',
        BigInt('1000000000'),
        BigInt(21000),
      );

      // value: 1000, gas: 1000000000 * 21000 = 21000000000000
      // total: 21000000001000
      accountService.getBalance.mockResolvedValue(30000000000000n);

      await expect(service.validateBalance(tx)).resolves.not.toThrow();
    });

    it('잔액 부족을 거부해야 함', async () => {
      const from = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const tx = new Transaction(
        from,
        null,
        1000n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
        '',
        BigInt('1000000000'),
        BigInt(21000),
      );

      accountService.getBalance.mockResolvedValue(1000n); // 부족

      await expect(service.validateBalance(tx)).rejects.toThrow();
    });
  });

  describe('트랜잭션 전체 검증', () => {
    it('트랜잭션을 전체 검증해야 함', async () => {
      const from = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const to = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
      const tx = new Transaction(
        from,
        to,
        1000n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
      );

      cryptoService.rlpEncode.mockReturnValue(Buffer.from('test'));
      cryptoService.hashBuffer.mockReturnValue('0x' + 'h'.repeat(64));
      cryptoService.recoverAddress.mockReturnValue(from);
      cryptoService.hexToBytes.mockReturnValue(new Uint8Array(0));
      accountService.getNonce.mockResolvedValue(0);
      accountService.getBalance.mockResolvedValue(30000000000000n);

      await expect(service.validateTransaction(tx)).resolves.not.toThrow();
    });

    it('검증 실패 시 에러를 발생시켜야 함', async () => {
      const from = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const tx = new Transaction(
        from,
        null,
        1000n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
      );

      cryptoService.rlpEncode.mockReturnValue(Buffer.from('test'));
      cryptoService.hashBuffer.mockReturnValue('0x' + 'h'.repeat(64));
      cryptoService.recoverAddress.mockReturnValue(
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      ); // 잘못된 주소
      cryptoService.hexToBytes.mockReturnValue(new Uint8Array(0));

      await expect(service.validateTransaction(tx)).rejects.toThrow();
    });
  });

  describe('트랜잭션 조회', () => {
    it('트랜잭션을 조회해야 함', async () => {
      const hash = '0x' + 'h'.repeat(64);
      const tx = new Transaction(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        null,
        0n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        hash,
      );

      txPool.add(tx, 0);

      const result = await service.getTransaction(hash);
      expect(result).toBeDefined();
      expect(result.hash).toBe(hash);
    });

    it('존재하지 않는 트랜잭션은 에러를 발생시켜야 함', async () => {
      const hash = '0x' + 'h'.repeat(64);

      // blockRepository.findTxLookup도 모킹 필요
      (blockRepository as any).findTxLookup = jest.fn().mockResolvedValue(null);

      await expect(service.getTransaction(hash)).rejects.toThrow();
    });
  });

  describe('Pending 트랜잭션 조회', () => {
    it('Pending 트랜잭션을 조회해야 함', () => {
      txPool.clear();
      const tx = new Transaction(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        null,
        1000n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
      );

      txPool.add(tx, 0);
      const result = service.getPendingTransactions();

      expect(result).toHaveLength(1);
      expect(result[0].hash).toBe(tx.hash);
    });
  });

  describe('Pool 통계', () => {
    it('Pool 통계를 조회해야 함', () => {
      txPool.clear();
      const tx = new Transaction(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        null,
        1000n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
      );

      txPool.add(tx, 0);
      const result = service.getPoolStats();

      expect(result).toHaveProperty('pendingCount');
      expect(result).toHaveProperty('queuedCount');
      expect(result).toHaveProperty('totalCount');
      expect(result.pendingCount).toBe(1);
    });
  });

  describe('Receipt 조회', () => {
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
      };

      const levelDbRepo = blockRepository as any;
      levelDbRepo.findReceipt = jest.fn().mockResolvedValue(receipt);

      const result = await service.getReceipt(hash);

      expect(result).toEqual(receipt);
    });

    it('Receipt가 없으면 null을 반환해야 함', async () => {
      const hash = '0x' + 'h'.repeat(64);
      const levelDbRepo = blockRepository as any;
      levelDbRepo.findReceipt = jest.fn().mockResolvedValue(null);

      const result = await service.getReceipt(hash);

      expect(result).toBeNull();
    });
  });

  describe('Private 메서드 테스트 (any 캐스팅)', () => {
    it('BigInt를 RLP 버퍼로 변환해야 함', () => {
      const buffer = (service as any).toRlpBuffer(1000n);
      
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('0을 RLP 버퍼로 변환해야 함', () => {
      const buffer = (service as any).toRlpBuffer(0n);
      
      expect(buffer.length).toBe(0);
    });

    it('큰 BigInt를 RLP 버퍼로 변환해야 함', () => {
      const largeValue = BigInt('1000000000000000000000000');
      const buffer = (service as any).toRlpBuffer(largeValue);
      
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('데이터를 정규화해야 함 (null)', () => {
      const normalized = (service as any).normalizeData(null);
      
      expect(normalized).toBe('0x');
    });

    it('데이터를 정규화해야 함 (undefined)', () => {
      const normalized = (service as any).normalizeData(undefined);
      
      expect(normalized).toBe('0x');
    });

    it('데이터를 정규화해야 함 (빈 문자열)', () => {
      const normalized = (service as any).normalizeData('');
      
      expect(normalized).toBe('0x');
    });

    it('데이터를 정규화해야 함 (0x 없는 문자열)', () => {
      const normalized = (service as any).normalizeData('abc123');
      
      expect(normalized).toBe('0xabc123');
    });

    it('데이터를 정규화해야 함 (0x 있는 문자열)', () => {
      const normalized = (service as any).normalizeData('0xabc123');
      
      expect(normalized).toBe('0xabc123');
    });

    it('데이터를 정규화해야 함 (0X 대문자)', () => {
      // 0X는 정규화되지만 hex 문자열이 유효해야 함
      // 정규식이 0x로 시작하는지 체크하므로 0X는 에러 발생
      expect(() => (service as any).normalizeData('0X1234567890abcdef')).toThrow();
    });

    it('데이터를 정규화해야 함 (공백)', () => {
      const normalized = (service as any).normalizeData('   ');
      
      expect(normalized).toBe('0x');
    });
  });

  describe('에러 케이스 및 엣지 케이스', () => {
    it('서명 검증 실패 시 에러를 발생시켜야 함', () => {
      const tx = new Transaction(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        1000n,
        0,
        { v: 27, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
      );

      cryptoService.recoverAddress.mockReturnValue('0x' + 'd'.repeat(40)); // 다른 주소
      cryptoService.hashBuffer.mockReturnValue('0x' + 'h'.repeat(64));
      cryptoService.rlpEncode.mockReturnValue(Buffer.from('test'));

      expect(() => service.verifySignature(tx)).toThrow();
    });

    it('Nonce 검증 실패 시 에러를 발생시켜야 함', async () => {
      const tx = new Transaction(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        1000n,
        4, // nonce가 너무 작음 (이미 처리된 트랜잭션)
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
      );

      accountService.getNonce.mockResolvedValue(5); // 실제 nonce는 5

      await expect(service.validateNonce(tx)).rejects.toThrow();
    });

    it('잔액 부족 시 에러를 발생시켜야 함', async () => {
      const tx = new Transaction(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        1000000000000000000n, // 큰 금액
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
        '',
        BigInt('1000000000'),
        BigInt(21000),
      );

      accountService.getBalance.mockResolvedValue(1000n); // 작은 잔액
      accountService.getNonce.mockResolvedValue(0);

      await expect(service.validateBalance(tx)).rejects.toThrow();
    });

    it('가스 가격이 0이면 에러를 발생시켜야 함', () => {
      const tx = new Transaction(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        1000n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
        '',
        0n, // 0 가스 가격
        BigInt(21000),
      );

      expect(() => service.validateGasParameters(tx)).toThrow();
    });

    it('가스 한도가 0이면 에러를 발생시켜야 함', () => {
      const tx = new Transaction(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        1000n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
        '',
        BigInt('1000000000'),
        0n, // 0 가스 한도
      );

      expect(() => service.validateGasParameters(tx)).toThrow();
    });
  });
});

