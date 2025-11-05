import { Test, TestingModule } from '@nestjs/testing';
import { Transaction } from '../../../src/transaction/entities/transaction.entity';
import { TransactionPool } from '../../../src/transaction/pool/transaction.pool';
import { CHAIN_ID } from '../../../src/common/constants/blockchain.constants';

/**
 * TransactionPool 테스트
 *
 * 테스트 범위:
 * - 트랜잭션 추가 (pending/queued)
 * - 트랜잭션 조회
 * - 트랜잭션 제거
 * - Queued → Pending 전환
 * - 통계
 */
describe('TransactionPool', () => {
  let pool: TransactionPool;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TransactionPool],
    }).compile();

    pool = module.get<TransactionPool>(TransactionPool);
  });

  afterEach(() => {
    pool.clear();
  });

  describe('트랜잭션 추가', () => {
    it('Pending 트랜잭션을 추가해야 함', () => {
      const tx = new Transaction(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        1000n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
      );

      const result = pool.add(tx, 0);

      expect(result).toBe(true);
      expect(pool.get(tx.hash)).toBe(tx);
      expect(pool.pendingSize()).toBe(1);
      expect(pool.queuedSize()).toBe(0);
    });

    it('Queued 트랜잭션을 추가해야 함', () => {
      const tx = new Transaction(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        1000n,
        5,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
      );

      const result = pool.add(tx, 0);

      expect(result).toBe(true);
      expect(pool.get(tx.hash)).toBe(tx);
      expect(pool.pendingSize()).toBe(0);
      expect(pool.queuedSize()).toBe(1);
    });

    it('중복 트랜잭션 추가를 거부해야 함', () => {
      const tx = new Transaction(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        null,
        1000n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
      );

      pool.add(tx, 0);
      const result = pool.add(tx, 0);

      expect(result).toBe(false);
      expect(pool.pendingSize()).toBe(1);
    });

    it('너무 작은 nonce를 거부해야 함', () => {
      const tx = new Transaction(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        null,
        1000n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
      );

      const result = pool.add(tx, 5); // accountNonce가 5인데 tx.nonce가 0

      expect(result).toBe(false);
    });
  });

  describe('트랜잭션 조회', () => {
    it('Pending 트랜잭션을 조회해야 함', () => {
      const tx = new Transaction(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        null,
        1000n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
      );

      pool.add(tx, 0);
      const result = pool.get(tx.hash);

      expect(result).toBe(tx);
    });

    it('Queued 트랜잭션을 조회해야 함', () => {
      const tx = new Transaction(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        null,
        1000n,
        5,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
      );

      pool.add(tx, 0);
      const result = pool.get(tx.hash);

      expect(result).toBe(tx);
    });

    it('존재하지 않는 트랜잭션은 null을 반환해야 함', () => {
      const result = pool.get('0x' + '0'.repeat(64));

      expect(result).toBeNull();
    });
  });

  describe('Pending 트랜잭션 조회', () => {
    it('가스 가격 순으로 정렬되어야 함', () => {
      const tx1 = new Transaction(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        null,
        1000n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + '1'.repeat(64),
        '',
        BigInt('2000000000'),
      );

      const tx2 = new Transaction(
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        null,
        1000n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + '2'.repeat(64),
        '',
        BigInt('1000000000'),
      );

      pool.add(tx1, 0);
      pool.add(tx2, 0);

      const pending = pool.getPending();

      expect(pending[0].hash).toBe(tx1.hash); // 높은 가스 가격 먼저
      expect(pending[1].hash).toBe(tx2.hash);
    });
  });

  describe('Queued → Pending 전환', () => {
    it('Queued 트랜잭션을 Pending으로 전환해야 함', () => {
      const address = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const tx = new Transaction(
        address,
        null,
        1000n,
        1,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
      );

      pool.add(tx, 0); // nonce 1이므로 queued
      expect(pool.queuedSize()).toBe(1);
      expect(pool.pendingSize()).toBe(0);

      pool.promoteQueuedToPending(address, 1); // nonce가 1이 됨

      expect(pool.queuedSize()).toBe(0);
      expect(pool.pendingSize()).toBe(1);
    });

    it('다른 계정의 트랜잭션은 전환하지 않아야 함', () => {
      const address1 = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const address2 = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
      const tx = new Transaction(
        address1,
        null,
        1000n,
        1,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
      );

      pool.add(tx, 0);
      pool.promoteQueuedToPending(address2, 1); // 다른 계정

      expect(pool.queuedSize()).toBe(1);
      expect(pool.pendingSize()).toBe(0);
    });
  });

  describe('트랜잭션 제거', () => {
    it('Pending 트랜잭션을 제거해야 함', () => {
      const tx = new Transaction(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        null,
        1000n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
      );

      pool.add(tx, 0);
      pool.remove(tx.hash);

      expect(pool.get(tx.hash)).toBeNull();
      expect(pool.pendingSize()).toBe(0);
    });

    it('Queued 트랜잭션을 제거해야 함', () => {
      const tx = new Transaction(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        null,
        1000n,
        5,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
      );

      pool.add(tx, 0);
      pool.remove(tx.hash);

      expect(pool.get(tx.hash)).toBeNull();
      expect(pool.queuedSize()).toBe(0);
    });

    it('여러 트랜잭션을 제거해야 함', () => {
      const tx1 = new Transaction(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        null,
        1000n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + '1'.repeat(64),
      );

      const tx2 = new Transaction(
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        null,
        1000n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + '2'.repeat(64),
      );

      pool.add(tx1, 0);
      pool.add(tx2, 0);
      pool.removeMany([tx1.hash, tx2.hash]);

      expect(pool.size()).toBe(0);
    });
  });

  describe('통계', () => {
    it('통계를 조회해야 함', () => {
      const tx = new Transaction(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        null,
        1000n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
      );

      pool.add(tx, 0);

      const stats = pool.getStats();

      expect(stats).toHaveProperty('pendingCount');
      expect(stats).toHaveProperty('queuedCount');
      expect(stats).toHaveProperty('totalCount');
      expect(stats).toHaveProperty('totalValue');
      expect(stats.pendingCount).toBe(1);
    });
  });

  describe('크기 확인', () => {
    it('전체 크기를 조회해야 함', () => {
      const tx1 = new Transaction(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        null,
        1000n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + '1'.repeat(64),
      );

      const tx2 = new Transaction(
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        null,
        1000n,
        5,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + '2'.repeat(64),
      );

      pool.add(tx1, 0);
      pool.add(tx2, 0);

      expect(pool.size()).toBe(2);
      expect(pool.pendingSize()).toBe(1);
      expect(pool.queuedSize()).toBe(1);
    });
  });

  describe('존재 여부 확인', () => {
    it('존재하는 트랜잭션을 확인해야 함', () => {
      const tx = new Transaction(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        null,
        1000n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
      );

      pool.add(tx, 0);

      expect(pool.has(tx.hash)).toBe(true);
    });

    it('존재하지 않는 트랜잭션을 확인해야 함', () => {
      expect(pool.has('0x' + '0'.repeat(64))).toBe(false);
    });
  });

  describe('Pool 비우기', () => {
    it('Pool을 비워야 함', () => {
      const tx = new Transaction(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        null,
        1000n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
      );

      pool.add(tx, 0);
      pool.clear();

      expect(pool.size()).toBe(0);
    });
  });
});

