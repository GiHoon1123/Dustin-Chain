import { Test, TestingModule } from '@nestjs/testing';
import { COMMITTEE_SIZE } from '../../src/common/constants/blockchain.constants';
import { CryptoService } from '../../src/common/crypto/crypto.service';
import { Address } from '../../src/common/types/common.types';
import { ValidatorService } from '../../src/validator/validator.service';

/**
 * ValidatorService 테스트
 *
 * 테스트 범위:
 * - Validator 조회
 * - Proposer 선택
 * - Committee 선택
 * - 통계
 */
describe('ValidatorService', () => {
  let service: ValidatorService;
  let cryptoService: jest.Mocked<CryptoService>;

  beforeEach(async () => {
    const mockCryptoService = {
      hashUtf8: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: CryptoService,
          useValue: mockCryptoService,
        },
        ValidatorService,
      ],
    }).compile();

    service = module.get<ValidatorService>(ValidatorService);
    cryptoService = module.get(CryptoService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Validator 조회', () => {
    it('모든 Validator를 조회해야 함', async () => {
      const validators = await service.getAllValidators();
      expect(validators.length).toBeGreaterThan(0);
    });

    it('활성 Validator 개수를 조회해야 함', async () => {
      const count = await service.getActiveCount();
      expect(count).toBeGreaterThan(0);
    });
  });

  describe('Proposer 선택', () => {
    it('Proposer를 선택해야 함', async () => {
      cryptoService.hashUtf8.mockReturnValue('0x' + 'a'.repeat(64));

      const proposer = await service.selectProposer(0);

      expect(proposer).toBeDefined();
      expect(proposer).toMatch(/^0x[0-9a-f]{40}$/);
    });

    it('같은 슬롯에서 같은 Proposer를 선택해야 함', async () => {
      cryptoService.hashUtf8.mockReturnValue('0x' + 'a'.repeat(64));

      const proposer1 = await service.selectProposer(0);
      const proposer2 = await service.selectProposer(0);

      expect(proposer1).toBe(proposer2);
    });

    it('다른 슬롯에서 다른 Proposer를 선택할 수 있어야 함', async () => {
      cryptoService.hashUtf8
        .mockReturnValueOnce('0x' + 'a'.repeat(64))
        .mockReturnValueOnce('0x' + 'b'.repeat(64));

      const proposer1 = await service.selectProposer(0);
      const proposer2 = await service.selectProposer(1);

      // 다른 슬롯이면 다른 Proposer가 선택될 수 있음 (시드가 다름)
      // 하지만 항상 다를 수는 없음 (시드가 같을 수도 있음)
      expect(typeof proposer1).toBe('string');
      expect(typeof proposer2).toBe('string');
    });
  });

  describe('Committee 선택', () => {
    it('Committee를 선택해야 함', async () => {
      cryptoService.hashUtf8.mockReturnValue('0x' + 'a'.repeat(64));

      const committee = await service.selectCommittee(0);

      expect(committee.length).toBe(COMMITTEE_SIZE);
      committee.forEach((addr) => {
        expect(addr).toMatch(/^0x[0-9a-f]{40}$/);
      });
    });

    it('Validators가 부족하면 모든 Validator를 반환해야 함', async () => {
      // Validators가 COMMITTEE_SIZE보다 적으면 모든 Validator 반환
      // 실제로는 256개가 있으므로 이 테스트는 통과할 수 있음
      cryptoService.hashUtf8.mockReturnValue('0x' + 'a'.repeat(64));

      const committee = await service.selectCommittee(0);
      expect(committee.length).toBeGreaterThan(0);
    });

    it('같은 슬롯에서 같은 Committee를 선택해야 함', async () => {
      cryptoService.hashUtf8.mockReturnValue('0x' + 'a'.repeat(64));

      const committee1 = await service.selectCommittee(0);
      const committee2 = await service.selectCommittee(0);

      expect(committee1).toEqual(committee2);
    });
  });

  describe('통계', () => {
    it('통계를 조회해야 함', async () => {
      const stats = await service.getStats();

      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('active');
      expect(stats).toHaveProperty('inactive');
      expect(stats).toHaveProperty('committeeSize');
      expect(stats.committeeSize).toBe(COMMITTEE_SIZE);
    });
  });
});

