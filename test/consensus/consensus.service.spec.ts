import { Test, TestingModule } from '@nestjs/testing';
import { Block } from '../../src/block/entities/block.entity';
import { BLOCK_TIME, EPOCH_SIZE } from '../../src/common/constants/blockchain.constants';
import { CryptoService } from '../../src/common/crypto/crypto.service';
import { Address } from '../../src/common/types/common.types';
import { ConsensusService } from '../../src/consensus/consensus.service';

/**
 * ConsensusService 테스트
 *
 * 테스트 범위:
 * - Genesis Time 설정
 * - Attestation 수집
 * - Supermajority 확인
 * - Slot/Epoch 계산
 */
describe('ConsensusService', () => {
  let service: ConsensusService;
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
        ConsensusService,
      ],
    }).compile();

    service = module.get<ConsensusService>(ConsensusService);
    cryptoService = module.get(CryptoService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Genesis Time', () => {
    it('Genesis Time을 설정해야 함', () => {
      const timestamp = Date.now();
      service.setGenesisTime(timestamp);

      // 직접 확인할 수 없지만, getCurrentSlot이 작동하면 설정됨
      expect(() => service.getCurrentSlot()).not.toThrow();
    });
  });

  describe('Slot/Epoch 계산', () => {
    it('현재 슬롯을 계산해야 함', () => {
      const genesisTime = Date.now() - BLOCK_TIME * 10;
      service.setGenesisTime(genesisTime);

      const slot = service.getCurrentSlot();
      expect(slot).toBeGreaterThanOrEqual(10);
    });

    it('현재 에포크를 계산해야 함', () => {
      const genesisTime = Date.now() - BLOCK_TIME * EPOCH_SIZE * 2;
      service.setGenesisTime(genesisTime);

      const epoch = service.getCurrentEpoch();
      expect(epoch).toBeGreaterThanOrEqual(1);
    });

    it('에포크 시작 슬롯을 계산해야 함', () => {
      const epoch = 5;
      const startSlot = service.getEpochStartSlot(epoch);
      expect(startSlot).toBe(epoch * EPOCH_SIZE);
    });

    it('에포크 종료 슬롯을 계산해야 함', () => {
      const epoch = 5;
      const endSlot = service.getEpochEndSlot(epoch);
      expect(endSlot).toBe((epoch + 1) * EPOCH_SIZE - 1);
    });

    it('Genesis Time이 설정되지 않으면 에러를 발생시켜야 함', () => {
      expect(() => service.getCurrentSlot()).toThrow();
    });
  });

  describe('Attestation 수집', () => {
    it('Attestation을 수집해야 함', async () => {
      const block = new Block(
        0,
        '0x' + '0'.repeat(64),
        Date.now(),
        '0x' + '0'.repeat(64),
        [],
        '0x' + '0'.repeat(64),
        '0x' + '0'.repeat(64),
        '0x' + '0'.repeat(64),
        '0x' + '0'.repeat(64),
      );
      block.hash = '0x' + 'b'.repeat(64);
      block.number = 1;

      const committee: Address[] = [
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      ];

      cryptoService.hashUtf8.mockReturnValue('0x' + 'h'.repeat(64));
      service.setGenesisTime(Date.now());

      const attestations = await service.collectAttestations(block, committee);

      expect(attestations.length).toBe(committee.length);
      expect(attestations[0].blockHash).toBe(block.hash);
    });
  });

  describe('Supermajority 확인', () => {
    it('2/3 이상이면 Supermajority를 가져야 함', () => {
      const committeeSize = 128;
      const required = Math.ceil((committeeSize * 2) / 3);
      const attestations = Array(required).fill(null);

      const result = service.hasSupermajority(attestations, committeeSize);
      expect(result).toBe(true);
    });

    it('2/3 미만이면 Supermajority가 없어야 함', () => {
      const committeeSize = 128;
      const required = Math.ceil((committeeSize * 2) / 3);
      const attestations = Array(required - 1).fill(null);

      const result = service.hasSupermajority(attestations, committeeSize);
      expect(result).toBe(false);
    });
  });

  describe('통계', () => {
    it('통계를 조회해야 함', () => {
      const genesisTime = Date.now();
      service.setGenesisTime(genesisTime);

      const stats = service.getStats();

      expect(stats).toHaveProperty('genesisTime');
      expect(stats).toHaveProperty('currentSlot');
      expect(stats).toHaveProperty('currentEpoch');
      expect(stats.genesisTime).toBeDefined();
    });

    it('Genesis Time이 없으면 null을 반환해야 함', () => {
      const stats = service.getStats();

      expect(stats.genesisTime).toBeNull();
      expect(stats.currentSlot).toBeNull();
      expect(stats.currentEpoch).toBeNull();
    });
  });
});

