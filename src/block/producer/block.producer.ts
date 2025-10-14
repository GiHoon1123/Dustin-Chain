import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AccountService } from '../../account/account.service';
import {
  BLOCK_TIME,
  COMMITTEE_REWARD_POOL,
  PROPOSER_REWARD,
  WEI_PER_DSTN,
} from '../../common/constants/blockchain.constants';
import { Address } from '../../common/types/common.types';
import { ConsensusService } from '../../consensus/consensus.service';
import { Attestation } from '../../consensus/entities/attestation.entity';
import { ValidatorService } from '../../validator/validator.service';
import { BlockService } from '../block.service';

/**
 * Block Producer
 *
 * 이더리움 POS 블록 생성:
 * - Slot 시스템 (12초마다)
 * - Genesis Time 기준으로 절대 시간 계산
 * - 각 슬롯마다 선택된 Validator가 블록 제안
 *
 * Slot:
 * - 블록 생성 가능한 시간 단위 (12초)
 * - Slot 0 = Genesis Time
 * - Current Slot = (Now - Genesis Time) / 12초
 *
 * 우리 구현:
 * - Genesis Time: Genesis Block 생성 시간
 * - 12초마다 자동으로 블록 생성
 * - setTimeout 기반 정확한 타이밍
 *
 * 장점:
 * - Cron보다 정확한 타이밍
 * - 서버 재시작 시에도 슬롯 번호 일치
 * - 이더리움과 동일한 메커니즘
 */
@Injectable()
export class BlockProducer implements OnModuleInit {
  private readonly logger = new Logger(BlockProducer.name);
  private genesisTime: number | null = null;
  private isRunning = false;
  private currentTimeout: NodeJS.Timeout | null = null;

  constructor(
    private readonly blockService: BlockService,
    private readonly validatorService: ValidatorService,
    private readonly consensusService: ConsensusService,
    private readonly accountService: AccountService,
  ) {}

  /**
   * 모듈 초기화 시 자동 시작
   *
   * NestJS Lifecycle Hook:
   * - 서버 시작 시 자동 실행
   * - Genesis Block 생성 후 블록 생성 시작
   */
  async onModuleInit() {
    this.logger.log('Block Producer initializing...');

    // Genesis Block 생성
    const genesisBlock = await this.blockService.createGenesisBlock();
    this.genesisTime = genesisBlock.timestamp;

    // ConsensusService에도 Genesis Time 설정
    this.consensusService.setGenesisTime(this.genesisTime);

    this.logger.log(
      `Genesis Time set: ${new Date(this.genesisTime).toISOString()}`,
    );

    // 블록 생성 시작
    await this.start();
  }

  /**
   * 블록 생성 시작
   *
   * Slot 기반 스케줄링:
   * 1. 현재 슬롯 계산
   * 2. 다음 슬롯 시작 시간 계산
   * 3. setTimeout으로 정확한 시간에 블록 생성
   * 4. 블록 생성 후 다음 슬롯 예약
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Block Producer is already running');
      return;
    }

    if (!this.genesisTime) {
      throw new Error('Genesis Time not set. Create Genesis Block first.');
    }

    this.isRunning = true;
    this.logger.log('Block Producer started');
    this.logger.log(`Block time: ${BLOCK_TIME / 1000} seconds`);

    // 첫 블록 스케줄링
    this.scheduleNextBlock();
  }

  /**
   * 다음 블록 스케줄링
   *
   * 이더리움 Slot 계산:
   * - Current Slot = floor((Now - Genesis Time) / Slot Duration)
   * - Next Slot Time = Genesis Time + (Current Slot + 1) * Slot Duration
   * - Delay = Next Slot Time - Now
   */
  private scheduleNextBlock(): void {
    if (!this.genesisTime) {
      throw new Error('Genesis Time not set');
    }

    const now = Date.now();
    const timeSinceGenesis = now - this.genesisTime;

    // 현재 슬롯 번호 (0부터 시작)
    const currentSlot = Math.floor(timeSinceGenesis / BLOCK_TIME);

    // 다음 슬롯 시작 시간 (절대 시간)
    const nextSlotTime = this.genesisTime + (currentSlot + 1) * BLOCK_TIME;

    // 대기 시간 계산
    const delay = nextSlotTime - now;

    this.logger.debug(
      `Next block scheduled at slot ${currentSlot + 1} (in ${Math.round(delay / 1000)}s)`,
    );

    // 정확한 시간에 블록 생성
    this.currentTimeout = setTimeout(async () => {
      await this.produceBlock();
      this.scheduleNextBlock(); // 다음 블록 예약
    }, delay);
  }

  /**
   * 블록 생성 실행
   *
   * 이더리움 POS:
   * 1. Proposer 선택 (슬롯마다 1명)
   * 2. Committee 선택 (슬롯마다 128명)
   * 3. Proposer가 블록 생성
   * 4. Committee가 블록 검증 (Attestation)
   * 5. 2/3 이상이면 블록 확정
   * 6. Proposer에게 보상
   *
   * 우리:
   * - ValidatorService로 Proposer/Committee 선택
   * - ConsensusService로 Attestation 수집
   * - BlockService로 블록 생성
   */
  private async produceBlock(): Promise<void> {
    try {
      const currentSlot = this.getCurrentSlot();

      if (currentSlot === null) {
        throw new Error('Genesis Time not set');
      }

      // 1. Proposer 선택 (256명 중 1명)
      const proposer = await this.validatorService.selectProposer(currentSlot);

      // 2. Committee 선택 (256명 중 128명)
      const committee =
        await this.validatorService.selectCommittee(currentSlot);

      this.logger.log(
        `Slot ${currentSlot}: Proposer=${proposer.slice(0, 10)}..., Committee=${committee.length} validators`,
      );

      // 3. 블록 생성 (Proposer가 생성)
      const block = await this.blockService.createBlock(proposer);

      // 4. Committee로부터 Attestation 수집
      const attestations = await this.consensusService.collectAttestations(
        block,
        committee,
      );

      // 5. Supermajority 확인 (2/3 이상)
      const hasSupermajority = this.consensusService.hasSupermajority(
        attestations,
        committee.length,
      );

      if (hasSupermajority) {
        this.logger.log(
          `✅ Block #${block.number} produced: ${block.hash.slice(0, 10)}... (${block.getTransactionCount()} txs, ${attestations.length}/${committee.length} attestations)`,
        );
      } else {
        this.logger.warn(
          `⚠️ Block #${block.number} insufficient attestations: ${attestations.length}/${committee.length}`,
        );
      }

      // 6. 보상 분배
      await this.distributeRewards(proposer, attestations);
    } catch (error) {
      this.logger.error(
        `Failed to produce block: ${error.message}`,
        error.stack,
      );
      // 에러가 나도 다음 블록은 계속 생성
    }
  }

  /**
   * 보상 분배
   *
   * 이더리움:
   * - Proposer: Base Reward + Transaction Fees
   * - Attesters: Attestation Reward (각자)
   *
   * 우리:
   * - Proposer: 2 DSTN
   * - Committee: 1 DSTN을 128명이 나눔 (각 ~0.0078 DSTN)
   *
   * @param proposer - 블록 제안자
   * @param attestations - Attestation 배열
   */
  private async distributeRewards(
    proposer: Address,
    attestations: Attestation[],
  ): Promise<void> {
    // 1. Proposer 보상 (2 DSTN)
    const proposerReward = BigInt(PROPOSER_REWARD) * WEI_PER_DSTN;
    await this.accountService.addBalance(proposer, proposerReward);

    this.logger.debug(
      `Proposer reward: ${PROPOSER_REWARD} DSTN to ${proposer.slice(0, 10)}...`,
    );

    // 2. Committee 보상 (1 DSTN을 Attestation 제출자들이 나눔)
    if (attestations.length > 0) {
      const totalCommitteeReward = BigInt(COMMITTEE_REWARD_POOL) * WEI_PER_DSTN;
      const rewardPerAttester =
        totalCommitteeReward / BigInt(attestations.length);

      for (const attestation of attestations) {
        await this.accountService.addBalance(
          attestation.validator,
          rewardPerAttester,
        );
      }

      this.logger.debug(
        `Committee rewards: ${attestations.length} validators × ${Number(rewardPerAttester) / Number(WEI_PER_DSTN)} DSTN`,
      );
    }

    // 총 보상
    const totalReward = PROPOSER_REWARD + COMMITTEE_REWARD_POOL;
    this.logger.debug(`Total block reward: ${totalReward} DSTN distributed`);
  }

  /**
   * 블록 생성 중지
   *
   * 테스트나 서버 종료 시 사용
   */
  stop(): void {
    if (!this.isRunning) {
      this.logger.warn('Block Producer is not running');
      return;
    }

    if (this.currentTimeout) {
      clearTimeout(this.currentTimeout);
      this.currentTimeout = null;
    }

    this.isRunning = false;
    this.logger.log('Block Producer stopped');
  }

  /**
   * 현재 슬롯 번호 조회
   */
  getCurrentSlot(): number | null {
    if (!this.genesisTime) {
      return null;
    }

    const now = Date.now();
    const timeSinceGenesis = now - this.genesisTime;
    return Math.floor(timeSinceGenesis / BLOCK_TIME);
  }

  /**
   * Block Producer 상태
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      genesisTime: this.genesisTime
        ? new Date(this.genesisTime).toISOString()
        : null,
      currentSlot: this.getCurrentSlot(),
      blockTime: BLOCK_TIME / 1000,
    };
  }
}
