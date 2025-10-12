import { Test, TestingModule } from '@nestjs/testing';
import { AccountService } from '../../src/account/account.service';
import { AccountMemoryRepository } from '../../src/account/repositories/account-memory.repository';
import { IAccountRepository } from '../../src/account/repositories/account.repository.interface';

/**
 * AccountService 테스트
 *
 * 테스트 범위:
 * - 계정 생성 및 조회
 * - 잔액 관리 (추가, 차감, 조회)
 * - Nonce 관리
 * - 계정 간 송금
 * - 에러 처리
 */
describe('AccountService', () => {
  let service: AccountService;
  let repository: IAccountRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: 'IAccountRepository',
          useClass: AccountMemoryRepository,
        },
        {
          provide: AccountService,
          useFactory: (repo: IAccountRepository) => {
            return new AccountService(repo);
          },
          inject: ['IAccountRepository'],
        },
      ],
    }).compile();

    service = module.get<AccountService>(AccountService);
    repository = module.get<IAccountRepository>('IAccountRepository');
  });

  afterEach(async () => {
    await repository.clear();
  });

  /**
   * 1. 계정 생성 및 조회
   */
  describe('계정 생성 및 조회', () => {
    it('새로운 계정을 생성해야 함', async () => {
      const address = '0x1234567890123456789012345678901234567890';
      const account = await service.getOrCreateAccount(address);

      expect(account).toBeDefined();
      expect(account.address).toBe(address);
      expect(account.balance).toBe(0n);
      expect(account.nonce).toBe(0);
    });

    it('기존 계정을 조회해야 함', async () => {
      const address = '0x1234567890123456789012345678901234567890';

      // 첫 번째 호출: 계정 생성
      const account1 = await service.getOrCreateAccount(address);
      account1.balance = 1000n;
      await repository.save(account1);

      // 두 번째 호출: 기존 계정 조회
      const account2 = await service.getOrCreateAccount(address);

      expect(account2.balance).toBe(1000n);
    });

    it('존재하지 않는 계정 조회 시 null을 반환해야 함', async () => {
      const address = '0x9999999999999999999999999999999999999999';
      const account = await service.getAccount(address);

      expect(account).toBeNull();
    });

    it('계정 존재 여부를 확인해야 함', async () => {
      const address = '0x1234567890123456789012345678901234567890';

      expect(await service.exists(address)).toBe(false);

      await service.getOrCreateAccount(address);

      expect(await service.exists(address)).toBe(true);
    });
  });

  /**
   * 2. 잔액 관리
   */
  describe('잔액 관리', () => {
    it('잔액을 추가해야 함', async () => {
      const address = '0x1234567890123456789012345678901234567890';

      await service.addBalance(address, 1000n);
      const balance = await service.getBalance(address);

      expect(balance).toBe(1000n);
    });

    it('잔액을 차감해야 함', async () => {
      const address = '0x1234567890123456789012345678901234567890';

      await service.addBalance(address, 1000n);
      await service.subtractBalance(address, 300n);
      const balance = await service.getBalance(address);

      expect(balance).toBe(700n);
    });

    it('잔액 부족 시 에러를 발생시켜야 함', async () => {
      const address = '0x1234567890123456789012345678901234567890';

      await service.addBalance(address, 100n);

      await expect(service.subtractBalance(address, 200n)).rejects.toThrow();
    });

    it('잔액이 0인 계정의 잔액을 조회해야 함', async () => {
      const address = '0x9999999999999999999999999999999999999999';
      const balance = await service.getBalance(address);

      expect(balance).toBe(0n);
    });
  });

  /**
   * 3. Nonce 관리
   */
  describe('Nonce 관리', () => {
    it('초기 nonce는 0이어야 함', async () => {
      const address = '0x1234567890123456789012345678901234567890';
      const nonce = await service.getNonce(address);

      expect(nonce).toBe(0);
    });

    it('nonce를 증가시켜야 함', async () => {
      const address = '0x1234567890123456789012345678901234567890';

      await service.incrementNonce(address);
      expect(await service.getNonce(address)).toBe(1);

      await service.incrementNonce(address);
      expect(await service.getNonce(address)).toBe(2);
    });

    it('존재하지 않는 계정의 nonce는 0이어야 함', async () => {
      const address = '0x9999999999999999999999999999999999999999';
      const nonce = await service.getNonce(address);

      expect(nonce).toBe(0);
    });
  });

  /**
   * 4. 계정 간 송금
   */
  describe('계정 간 송금', () => {
    it('계정 A에서 계정 B로 송금해야 함', async () => {
      const addressA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const addressB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

      // A에게 1000 Wei 지급
      await service.addBalance(addressA, 1000n);

      // A -> B로 300 Wei 송금
      await service.transfer(addressA, addressB, 300n);

      expect(await service.getBalance(addressA)).toBe(700n);
      expect(await service.getBalance(addressB)).toBe(300n);
    });

    it('잔액 부족 시 송금이 실패해야 함', async () => {
      const addressA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const addressB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

      await service.addBalance(addressA, 100n);

      await expect(
        service.transfer(addressA, addressB, 200n),
      ).rejects.toThrow();
    });

    it('자기 자신에게 송금 시 에러를 발생시켜야 함', async () => {
      const address = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

      await service.addBalance(address, 1000n);

      await expect(service.transfer(address, address, 100n)).rejects.toThrow(
        'Cannot transfer to yourself',
      );
    });

    it('음수 금액 송금 시 에러를 발생시켜야 함', async () => {
      const addressA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const addressB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

      await expect(
        service.transfer(addressA, addressB, -100n),
      ).rejects.toThrow();
    });

    it('0 금액 송금 시 에러를 발생시켜야 함', async () => {
      const addressA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const addressB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

      await expect(service.transfer(addressA, addressB, 0n)).rejects.toThrow();
    });
  });

  /**
   * 5. 여러 계정 관리
   */
  describe('여러 계정 관리', () => {
    it('모든 계정을 조회해야 함', async () => {
      await service.getOrCreateAccount(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      );
      await service.getOrCreateAccount(
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      );
      await service.getOrCreateAccount(
        '0xcccccccccccccccccccccccccccccccccccccccc',
      );

      const accounts = await service.getAllAccounts();

      expect(accounts).toHaveLength(3);
    });

    it('복잡한 트랜잭션 시나리오', async () => {
      const alice = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const bob = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
      const charlie = '0xcccccccccccccccccccccccccccccccccccccccc';

      // 초기 자금 분배
      await service.addBalance(alice, 1000n);

      // Alice -> Bob: 300
      await service.transfer(alice, bob, 300n);
      expect(await service.getBalance(alice)).toBe(700n);
      expect(await service.getBalance(bob)).toBe(300n);

      // Bob -> Charlie: 100
      await service.transfer(bob, charlie, 100n);
      expect(await service.getBalance(bob)).toBe(200n);
      expect(await service.getBalance(charlie)).toBe(100n);

      // Charlie -> Alice: 50
      await service.transfer(charlie, alice, 50n);
      expect(await service.getBalance(alice)).toBe(750n);
      expect(await service.getBalance(charlie)).toBe(50n);

      // 총 자산 확인 (보존되어야 함)
      const totalBalance =
        (await service.getBalance(alice)) +
        (await service.getBalance(bob)) +
        (await service.getBalance(charlie));
      expect(totalBalance).toBe(1000n);
    });
  });
});
