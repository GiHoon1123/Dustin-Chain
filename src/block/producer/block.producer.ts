import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { AccountService } from '../../account/account.service';
import {
  BLOCK_TIME,
  COMMITTEE_REWARD_POOL,
  EPOCH_SIZE,
  PROPOSER_REWARD,
  WEI_PER_DSTN,
} from '../../common/constants/blockchain.constants';
import { CryptoService } from '../../common/crypto/crypto.service';
import { Address } from '../../common/types/common.types';
import { ConsensusService } from '../../consensus/consensus.service';
import { Attestation } from '../../consensus/entities/attestation.entity';
import { StakingService } from '../../staking/staking.service';
import { StateManager } from '../../state/state-manager';
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
 *
 * NestJS Lifecycle:
 * - onApplicationBootstrap: BlockService.onApplicationBootstrap() 이후 실행
 * - Genesis Block이 이미 생성/복구된 상태 보장
 */
@Injectable()
export class BlockProducer implements OnApplicationBootstrap {
  private readonly logger = new Logger(BlockProducer.name);
  private genesisTime: number | null = null;
  private isRunning = false;
  private currentTimeout: NodeJS.Timeout | null = null;

  /**
   * StakingContract에 등록된 활성 Validator 주소 Set
   * Validator 선택 시 빠른 조회를 위해 캐싱
   */
  private stakingValidatorSet: Set<Address> = new Set();

  /**
   * 마지막으로 StakingContract Validator 목록을 갱신한 블록 번호
   */
  private lastStakingValidatorUpdate: number = -1;

  constructor(
    private readonly blockService: BlockService,
    private readonly validatorService: ValidatorService,
    private readonly consensusService: ConsensusService,
    private readonly accountService: AccountService,
    private readonly stateManager: StateManager,
    private readonly stakingService: StakingService,
    private readonly cryptoService: CryptoService,
  ) {}

  /**
   * 애플리케이션 부트스트랩
   *
   * NestJS Lifecycle:
   * 1. BlockLevelDBRepository.onModuleInit() - DB 열기
   * 2. BlockService.onApplicationBootstrap() - Genesis Block 체크/생성
   * 3. BlockProducer.onApplicationBootstrap() - 블록 생성 시작
   *
   * 주의: onApplicationBootstrap은 모든 서비스에서 동시 실행됨
   * BlockService가 Genesis Block을 생성할 때까지 대기 필요
   */
  async onApplicationBootstrap() {
    // this.logger.log('Block Producer initializing...');

    // Genesis Block을 찾을 때까지 대기 (최대 10초)
    let genesisBlock: any = null;
    let attempts = 0;
    const maxAttempts = 100; // 10초 (100ms * 100)

    while (!genesisBlock && attempts < maxAttempts) {
      const block = await this.blockService.getBlockByNumber(0);
      if (block) {
        genesisBlock = block;
      } else {
        await new Promise((resolve) => setTimeout(resolve, 100));
        attempts++;
      }
    }

    if (!genesisBlock) {
      throw new Error('Genesis Block not found after waiting 10 seconds');
    }

    // this.logger.log('Genesis Block found, starting Block Producer');

    this.genesisTime = genesisBlock.timestamp;

    // ConsensusService에도 Genesis Time 설정
    this.consensusService.setGenesisTime(this.genesisTime!);

    // this.logger.log(
    //   `Genesis Time set: ${new Date(this.genesisTime!).toISOString()}`,
    // );

    // 블록 생성 시작
    this.start();
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
  start(): void {
    if (this.isRunning) {
      this.logger.warn('Block Producer is already running');
      return;
    }

    if (!this.genesisTime) {
      throw new Error('Genesis Time not set. Create Genesis Block first.');
    }

    this.isRunning = true;
    // this.logger.log('Block Producer started');
    // this.logger.log(`Block time: ${BLOCK_TIME / 1000} seconds`);

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

    // this.logger.debug(
    //   `Next block scheduled at slot ${currentSlot + 1} (in ${Math.round(delay / 1000)}s)`,
    // );

    // 정확한 시간에 블록 생성
    this.currentTimeout = setTimeout(() => {
      void this.produceBlock().then(() => {
        this.scheduleNextBlock(); // 다음 블록 예약
      });
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
   * 5. 2/3 이상이면 블록 확정 (Justified)
   * 6. Proposer에게 보상
   *
   * 우리:
   * - StakingContract에 등록된 Validator 중에서 Proposer/Committee 선택
   * - ConsensusService로 Attestation 수집
   * - BlockService로 블록 생성
   * - 2/3 이상 (Justified) → commitBlock() + saveBlock()
   * - 2/3 미달 → rollbackBlock()
   */
  private async produceBlock(): Promise<void> {
    try {
      const currentSlot = this.getCurrentSlot();

      if (currentSlot === null) {
        throw new Error('Genesis Time not set');
      }

      // 1. Proposer 선택 (StakingContract에 등록된 Validator 중에서)
      const proposer = await this.selectProposer(currentSlot);

      // 2. Committee 선택 (StakingContract에 등록된 Validator 중에서)
      const committee = await this.selectCommittee(currentSlot);

      // this.logger.log(
      //   `Slot ${currentSlot}: Proposer=${proposer.slice(0, 10)}..., Committee=${committee.length} validators`,
      // );

      // 3. 저널 시작 (블록 실행 준비)
      this.stateManager.startBlock();

      // 4. 블록 생성 (Proposer가 생성, 저장 안 함)
      const block = await this.blockService.createBlock(proposer);

      // 5. Committee로부터 Attestation 수집
      const attestations = await this.consensusService.collectAttestations(
        block,
        committee,
      );

      // 6. Supermajority 확인 (2/3 이상)
      const hasSupermajority = this.consensusService.hasSupermajority(
        attestations,
        committee.length,
      );

      // 7. ✅ Justified (2/3 이상) → 저장
      if (hasSupermajority) {
        // 저널의 변경사항을 LevelDB에 커밋
        await this.stateManager.commitBlock();

        // 블록 저장
        await this.blockService.saveBlock(block);

        // 보상 분배
        await this.distributeRewards(proposer, attestations, block.number);

        // this.logger.log(
        //   `Block #${block.number} Justified & Saved: ${block.hash.slice(0, 10)}... (${block.getTransactionCount()} txs, ${attestations.length}/${committee.length} attestations)`,
        // );
      } else {
        // ❌ 2/3 미달 → 롤백
        this.stateManager.rollbackBlock();

        this.logger.warn(
          `❌ Block #${block.number} Rejected (< 2/3): ${attestations.length}/${committee.length} attestations`,
        );
      }
    } catch (error: any) {
      // 에러 발생 시 롤백
      try {
        this.stateManager.rollbackBlock();
      } catch (rollbackError: any) {
        this.logger.error('Failed to rollback block:', String(rollbackError));
      }

      const errorMessage =
        error && typeof error === 'object' && 'message' in error
          ? String(error.message)
          : String(error);
      const errorStack =
        error && typeof error === 'object' && 'stack' in error
          ? String(error.stack)
          : undefined;

      this.logger.error(`Failed to produce block: ${errorMessage}`, errorStack);
      // 에러가 나도 다음 블록은 계속 생성
    }
  }

  /**
   * Proposer 선택
   *
   * StakingContract에 등록된 활성 Validator 중에서 선택합니다.
   *
   * @param slot - 슬롯 번호
   * @returns Proposer 주소
   */
  private async selectProposer(slot: number): Promise<Address> {
    const allValidators = await this.getAllValidators();

    if (allValidators.length === 0) {
      throw new Error('No active validators');
    }

    // RANDAO seed 생성 (Proposer용)
    const seed = this.generateSeed(slot, 'proposer');

    // 결정적 무작위 선택
    const index = Number(
      BigInt('0x' + seed.slice(2, 18)) % BigInt(allValidators.length),
    );

    return allValidators[index];
  }

  /**
   * Committee 선택
   *
   * StakingContract에 등록된 활성 Validator 중에서 선택합니다.
   *
   * @param slot - 슬롯 번호
   * @returns Committee 주소 배열
   */
  private async selectCommittee(slot: number): Promise<Address[]> {
    const allValidators = await this.getAllValidators();

    if (allValidators.length === 0) {
      throw new Error('No active validators');
    }

    // RANDAO seed 생성 (Committee용)
    const seed = this.generateSeed(slot, 'committee');

    // Fisher-Yates Shuffle (결정적)
    const shuffled = this.shuffleValidators(allValidators, seed);

    // 상위 128명 선택 (또는 전체가 128명 미만이면 모두 선택)
    const committeeSize = Math.min(128, shuffled.length);
    return shuffled.slice(0, committeeSize);
  }

  /**
   * 모든 Validator 목록 조회
   *
   * 모든 Validator는 StakingContract에 등록되어 있어야 합니다.
   * 서버 실행 시 Genesis 계정들이 StakingContract에 자동으로 등록됩니다.
   *
   * @returns 모든 활성 Validator 주소 배열
   */
  private async getAllValidators(): Promise<Address[]> {
    // StakingContract Validator만 조회
    try {
      const stakingValidators = await this.stakingService.getActiveValidators();
      return stakingValidators.map((v) => v.validatorAddress);
    } catch (error) {
      this.logger.error(
        `Failed to get StakingContract validators: ${error.message}`,
      );
      throw new Error(
        'No validators available. StakingContract must be deployed and validators must be registered.',
      );
    }
  }

  /**
   * Validator 셔플 (Fisher-Yates)
   *
   * @param validators - 셔플할 Validator 주소 배열
   * @param seed - 시드 (해시)
   * @returns 셔플된 배열
   */
  private shuffleValidators(validators: Address[], seed: string): Address[] {
    const shuffled = [...validators];
    let seedIndex = 0;

    for (let i = shuffled.length - 1; i > 0; i--) {
      // 시드에서 4바이트씩 읽어서 인덱스 생성
      const seedBytes = seed.slice(seedIndex * 8 + 2, seedIndex * 8 + 10);
      const randomValue = parseInt(seedBytes, 16);
      const j = randomValue % (i + 1);

      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      seedIndex = (seedIndex + 1) % (seed.length / 8);
    }

    return shuffled;
  }

  /**
   * RANDAO seed 생성
   *
   * @param slot - 슬롯 번호
   * @param type - 'proposer' 또는 'committee'
   * @returns 시드 해시
   */
  private generateSeed(slot: number, type: string): string {
    // 간단한 시드 생성 (실제로는 RANDAO 사용)
    // ValidatorService와 동일한 방식 사용
    return this.cryptoService.hashUtf8(`randao-${slot}-${type}`);
  }

  /**
   * StakingContract에 등록된 Validator인지 확인
   *
   * 모든 Validator는 StakingContract에 등록되어 있어야 하므로,
   * 이 메서드는 Validator Set 캐시를 갱신하는 용도로 사용됩니다.
   *
   * @param validatorAddress - 확인할 Validator 주소
   * @returns 항상 true (모든 Validator는 StakingContract에 등록됨)
   */
  private async isStakingContractValidator(
    validatorAddress: Address,
  ): Promise<boolean> {
    // StakingContract Validator Set 갱신 (필요 시)
    await this.updateStakingValidatorSet();

    // 모든 Validator는 StakingContract에 등록되어 있으므로 항상 true
    return this.stakingValidatorSet.has(validatorAddress);
  }

  /**
   * StakingContract Validator Set 갱신
   *
   * 블록마다 갱신하지 않고, 필요 시에만 갱신합니다.
   */
  private async updateStakingValidatorSet(): Promise<void> {
    try {
      const latestBlock = await this.blockService.getLatestBlock();

      if (
        !latestBlock ||
        latestBlock.number === this.lastStakingValidatorUpdate
      ) {
        return; // 이미 최신 상태
      }

      const stakingValidators = await this.stakingService.getActiveValidators();
      this.stakingValidatorSet = new Set(
        stakingValidators.map((v) => v.validatorAddress),
      );
      this.lastStakingValidatorUpdate = latestBlock.number;

      this.logger.debug(
        `Updated StakingContract validator set: ${this.stakingValidatorSet.size} validators`,
      );
    } catch {
      // StakingContract가 배포되지 않았거나 에러 발생 시 빈 Set 유지
      this.stakingValidatorSet = new Set();
    }
  }

  /**
   * 현재 Epoch 번호 계산
   *
   * @param blockNumber - 블록 번호
   * @returns Epoch 번호
   */
  private getCurrentEpoch(blockNumber: number): number {
    return Math.floor(blockNumber / EPOCH_SIZE);
  }

  /**
   * 보상 분배
   *
   * 이더리움:
   * - Proposer: Base Reward + Transaction Fees (즉시 지급)
   * - Attesters: Attestation Reward (Epoch 단위로 누적 후 일괄 지급)
   *
   * 우리:
   * - 모든 Validator는 StakingContract에 등록되어 있습니다.
   * - Proposer: 2 DSTN (즉시 지급) - StakingContract.rewardProposer() 호출
   * - Committee: 1 DSTN을 Attestation 제출자들이 나눔 - StakingContract.accumulateCommitteeReward() 호출 (Epoch 단위 누적)
   *
   * @param proposer - 블록 제안자
   * @param attestations - Attestation 배열
   * @param blockNumber - 블록 번호 (Epoch 계산용)
   */
  private async distributeRewards(
    proposer: Address,
    attestations: Attestation[],
    blockNumber: number,
  ): Promise<void> {
    const proposerReward = BigInt(PROPOSER_REWARD) * WEI_PER_DSTN;
    const currentEpoch = this.getCurrentEpoch(blockNumber);

    // 1. Proposer 보상 (즉시 지급)
    // 모든 Validator는 StakingContract에 등록되어 있으므로 StakingContract를 통해 지급
    try {
      await this.stakingService.rewardProposer(proposer, proposerReward);
      this.logger.debug(
        `Proposer reward: ${PROPOSER_REWARD} DSTN to ${proposer.slice(0, 10)}...`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to reward proposer via StakingContract: ${error.message}`,
      );
      // 실패 시 직접 지급으로 폴백 (비상 조치)
      await this.accountService.addBalance(proposer, proposerReward);
      this.logger.warn(
        `Proposer reward fallback: ${PROPOSER_REWARD} DSTN to ${proposer.slice(0, 10)}... (direct balance)`,
      );
    }

    // 2. Committee 보상 (Epoch 단위로 누적)
    if (attestations.length > 0) {
      const totalCommitteeReward = BigInt(COMMITTEE_REWARD_POOL) * WEI_PER_DSTN;
      const rewardPerAttester =
        totalCommitteeReward / BigInt(attestations.length);

      for (const attestation of attestations) {
        // validator 주소 검증
        if (
          !attestation.validator ||
          typeof attestation.validator !== 'string'
        ) {
          this.logger.error(
            `Invalid validator address in attestation: ${attestation.validator}`,
          );
          continue;
        }

        const validatorAddress = attestation.validator;

        // 모든 Validator는 StakingContract에 등록되어 있으므로 StakingContract를 통해 누적
        try {
          await this.stakingService.accumulateCommitteeReward(
            currentEpoch,
            validatorAddress,
            rewardPerAttester,
          );
          this.logger.debug(
            `Committee reward accumulated: ${Number(rewardPerAttester) / Number(WEI_PER_DSTN)} DSTN to ${validatorAddress.slice(0, 10)}... (Epoch ${currentEpoch})`,
          );
        } catch (error) {
          this.logger.error(
            `Failed to accumulate committee reward via StakingContract: ${error.message}`,
          );
          // 실패 시 직접 지급으로 폴백 (비상 조치)
          try {
            await this.accountService.addBalance(
              validatorAddress,
              rewardPerAttester,
            );
            this.logger.warn(
              `Committee reward fallback: ${Number(rewardPerAttester) / Number(WEI_PER_DSTN)} DSTN to ${validatorAddress.slice(0, 10)}... (direct balance)`,
            );
          } catch (fallbackError) {
            this.logger.error(
              `Failed to fallback reward for ${validatorAddress}: ${fallbackError.message}`,
            );
          }
        }
      }
    }

    // 총 보상
    // const totalReward = PROPOSER_REWARD + COMMITTEE_REWARD_POOL;
    // this.logger.debug(`Total block reward: ${totalReward} DSTN distributed`);
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
    // this.logger.log('Block Producer stopped');
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
