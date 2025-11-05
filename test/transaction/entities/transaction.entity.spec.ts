import { Transaction } from '../../../src/transaction/entities/transaction.entity';
import { CHAIN_ID } from '../../../src/common/constants/blockchain.constants';

/**
 * Transaction Entity 테스트
 *
 * 테스트 범위:
 * - 트랜잭션 생성
 * - 상태 변경 (confirm, fail)
 * - JSON 변환
 */
describe('Transaction Entity', () => {
  describe('생성자', () => {
    it('트랜잭션을 생성해야 함', () => {
      const tx = new Transaction(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        1000n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
      );

      expect(tx.from).toBe('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      expect(tx.to).toBe('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
      expect(tx.value).toBe(1000n);
      expect(tx.nonce).toBe(0);
      expect(tx.status).toBe('pending');
    });

    it('컨트랙트 배포 트랜잭션을 생성해야 함', () => {
      const tx = new Transaction(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        null,
        0n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
        '0x6080604052348015600f57600080fd5b',
      );

      expect(tx.to).toBeNull();
      expect(tx.data).toBe('0x6080604052348015600f57600080fd5b');
    });
  });

  describe('상태 변경', () => {
    it('트랜잭션을 확인 상태로 변경해야 함', () => {
      const tx = new Transaction(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        null,
        1000n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
      );

      tx.confirm(10);

      expect(tx.status).toBe('confirmed');
      expect(tx.blockNumber).toBe(10);
    });

    it('트랜잭션을 실패 상태로 변경해야 함', () => {
      const tx = new Transaction(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        null,
        1000n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
      );

      tx.fail();

      expect(tx.status).toBe('failed');
    });
  });

  describe('서명 조회', () => {
    it('서명을 조회해야 함', () => {
      const signature = {
        v: CHAIN_ID * 2 + 35,
        r: '0x' + 'r'.repeat(64),
        s: '0x' + 's'.repeat(64),
      };

      const tx = new Transaction(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        null,
        1000n,
        0,
        signature,
        '0x' + 'h'.repeat(64),
      );

      const result = tx.getSignature();

      expect(result).toEqual(signature);
    });
  });

  describe('JSON 변환', () => {
    it('JSON으로 변환해야 함', () => {
      const tx = new Transaction(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        1000n,
        0,
        { v: CHAIN_ID * 2 + 35, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        '0x' + 'h'.repeat(64),
      );

      const json = tx.toJSON();

      expect(json.hash).toBe(tx.hash);
      expect(json.from).toBe(tx.from);
      expect(json.to).toBe(tx.to);
      expect(json.value).toBe('0x3e8'); // Hex string
      expect(json.nonce).toBe('0x0'); // Hex string
    });
  });
});

