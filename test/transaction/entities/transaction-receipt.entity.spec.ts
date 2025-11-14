import { TransactionReceipt } from '../../../src/transaction/entities/transaction-receipt.entity';

/**
 * TransactionReceipt Entity 테스트
 *
 * 테스트 범위:
 * - Receipt 생성
 * - 로그 추가
 * - JSON 변환
 */
describe('TransactionReceipt Entity', () => {
  describe('생성자', () => {
    it('Receipt를 생성해야 함', () => {
      const receipt = new TransactionReceipt(
        '0x' + 'h'.repeat(64),
        0,
        '0x' + 'b'.repeat(64),
        1,
        '0x' + 'f'.repeat(40),
        '0x' + 't'.repeat(40),
        1,
        21000n,
        21000n,
      );

      expect(receipt.transactionHash).toBe('0x' + 'h'.repeat(64));
      expect(receipt.status).toBe(1);
      expect(receipt.gasUsed).toBe(21000n);
    });

    it('실패한 트랜잭션 Receipt를 생성해야 함', () => {
      const receipt = new TransactionReceipt(
        '0x' + 'h'.repeat(64),
        0,
        '0x' + 'b'.repeat(64),
        1,
        '0x' + 'f'.repeat(40),
        null,
        0,
        21000n,
        21000n,
      );

      expect(receipt.status).toBe(0);
    });
  });

  describe('로그 추가', () => {
    it('로그를 추가해야 함', () => {
      const receipt = new TransactionReceipt(
        '0x' + 'h'.repeat(64),
        0,
        '0x' + 'b'.repeat(64),
        1,
        '0x' + 'f'.repeat(40),
        null,
        1,
        21000n,
        21000n,
      );

      const log = {
        address: '0x' + 'a'.repeat(40),
        topics: ['0x' + 't'.repeat(64)],
        data: '0x',
        blockNumber: 1,
        transactionHash: receipt.transactionHash,
        transactionIndex: 0,
        blockHash: receipt.blockHash,
        logIndex: 0,
        removed: false,
      };

      receipt.logs = [log];

      expect(receipt.logs.length).toBe(1);
      expect(receipt.logs[0].address).toBe('0x' + 'a'.repeat(40));
    });
  });

  describe('JSON 변환', () => {
    it('JSON으로 변환해야 함', () => {
      const receipt = new TransactionReceipt(
        '0x' + 'h'.repeat(64),
        0,
        '0x' + 'b'.repeat(64),
        1,
        '0x' + 'f'.repeat(40),
        '0x' + 't'.repeat(40),
        1,
        21000n,
        21000n,
      );

      const json = receipt.toJSON();

      expect(json.transactionHash).toBe(receipt.transactionHash);
      expect(json.status).toBe('0x1');
      expect(json.gasUsed).toBe('0x5208');
    });

    it('logs 배열을 이더리움 표준 형식으로 변환해야 함', () => {
      const receipt = new TransactionReceipt(
        '0x' + 'h'.repeat(64),
        0,
        '0x' + 'b'.repeat(64),
        1,
        '0x' + 'f'.repeat(40),
        '0x' + 't'.repeat(40),
        1,
        21000n,
        21000n,
      );

      const log = {
        address: '0x' + 'a'.repeat(40),
        topics: ['0x' + 't'.repeat(64), '0x' + '1'.repeat(64)],
        data: '0x1234',
        blockNumber: 1,
        transactionHash: receipt.transactionHash,
        transactionIndex: 0,
        blockHash: receipt.blockHash,
        logIndex: 0,
        removed: false,
      };

      receipt.logs = [log];

      const json = receipt.toJSON();

      expect(json.logs).toBeDefined();
      expect(json.logs.length).toBe(1);
      expect(json.logs[0].address).toBe('0x' + 'a'.repeat(40));
      expect(json.logs[0].topics).toEqual(['0x' + 't'.repeat(64), '0x' + '1'.repeat(64)]);
      expect(json.logs[0].data).toBe('0x1234');
      expect(json.logs[0].blockNumber).toBe('0x1');
      expect(json.logs[0].transactionHash).toBe(receipt.transactionHash);
      expect(json.logs[0].transactionIndex).toBe('0x0');
      expect(json.logs[0].blockHash).toBe(receipt.blockHash);
      expect(json.logs[0].logIndex).toBe('0x0');
      expect(json.logs[0].removed).toBe(false);
    });

    it('logs의 blockHash가 비어있으면 receipt.blockHash를 사용해야 함', () => {
      const receipt = new TransactionReceipt(
        '0x' + 'h'.repeat(64),
        0,
        '0x' + 'b'.repeat(64),
        1,
        '0x' + 'f'.repeat(40),
        '0x' + 't'.repeat(40),
        1,
        21000n,
        21000n,
      );

      const log = {
        address: '0x' + 'a'.repeat(40),
        topics: ['0x' + 't'.repeat(64)],
        data: '0x',
        blockNumber: 1,
        transactionHash: receipt.transactionHash,
        transactionIndex: 0,
        blockHash: '',
        logIndex: 0,
        removed: false,
      };

      receipt.logs = [log];

      const json = receipt.toJSON();

      expect(json.logs[0].blockHash).toBe(receipt.blockHash);
    });
  });
});

