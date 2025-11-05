import { Account } from '../../../src/account/entities/account.entity';

/**
 * Account Entity 테스트
 *
 * 테스트 범위:
 * - 잔액 추가/차감
 * - Nonce 증가
 * - 에러 처리
 * - JSON 변환
 */
describe('Account Entity', () => {
  describe('생성자', () => {
    it('계정을 생성해야 함', () => {
      const address = '0x' + '1'.repeat(40);
      const account = new Account(address);

      expect(account.address).toBe(address);
      expect(account.balance).toBe(0n);
      expect(account.nonce).toBe(0);
    });
  });

  describe('잔액 추가', () => {
    it('잔액을 추가해야 함', () => {
      const account = new Account('0x' + '1'.repeat(40));
      account.addBalance(1000n);

      expect(account.balance).toBe(1000n);
    });

    it('여러 번 추가할 수 있어야 함', () => {
      const account = new Account('0x' + '1'.repeat(40));
      account.addBalance(1000n);
      account.addBalance(500n);

      expect(account.balance).toBe(1500n);
    });

    it('0 이하 금액 추가 시 에러를 발생시켜야 함', () => {
      const account = new Account('0x' + '1'.repeat(40));

      expect(() => account.addBalance(0n)).toThrow('Amount must be positive');
      expect(() => account.addBalance(-100n)).toThrow('Amount must be positive');
    });
  });

  describe('잔액 차감', () => {
    it('잔액을 차감해야 함', () => {
      const account = new Account('0x' + '1'.repeat(40));
      account.balance = 1000n;
      account.subtractBalance(300n);

      expect(account.balance).toBe(700n);
    });

    it('잔액 부족 시 에러를 발생시켜야 함', () => {
      const account = new Account('0x' + '1'.repeat(40));
      account.balance = 100n;

      expect(() => account.subtractBalance(200n)).toThrow('Insufficient balance');
    });

    it('0 이하 금액 차감 시 에러를 발생시켜야 함', () => {
      const account = new Account('0x' + '1'.repeat(40));
      account.balance = 1000n;

      expect(() => account.subtractBalance(0n)).toThrow('Amount must be positive');
      expect(() => account.subtractBalance(-100n)).toThrow('Amount must be positive');
    });
  });

  describe('Nonce 증가', () => {
    it('Nonce를 증가시켜야 함', () => {
      const account = new Account('0x' + '1'.repeat(40));

      account.incrementNonce();
      expect(account.nonce).toBe(1);

      account.incrementNonce();
      expect(account.nonce).toBe(2);
    });
  });

  describe('JSON 변환', () => {
    it('JSON으로 변환해야 함', () => {
      const account = new Account('0x' + '1'.repeat(40));
      account.balance = 1000n;
      account.nonce = 5;

      const json = account.toJSON();

      expect(json.address).toBe(account.address);
      expect(json.balance).toBe('0x3e8'); // Hex string
      expect(json.nonce).toBe('0x5'); // Hex string
    });
  });
});

