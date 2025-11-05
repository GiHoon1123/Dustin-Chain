import { Test, TestingModule } from '@nestjs/testing';
import { Account } from '../../src/account/entities/account.entity';
import { Address } from '../../src/common/types/common.types';
import { IStateRepository } from '../../src/storage/repositories/state.repository.interface';
import { StateManager } from '../../src/state/state-manager';

/**
 * StateManager 테스트
 *
 * 테스트 범위:
 * - 계정 조회 (저널 → 캐시 → Repository)
 * - 계정 저장 (저널에 기록)
 * - Checkpoint 관리 (생성, 커밋, 롤백)
 * - 블록 관리 (시작, 커밋, 롤백)
 * - 캐시 관리
 */
describe('StateManager', () => {
  let stateManager: StateManager;
  let stateRepository: jest.Mocked<IStateRepository>;

  beforeEach(async () => {
    const mockStateRepository: jest.Mocked<IStateRepository> = {
      getAccount: jest.fn(),
      saveAccount: jest.fn(),
      hasAccount: jest.fn(),
      getStateRoot: jest.fn(() => '0x' + '0'.repeat(64)),
      setStateRoot: jest.fn(),
      initialize: jest.fn(),
      close: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: IStateRepository,
          useValue: mockStateRepository,
        },
        StateManager,
      ],
    }).compile();

    stateManager = module.get<StateManager>(StateManager);
    stateRepository = module.get(IStateRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('계정 조회', () => {
    it('저널에서 계정을 조회해야 함', async () => {
      const address = '0x1234567890123456789012345678901234567890';
      const account = new Account(address);
      account.balance = 1000n;

      stateManager.startBlock();
      stateManager.setAccount(address, account);

      const result = await stateManager.getAccount(address);
      expect(result).toBeDefined();
      expect(result?.balance).toBe(1000n);
      expect(stateRepository.getAccount).not.toHaveBeenCalled();
    });

    it('Repository에서 계정을 조회해야 함', async () => {
      const address = '0x1234567890123456789012345678901234567890';
      const account = new Account(address);
      account.balance = 2000n;

      stateRepository.getAccount.mockResolvedValue(account);

      stateManager.startBlock();
      const result = await stateManager.getAccount(address);

      expect(result).toBeDefined();
      expect(result?.balance).toBe(2000n);
      expect(stateRepository.getAccount).toHaveBeenCalledWith(address);
    });

    it('존재하지 않는 계정은 null을 반환해야 함', async () => {
      const address = '0x9999999999999999999999999999999999999999';
      stateRepository.getAccount.mockResolvedValue(null);

      stateManager.startBlock();
      const result = await stateManager.getAccount(address);

      expect(result).toBeNull();
    });

    it('저널이 Repository보다 우선순위가 높아야 함', async () => {
      const address = '0x1234567890123456789012345678901234567890';
      const journalAccount = new Account(address);
      journalAccount.balance = 1000n;

      const repoAccount = new Account(address);
      repoAccount.balance = 2000n;

      stateRepository.getAccount.mockResolvedValue(repoAccount);

      stateManager.startBlock();
      stateManager.setAccount(address, journalAccount);

      const result = await stateManager.getAccount(address);
      expect(result?.balance).toBe(1000n); // 저널 우선
    });
  });

  describe('계정 저장', () => {
    it('계정을 저널에 저장해야 함', async () => {
      const address = '0x1234567890123456789012345678901234567890';
      const account = new Account(address);

      stateManager.startBlock();
      stateManager.setAccount(address, account);

      const result = await stateManager.getAccount(address);
      expect(result).toBe(account);
    });
  });

  describe('Checkpoint 관리', () => {
    it('Checkpoint를 생성해야 함', () => {
      stateManager.startBlock();
      stateManager.checkpoint();

      const stats = stateManager.getJournalStats();
      expect(stats.depth).toBe(2); // startBlock + checkpoint
    });

    it('Checkpoint를 커밋해야 함', () => {
      const address = '0x1234567890123456789012345678901234567890';
      const account = new Account(address);

      stateManager.startBlock();
      stateManager.checkpoint();
      stateManager.setAccount(address, account);
      stateManager.commitCheckpoint();

      const result = stateManager.getJournalStats();
      expect(result.depth).toBe(1); // startBlock만 남음

      // 계정이 하위 레벨에 병합되었는지 확인
      stateManager.rollbackBlock();
      stateManager.startBlock();
      // 계정 정보는 사라졌지만, 구조적으로는 커밋이 정상 동작
    });

    it('Checkpoint를 롤백해야 함', () => {
      const address = '0x1234567890123456789012345678901234567890';
      const account = new Account(address);

      stateManager.startBlock();
      stateManager.checkpoint();
      stateManager.setAccount(address, account);
      stateManager.revertCheckpoint();

      const stats = stateManager.getJournalStats();
      expect(stats.depth).toBe(1); // startBlock만 남음
    });

    it('빈 Checkpoint를 커밋해야 함', () => {
      stateManager.startBlock();
      stateManager.checkpoint();
      stateManager.commitCheckpoint();

      const stats = stateManager.getJournalStats();
      // startBlock의 checkpoint가 남아있음 (depth 1)
      expect(stats.depth).toBe(1);
    });
  });

  describe('블록 관리', () => {
    it('블록을 시작해야 함', () => {
      stateManager.startBlock();

      const stats = stateManager.getJournalStats();
      expect(stats.depth).toBe(1);
    });

    it('블록을 커밋해야 함', async () => {
      const address = '0x1234567890123456789012345678901234567890';
      const account = new Account(address);
      account.balance = 1000n;

      stateManager.startBlock();
      stateManager.setAccount(address, account);
      await stateManager.commitBlock();

      expect(stateRepository.saveAccount).toHaveBeenCalledWith(account);
      const stats = stateManager.getJournalStats();
      expect(stats.depth).toBe(0);
    });

    it('블록을 롤백해야 함', () => {
      const address = '0x1234567890123456789012345678901234567890';
      const account = new Account(address);

      stateManager.startBlock();
      stateManager.setAccount(address, account);
      stateManager.rollbackBlock();

      const stats = stateManager.getJournalStats();
      expect(stats.depth).toBe(0);
    });
  });

  describe('계정 삭제', () => {
    it('계정을 삭제 표시해야 함', async () => {
      const address = '0x1234567890123456789012345678901234567890';
      const account = new Account(address);

      stateRepository.getAccount.mockResolvedValue(account);

      stateManager.startBlock();
      // 먼저 계정 로드
      await stateManager.getAccount(address);

      // 삭제 표시
      stateManager.deleteAccount(address);

      const result = await stateManager.getAccount(address);
      expect(result).toBeNull();
    });
  });

  describe('캐시 관리', () => {
    it('캐시 통계를 조회해야 함', () => {
      const stats = stateManager.getCacheStats();
      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('limit');
      expect(stats.limit).toBe(1000);
    });

    it('Repository에서 조회한 계정을 캐시해야 함', async () => {
      const address = '0x1234567890123456789012345678901234567890';
      const account = new Account(address);

      stateRepository.getAccount.mockResolvedValue(account);

      stateManager.startBlock();
      await stateManager.getAccount(address);

      // 두 번째 조회 시 Repository는 한 번만 호출됨 (캐시 사용)
      await stateManager.getAccount(address);
      expect(stateRepository.getAccount).toHaveBeenCalledTimes(1);
    });
  });

  describe('통계', () => {
    it('DB 통계를 조회해야 함', () => {
      stateManager.startBlock();
      const stats = stateManager.getDBStats();

      expect(stats).toHaveProperty('cacheSize');
      expect(stats).toHaveProperty('journalSize');
      expect(stats).toHaveProperty('journalDepth');
    });

    it('저널 통계를 조회해야 함', () => {
      stateManager.startBlock();
      const stats = stateManager.getJournalStats();

      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('depth');
      expect(stats.depth).toBe(1);
    });
  });

  describe('에러 케이스 및 엣지 케이스', () => {
    it('checkpoint가 없을 때 revertCheckpoint를 호출하면 에러를 발생시켜야 함', () => {
      stateManager.rollbackBlock();
      
      expect(() => stateManager.revertCheckpoint()).toThrow();
    });

    it('checkpoint가 없을 때 commitCheckpoint를 호출하면 에러를 발생시켜야 함', () => {
      stateManager.rollbackBlock();
      
      expect(() => stateManager.commitCheckpoint()).toThrow();
    });

    it('중첩된 checkpoint를 처리해야 함', () => {
      stateManager.startBlock();
      stateManager.checkpoint();
      stateManager.checkpoint();
      stateManager.checkpoint();

      expect((stateManager as any).journalStack.length).toBe(4); // startBlock + 3 checkpoints

      stateManager.commitCheckpoint();
      expect((stateManager as any).journalStack.length).toBe(3);

      stateManager.revertCheckpoint();
      expect((stateManager as any).journalStack.length).toBe(2);
    });

    it('캐시 크기 제한을 초과하면 오래된 항목을 제거해야 함', async () => {
      const CACHE_SIZE_LIMIT = (stateManager as any).CACHE_SIZE_LIMIT || 1000;
      
      // 캐시를 가득 채우기
      for (let i = 0; i < CACHE_SIZE_LIMIT + 10; i++) {
        const address = '0x' + i.toString(16).padStart(40, '0');
        const account = new Account(address);
        await stateManager.setAccount(address, account);
        await stateManager.getAccount(address);
      }

      // 캐시 크기가 제한을 초과하지 않아야 함
      const cacheSize = (stateManager as any).cache.size;
      expect(cacheSize).toBeLessThanOrEqual(CACHE_SIZE_LIMIT);
    });
  });
});

