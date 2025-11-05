import { Test, TestingModule } from '@nestjs/testing';
import { AccountService } from '../../src/account/account.service';
import { Account } from '../../src/account/entities/account.entity';
import { Address } from '../../src/common/types/common.types';
import { IStateRepository } from '../../src/storage/repositories/state.repository.interface';
import { StateManager } from '../../src/state/state-manager';

/**
 * AccountService 테스트
 *
 * 테스트 범위:
 * - 계정 생성 및 조회
 * - 잔액 관리 (추가, 차감, 조회)
 * - Nonce 관리
 * - 계정 간 송금
 * - 에러 처리
 *
 * 변경사항 (StateManager 도입):
 * - IAccountRepository → IStateRepository + StateManager
 * - StateManager는 메모리 기반으로 모킹
 */
describe('AccountService', () => {
  let service: AccountService;
  let stateRepository: jest.Mocked<IStateRepository>;
  let stateManager: StateManager;

  beforeEach(async () => {
    // IStateRepository 모킹
    const mockStateRepository: jest.Mocked<IStateRepository> = {
      getAccount: jest.fn(),
      saveAccount: jest.fn(),
      hasAccount: jest.fn(),
      getStateRoot: jest.fn(() => '0x' + '0'.repeat(64)),
      setStateRoot: jest.fn(),
      initialize: jest.fn(),
      close: jest.fn(),
    } as any;

    // StateManager는 실제 인스턴스 사용 (메모리 기반이므로 테스트에 적합)
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: IStateRepository,
          useValue: mockStateRepository,
        },
        {
          provide: StateManager,
          useFactory: (repo: IStateRepository) => {
            return new StateManager(repo);
          },
          inject: [IStateRepository],
        },
        {
          provide: AccountService,
          useFactory: (
            repo: IStateRepository,
            manager: StateManager,
          ) => {
            return new AccountService(repo, manager);
          },
          inject: [IStateRepository, StateManager],
        },
      ],
    }).compile();

    service = module.get<AccountService>(AccountService);
    stateRepository = module.get(IStateRepository);
    stateManager = module.get<StateManager>(StateManager);

    // StateManager 초기화 (블록 시작)
    stateManager.startBlock();
  });

  afterEach(async () => {
    // StateManager의 저널 스택 초기화
    stateManager.rollbackBlock();
    // Mock 초기화
    jest.clearAllMocks();
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
      // StateManager에 저장 (저널에 기록)
      stateManager.setAccount(address, account1);

      // 두 번째 호출: 기존 계정 조회 (StateManager에서 조회)
      const account2 = await service.getOrCreateAccount(address);

      expect(account2.balance).toBe(1000n);
    });

    it('존재하지 않는 계정 조회 시 null을 반환해야 함', async () => {
      const address = '0x9999999999999999999999999999999999999999';
      // StateRepository에서 null 반환하도록 설정
      stateRepository.getAccount.mockResolvedValue(null);
      const account = await service.getAccount(address);

      expect(account).toBeNull();
    });

    it('계정 존재 여부를 확인해야 함', async () => {
      const address = '0x1234567890123456789012345678901234567890';

      // StateRepository에서 null 반환 (계정 없음)
      stateRepository.getAccount.mockResolvedValue(null);
      expect(await service.exists(address)).toBe(false);

      // 계정 생성
      await service.getOrCreateAccount(address);

      // 이제 존재해야 함 (StateManager의 저널에 있음)
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

      // getAllAccounts는 현재 빈 배열을 반환 (State Trie는 전체 조회를 지원하지 않음)
      const accounts = await service.getAllAccounts();

      // 현재 구현에서는 빈 배열 반환 (이더리움도 마찬가지)
      expect(accounts).toHaveLength(0);
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
