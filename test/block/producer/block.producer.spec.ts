import { Test, TestingModule } from '@nestjs/testing';
import { AccountService } from '../../../src/account/account.service';
import { BlockService } from '../../../src/block/block.service';
import { BlockProducer } from '../../../src/block/producer/block.producer';
import { ConsensusService } from '../../../src/consensus/consensus.service';
import { StateManager } from '../../../src/state/state-manager';
import { ValidatorService } from '../../../src/validator/validator.service';
import { Block } from '../../../src/block/entities/block.entity';
import { EMPTY_ROOT } from '../../../src/common/constants/blockchain.constants';
import { Attestation } from '../../../src/consensus/entities/attestation.entity';

/**
 * BlockProducer 테스트
 *
 * 테스트 범위:
 * - Producer 시작/중지
 * - 상태 조회
 * - 슬롯 계산
 */
describe('BlockProducer', () => {
  let producer: BlockProducer;
  let blockService: jest.Mocked<BlockService>;
  let validatorService: jest.Mocked<ValidatorService>;
  let consensusService: jest.Mocked<ConsensusService>;
  let accountService: jest.Mocked<AccountService>;
  let stateManager: jest.Mocked<StateManager>;

  beforeEach(async () => {
    const mockBlockService = {
      getBlockByNumber: jest.fn(),
      createBlock: jest.fn(),
      saveBlock: jest.fn(),
    } as any;

    const mockValidatorService = {
      selectProposer: jest.fn(),
      selectCommittee: jest.fn(),
    } as any;

    const mockConsensusService = {
      collectAttestations: jest.fn(),
      hasSupermajority: jest.fn(),
      setGenesisTime: jest.fn(),
    } as any;

    const mockAccountService = {
      addBalance: jest.fn(),
    } as any;

    const mockStateManager = {
      startBlock: jest.fn().mockResolvedValue(undefined),
      commitBlock: jest.fn().mockResolvedValue(undefined),
      rollbackBlock: jest.fn().mockResolvedValue(undefined),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: BlockService,
          useValue: mockBlockService,
        },
        {
          provide: ValidatorService,
          useValue: mockValidatorService,
        },
        {
          provide: ConsensusService,
          useValue: mockConsensusService,
        },
        {
          provide: AccountService,
          useValue: mockAccountService,
        },
        {
          provide: StateManager,
          useValue: mockStateManager,
        },
        BlockProducer,
      ],
    }).compile();

    producer = module.get<BlockProducer>(BlockProducer);
    blockService = module.get(BlockService);
    validatorService = module.get(ValidatorService);
    consensusService = module.get(ConsensusService);
    accountService = module.get(AccountService);
    stateManager = module.get(StateManager);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    producer.stop();
  });

  describe('시작/중지', () => {
    it('Producer를 시작해야 함', () => {
      // Genesis Time 설정
      (producer as any).genesisTime = Date.now();

      producer.start();

      const status = producer.getStatus();
      expect(status.isRunning).toBe(true);
    });

    it('이미 실행 중이면 경고를 발생시켜야 함', () => {
      (producer as any).genesisTime = Date.now();
      producer.start();
      producer.start(); // 두 번 호출

      const status = producer.getStatus();
      expect(status.isRunning).toBe(true);
    });

    it('Genesis Time이 없으면 에러를 발생시켜야 함', () => {
      (producer as any).genesisTime = null;

      expect(() => producer.start()).toThrow();
    });

    it('Producer를 중지해야 함', () => {
      (producer as any).genesisTime = Date.now();
      producer.start();
      producer.stop();

      const status = producer.getStatus();
      expect(status.isRunning).toBe(false);
    });

    it('실행 중이 아닐 때 중지하면 경고를 발생시켜야 함', () => {
      producer.stop(); // 실행 중이 아님
      // 에러 없이 완료되어야 함
    });
  });

  describe('슬롯 계산', () => {
    it('현재 슬롯을 계산해야 함', () => {
      const genesisTime = Date.now() - 12000; // 12초 전
      (producer as any).genesisTime = genesisTime;

      const slot = producer.getCurrentSlot();

      expect(slot).toBeGreaterThanOrEqual(1);
    });

    it('Genesis Time이 없으면 null을 반환해야 함', () => {
      (producer as any).genesisTime = null;

      const slot = producer.getCurrentSlot();

      expect(slot).toBeNull();
    });
  });

  describe('상태 조회', () => {
    it('상태를 조회해야 함', () => {
      const genesisTime = Date.now();
      (producer as any).genesisTime = genesisTime;

      const status = producer.getStatus();

      expect(status).toHaveProperty('isRunning');
      expect(status).toHaveProperty('genesisTime');
      expect(status).toHaveProperty('currentSlot');
      expect(status).toHaveProperty('blockTime');
      expect(status.genesisTime).toBe(new Date(genesisTime).toISOString());
    });
  });

  describe('블록 생성 프로세스 (Private 메서드)', () => {
    it('블록 생성이 성공해야 함 (Supermajority)', async () => {
      const genesisTime = Date.now();
      const proposer = '0x' + '1'.repeat(40);
      const committee = Array.from({ length: 128 }, (_, i) => 
        '0x' + (i + 1).toString(16).padStart(40, '0')
      );
      const block = new Block(
        1,
        '0x' + '0'.repeat(64),
        Date.now(),
        proposer,
        [],
        EMPTY_ROOT,
        EMPTY_ROOT,
        EMPTY_ROOT,
        '0x' + '1'.repeat(64),
      );

      const attestations = committee.slice(0, 90).map((validator) => {
        return new Attestation(
          0,
          block.hash,
          validator,
          { v: 27, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        );
      });

      (producer as any).genesisTime = genesisTime;
      validatorService.selectProposer.mockResolvedValue(proposer);
      validatorService.selectCommittee.mockResolvedValue(committee);
      blockService.createBlock.mockResolvedValue(block);
      consensusService.collectAttestations.mockResolvedValue(attestations);
      consensusService.hasSupermajority.mockReturnValue(true);
      blockService.saveBlock.mockResolvedValue(undefined);
      accountService.addBalance.mockResolvedValue(undefined);

      await (producer as any).produceBlock();

      expect(stateManager.commitBlock).toHaveBeenCalled();
      expect(blockService.saveBlock).toHaveBeenCalledWith(block);
    });

    it('블록 생성이 실패해야 함 (Supermajority 미달)', async () => {
      const genesisTime = Date.now();
      const proposer = '0x' + '1'.repeat(40);
      const committee = Array.from({ length: 128 }, (_, i) => 
        '0x' + (i + 1).toString(16).padStart(40, '0')
      );
      const block = new Block(
        1,
        '0x' + '0'.repeat(64),
        Date.now(),
        proposer,
        [],
        EMPTY_ROOT,
        EMPTY_ROOT,
        EMPTY_ROOT,
        '0x' + '1'.repeat(64),
      );

      const attestations = committee.slice(0, 50).map((validator) => {
        return new Attestation(
          0,
          block.hash,
          validator,
          { v: 27, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        );
      });

      (producer as any).genesisTime = genesisTime;
      validatorService.selectProposer.mockResolvedValue(proposer);
      validatorService.selectCommittee.mockResolvedValue(committee);
      blockService.createBlock.mockResolvedValue(block);
      consensusService.collectAttestations.mockResolvedValue(attestations);
      consensusService.hasSupermajority.mockReturnValue(false);

      await (producer as any).produceBlock();

      expect(stateManager.rollbackBlock).toHaveBeenCalled();
      expect(blockService.saveBlock).not.toHaveBeenCalled();
    });

    it('Genesis Time이 없으면 에러를 발생시켜야 함', async () => {
      (producer as any).genesisTime = null;

      await (producer as any).produceBlock();

      expect(stateManager.rollbackBlock).toHaveBeenCalled();
    });

    it('블록 생성 중 에러 발생 시 롤백해야 함', async () => {
      const genesisTime = Date.now();
      (producer as any).genesisTime = genesisTime;

      validatorService.selectProposer.mockRejectedValue(new Error('Test error'));

      await (producer as any).produceBlock();

      expect(stateManager.rollbackBlock).toHaveBeenCalled();
    });

    it('롤백 실패 시에도 에러를 로깅해야 함', async () => {
      const genesisTime = Date.now();
      (producer as any).genesisTime = genesisTime;

      validatorService.selectProposer.mockRejectedValue(new Error('Test error'));
      (stateManager.rollbackBlock as any).mockRejectedValue(new Error('Rollback failed'));

      await (producer as any).produceBlock();

      // 롤백이 시도되었는지 확인
      expect(stateManager.rollbackBlock).toHaveBeenCalled();
    });
  });

  describe('보상 분배 (Private 메서드)', () => {
    it('보상을 분배해야 함', async () => {
      const proposer = '0x' + '1'.repeat(40);
      const attestations = Array.from({ length: 90 }, (_, i) => {
        return new Attestation(
          0,
          '0x' + 'b'.repeat(64),
          '0x' + (i + 1).toString(16).padStart(40, '0'),
          { v: 27, r: '0x' + 'r'.repeat(64), s: '0x' + 's'.repeat(64) },
        );
      });

      accountService.addBalance.mockResolvedValue(undefined);

      await (producer as any).distributeRewards(proposer, attestations);

      expect(accountService.addBalance).toHaveBeenCalled();
    });
  });
});

