import { Block } from '../../../src/block/entities/block.entity';
import { Transaction } from '../../../src/transaction/entities/transaction.entity';
import { EMPTY_ROOT } from '../../../src/common/constants/blockchain.constants';
import { CHAIN_ID } from '../../../src/common/constants/blockchain.constants';

/**
 * Block Entity 테스트
 *
 * 테스트 범위:
 * - 블록 생성
 * - 트랜잭션 개수
 * - JSON 변환
 */
describe('Block Entity', () => {
  describe('생성자', () => {
    it('블록을 생성해야 함', () => {
      const block = new Block(
        0,
        '0x' + '0'.repeat(64),
        Date.now(),
        '0x' + '1'.repeat(40),
        [],
        EMPTY_ROOT,
        EMPTY_ROOT,
        EMPTY_ROOT,
        '0x' + '0'.repeat(64),
      );

      expect(block.number).toBe(0);
      expect(block.transactions.length).toBe(0);
    });

    it('트랜잭션을 포함한 블록을 생성해야 함', () => {
      const tx = new Transaction(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        null,
        1000n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
      );

      const block = new Block(
        1,
        '0x' + '0'.repeat(64),
        Date.now(),
        '0x' + '1'.repeat(40),
        [tx],
        EMPTY_ROOT,
        EMPTY_ROOT,
        EMPTY_ROOT,
        '0x' + '1'.repeat(64),
      );

      expect(block.transactions.length).toBe(1);
    });
  });

  describe('트랜잭션 개수', () => {
    it('트랜잭션 개수를 조회해야 함', () => {
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

      const block = new Block(
        1,
        '0x' + '0'.repeat(64),
        Date.now(),
        '0x' + '1'.repeat(40),
        [tx1, tx2],
        EMPTY_ROOT,
        EMPTY_ROOT,
        EMPTY_ROOT,
        '0x' + '1'.repeat(64),
      );

      expect(block.getTransactionCount()).toBe(2);
    });
  });

  describe('JSON 변환', () => {
    it('JSON으로 변환해야 함', () => {
      const block = new Block(
        10,
        '0x' + '0'.repeat(64),
        Date.now(),
        '0x' + '1'.repeat(40),
        [],
        EMPTY_ROOT,
        EMPTY_ROOT,
        EMPTY_ROOT,
        '0x' + '1'.repeat(64),
      );

      const json = block.toJSON();

      expect(json.number).toBe('0xa'); // Hex string
      expect(json.hash).toBe(block.hash);
      expect(json.parentHash).toBe(block.parentHash);
    });
  });

  describe('Genesis Block 확인', () => {
    it('Genesis 블록을 확인해야 함', () => {
      const block = new Block(
        0,
        '0x' + '0'.repeat(64),
        Date.now(),
        '0x' + '1'.repeat(40),
        [],
        EMPTY_ROOT,
        EMPTY_ROOT,
        EMPTY_ROOT,
        '0x' + '0'.repeat(64),
      );

      expect(block.isGenesis()).toBe(true);
    });

    it('일반 블록은 Genesis가 아님', () => {
      const block = new Block(
        1,
        '0x' + '0'.repeat(64),
        Date.now(),
        '0x' + '1'.repeat(40),
        [],
        EMPTY_ROOT,
        EMPTY_ROOT,
        EMPTY_ROOT,
        '0x' + '1'.repeat(64),
      );

      expect(block.isGenesis()).toBe(false);
    });
  });

  describe('Header 조회', () => {
    it('Header를 조회해야 함', () => {
      const block = new Block(
        10,
        '0x' + '0'.repeat(64),
        Date.now(),
        '0x' + '1'.repeat(40),
        [],
        EMPTY_ROOT,
        EMPTY_ROOT,
        EMPTY_ROOT,
        '0x' + '1'.repeat(64),
      );

      const header = block.getHeader();

      expect(header.number).toBe(10);
      expect(header.hash).toBe(block.hash);
      expect(header.parentHash).toBe(block.parentHash);
      expect(header.transactionCount).toBe(0);
    });
  });

  describe('Body 조회', () => {
    it('Body를 조회해야 함', () => {
      const tx = new Transaction(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        null,
        1000n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
      );

      const block = new Block(
        1,
        '0x' + '0'.repeat(64),
        Date.now(),
        '0x' + '1'.repeat(40),
        [tx],
        EMPTY_ROOT,
        EMPTY_ROOT,
        EMPTY_ROOT,
        '0x' + '1'.repeat(64),
      );

      const body = block.getBody();

      expect(body.transactions.length).toBe(1);
      expect(body.transactions[0].hash).toBe(tx.hash);
    });
  });

  describe('Header + Body로 재구성', () => {
    it('Header와 Body로 Block을 재구성해야 함', () => {
      const tx = new Transaction(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        null,
        1000n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
      );

      const header = {
        number: 10,
        hash: '0x' + '1'.repeat(64),
        parentHash: '0x' + '0'.repeat(64),
        timestamp: Date.now(),
        proposer: '0x' + '1'.repeat(40),
        transactionCount: 1,
        stateRoot: EMPTY_ROOT,
        transactionsRoot: EMPTY_ROOT,
        receiptsRoot: EMPTY_ROOT,
      };

      const body = {
        transactions: [tx],
      };

      const block = Block.fromHeaderAndBody(header, body);

      expect(block.number).toBe(10);
      expect(block.hash).toBe(header.hash);
      expect(block.transactions.length).toBe(1);
      expect(block.transactions[0].hash).toBe(tx.hash);
    });
  });
});

