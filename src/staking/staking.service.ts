import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import * as fs from 'fs';
import * as keccak from 'keccak';
import * as path from 'path';
import { AccountService } from '../account/account.service';
import {
  MIN_STAKE,
  WEI_PER_DSTN,
} from '../common/constants/blockchain.constants';
import { Address } from '../common/types/common.types';
import { ContractService } from '../contract/contract.service';

/**
 * Staking Service
 *
 * 스테이킹 시스템 관련 비즈니스 로직
 *
 * 역할:
 * - StakingContract와의 상호작용 처리
 * - 스테이킹 예치, 출금 요청, Validator 정보 조회 등
 *
 * 이더리움 PoS 시스템:
 * - 사용자가 32 ETH 이상 스테이킹하여 Validator가 됨
 * - Validator는 블록 제안(Proposer) 및 검증(Committee)에 참여
 * - 보상은 Proposer 즉시 지급, Committee는 Epoch 단위로 지급
 * - 출금 요청 후 대기 시간(27시간) 경과 시 자동 전송
 *
 * 우리 시스템:
 * - 동일한 구조로 구현
 * - 최소 스테이킹: 32 DSTN
 * - 출금 대기 시간: 1분 (테스트용, 프로덕션에서는 27시간)
 * - Backend가 Beacon Chain 역할을 수행하여 보상 지급 및 출금 처리 자동화
 *
 * 주요 함수:
 * 1. deposit() - 스테이킹 예치 (payable 함수, msg.value로 금액 전송)
 * 2. setWithdrawalAddress() - 출금 주소 설정
 * 3. requestWithdrawal() - 출금 요청
 * 4. getValidator() - Validator 정보 조회
 * 5. getActiveValidators() - 활성 Validator 목록 조회
 * 6. getStats() - 스테이킹 통계 조회
 */
/**
 * Genesis Validator 자동 등록 개수
 */
const GENESIS_VALIDATOR_COUNT = 90;

interface GenesisAccount {
  index: number;
  address: string;
  publicKey: string;
  privateKey: string;
}

@Injectable()
export class StakingService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StakingService.name);

  constructor(
    private readonly contractService: ContractService,
    private readonly accountService: AccountService,
  ) {}

  /**
   * 스테이킹 예치
   *
   * 사용자가 DSTN을 스테이킹하여 Validator가 되기 위한 첫 단계입니다.
   *
   * 이더리움:
   * - Deposit Contract에 32 ETH 이상 예치
   * - Validator 등록 정보 제출
   * - Activation Queue 대기
   *
   * 우리:
   * - StakingContract의 deposit() 함수 호출
   * - 최소 32 DSTN 예치 필요
   * - 새 Validator인 경우 pending_initialized 상태로 등록
   * - 기존 Validator인 경우 추가 예치
   *
   * 동작:
   * 1. StakingContract 주소 확인
   * 2. deposit() 함수 호출 (payable 함수이므로 value로 금액 전송)
   * 3. 트랜잭션 제출 및 해시 반환
   *
   * 주의사항:
   * - deposit()은 payable 함수이므로 data는 빈 함수 호출
   * - 실제 금액은 트랜잭션의 value 필드로 전송
   * - 최소 32 DSTN 미만이면 컨트랙트에서 revert
   *
   * @param privateKey - 사용자 개인키 (Validator 주소로 사용)
   * @param amount - 예치할 금액 (Wei 단위, Hex String)
   * @returns 트랜잭션 해시 및 상태
   */
  async deposit(
    privateKey: string,
    amount: string,
  ): Promise<{ hash: string; status: string }> {
    const deployed = this.contractService.getDeployedContracts();
    if (!deployed || !deployed.staking) {
      throw new Error('StakingContract is not deployed');
    }

    const stakingAddress = deployed.staking.address;

    // deposit()은 payable 함수이므로 data는 빈 함수 호출
    // 실제 금액은 value로 전송
    const data = this.contractService.encodeFunctionCall('deposit', [], []);

    // Hex string을 BigInt로 변환 (이더리움 JSON-RPC 표준)
    const amountBigInt = BigInt(amount);

    this.logger.log(
      `Depositing ${amount} Wei to StakingContract for validator`,
    );

    return await this.contractService.executeContractByUser(
      stakingAddress,
      data,
      privateKey,
      amountBigInt, // value로 금액 전송
    );
  }

  /**
   * 출금 주소 설정
   *
   * Validator가 출금 받을 주소를 설정합니다.
   *
   * 이더리움:
   * - Validator 등록 시 Withdrawal Address 설정
   * - 출금은 이 주소로 자동 전송
   * - 변경 가능 (활성 상태에서만)
   *
   * 우리:
   * - 동일하게 구현
   * - active_ongoing, pending_queued, pending_initialized 상태에서만 설정 가능
   *
   * 동작:
   * 1. StakingContract 주소 확인
   * 2. setWithdrawalAddress() 함수 호출
   * 3. 트랜잭션 제출 및 해시 반환
   *
   * @param privateKey - 사용자 개인키 (Validator 주소로 사용)
   * @param withdrawalAddress - 출금 주소
   * @returns 트랜잭션 해시 및 상태
   */
  async setWithdrawalAddress(
    privateKey: string,
    withdrawalAddress: Address,
  ): Promise<{ hash: string; status: string }> {
    const deployed = this.contractService.getDeployedContracts();
    if (!deployed || !deployed.staking) {
      throw new Error('StakingContract is not deployed');
    }

    const stakingAddress = deployed.staking.address;

    const data = this.contractService.encodeFunctionCall(
      'setWithdrawalAddress',
      ['address'],
      [withdrawalAddress],
    );

    this.logger.log(
      `Setting withdrawal address ${withdrawalAddress} for validator`,
    );

    return await this.contractService.executeContractByUser(
      stakingAddress,
      data,
      privateKey,
      0n, // value는 0
    );
  }

  /**
   * 출금 요청
   *
   * Validator가 스테이킹된 자금을 출금하기 위해 요청합니다.
   *
   * 이더리움:
   * - Validator가 출금 요청 트랜잭션 제출
   * - Exit Queue에 등록
   * - 대기 시간(27시간) 경과 후 자동으로 Withdrawal Address로 전송
   *
   * 우리:
   * - 동일하게 구현
   * - 출금 요청 후 active_exiting 상태로 변경
   * - Withdrawal Queue에 등록
   * - Backend가 processWithdrawals()를 주기적으로 호출하여 자동 처리
   *
   * 동작:
   * 1. StakingContract 주소 확인
   * 2. requestWithdrawal() 함수 호출 (파라미터 없음)
   * 3. 트랜잭션 제출 및 해시 반환
   *
   * 주의사항:
   * - active_ongoing 상태에서만 출금 요청 가능
   * - 출금 요청 후 즉시 출금되지 않음 (대기 시간 필요)
   * - Backend가 processWithdrawals()를 호출해야 실제 출금 처리
   *
   * @param privateKey - 사용자 개인키 (Validator 주소로 사용)
   * @returns 트랜잭션 해시 및 상태
   */
  async requestWithdrawal(
    privateKey: string,
  ): Promise<{ hash: string; status: string }> {
    const deployed = this.contractService.getDeployedContracts();
    if (!deployed || !deployed.staking) {
      throw new Error('StakingContract is not deployed');
    }

    const stakingAddress = deployed.staking.address;

    // requestWithdrawal()은 파라미터가 없는 함수
    const data = this.contractService.encodeFunctionCall(
      'requestWithdrawal',
      [],
      [],
    );

    this.logger.log('Requesting withdrawal for validator');

    return await this.contractService.executeContractByUser(
      stakingAddress,
      data,
      privateKey,
      0n, // value는 0
    );
  }

  /**
   * Validator 정보 조회
   *
   * 특정 Validator의 상세 정보를 조회합니다.
   *
   * 조회 정보:
   * - Validator 주소
   * - 스테이킹 금액
   * - Validator 상태 (pending_initialized, active_ongoing, active_exiting 등)
   * - 출금 주소
   * - 활성화 시간
   * - 출금 요청 시간
   * - 총 보상
   * - 슬래싱된 금액
   *
   * 동작:
   * 1. StakingContract 주소 확인
   * 2. getValidator() 함수 호출 (view 함수)
   * 3. 결과 파싱 및 반환
   *
   * @param validatorAddress - 조회할 Validator 주소
   * @returns Validator 정보
   */
  async getValidator(validatorAddress: Address): Promise<{
    validatorAddress: string;
    stakedAmount: string;
    status: string;
    withdrawalAddress: string;
    activatedAt: string;
    exitRequestedAt: string;
    totalRewards: string;
    slashedAmount: string;
  }> {
    const deployed = this.contractService.getDeployedContracts();
    if (!deployed || !deployed.staking) {
      throw new Error('StakingContract is not deployed');
    }

    const stakingAddress = deployed.staking.address;

    // getValidator()는 view 함수이므로 eth_call 사용
    const data = this.contractService.encodeFunctionCall(
      'getValidator',
      ['address'],
      [validatorAddress],
    );

    const result = await this.contractService.callContract(
      stakingAddress,
      data,
    );

    // 결과 파싱 (튜플 반환)
    // getValidator()는 (Validator memory) 반환
    // Validator 구조체 순서: (address validatorAddress, uint256 stakedAmount, ValidatorStatus status, uint256 activatedAt, uint256 exitRequestedAt, uint256 totalRewards, uint256 slashedAmount, address withdrawalAddress)
    // ABI 인코딩된 결과를 파싱 (각 값은 32바이트 = 64 hex characters)
    const resultHex = result.result.startsWith('0x')
      ? result.result.slice(2)
      : result.result;

    // 각 값 추출 (32바이트씩, offset은 0부터 시작)
    const validatorAddr = '0x' + resultHex.slice(24, 64); // offset 0-63: address (마지막 20바이트만 사용)
    const stakedAmount = '0x' + resultHex.slice(64, 128); // offset 64-127: uint256
    const statusValue = parseInt(resultHex.slice(128, 192), 16); // offset 128-191: uint8 (enum)
    const activatedAt = '0x' + resultHex.slice(192, 256); // offset 192-255: uint256
    const exitRequestedAt = '0x' + resultHex.slice(256, 320); // offset 256-319: uint256
    const totalRewards = '0x' + resultHex.slice(320, 384); // offset 320-383: uint256
    const slashedAmount = '0x' + resultHex.slice(384, 448); // offset 384-447: uint256
    const withdrawalAddr = '0x' + resultHex.slice(472, 512); // offset 448-511: address (마지막 20바이트만 사용, 448+24=472)

    // ValidatorStatus enum 매핑
    const statusMap: { [key: number]: string } = {
      0: 'pending_initialized',
      1: 'pending_queued',
      2: 'active_ongoing',
      3: 'active_exiting',
      4: 'exited_withdrawable',
      5: 'exited_withdrawn',
    };

    return {
      validatorAddress: validatorAddr,
      stakedAmount,
      status: statusMap[statusValue] || 'unknown',
      withdrawalAddress: withdrawalAddr,
      activatedAt,
      exitRequestedAt,
      totalRewards,
      slashedAmount,
    };
  }

  /**
   * 활성 Validator 목록 조회
   *
   * 현재 활성 상태(active_ongoing)인 모든 Validator 목록을 조회합니다.
   *
   * 이더리움:
   * - Beacon Chain API를 통해 활성 Validator 조회
   * - 수십만 개의 Validator 존재
   *
   * 우리:
   * - StakingContract의 getActiveValidators() 함수 호출
   * - 활성 Validator 주소 배열 반환
   *
   * 동작:
   * 1. StakingContract 주소 확인
   * 2. getActiveValidators() 함수 호출 (view 함수)
   * 3. 각 Validator의 상세 정보 조회
   * 4. 결과 배열 반환
   *
   * @returns 활성 Validator 목록
   */
  async getActiveValidators(): Promise<
    Array<{
      validatorAddress: string;
      stakedAmount: string;
      status: string;
      withdrawalAddress: string;
      activatedAt: string;
      exitRequestedAt: string;
      totalRewards: string;
      slashedAmount: string;
    }>
  > {
    const deployed = this.contractService.getDeployedContracts();
    if (!deployed || !deployed.staking) {
      throw new Error('StakingContract is not deployed');
    }

    const stakingAddress = deployed.staking.address;

    // getActiveValidators()는 view 함수이므로 eth_call 사용
    const data = this.contractService.encodeFunctionCall(
      'getActiveValidators',
      [],
      [],
    );

    const result = await this.contractService.callContract(
      stakingAddress,
      data,
    );

    // 결과 파싱 (address[] 반환)
    // ABI 인코딩: offset(32바이트) + length(32바이트) + 각 주소(32바이트씩)
    const resultHex = result.result.startsWith('0x')
      ? result.result.slice(2)
      : result.result;

    // offset 읽기 (첫 32바이트)
    const offsetHex = resultHex.slice(0, 64);
    const offset = parseInt(offsetHex, 16);

    // offset 위치에서 배열 길이 읽기
    const lengthHex = resultHex.slice(offset * 2, offset * 2 + 64);
    const arrayLength = parseInt(lengthHex, 16);

    const validatorAddresses: string[] = [];
    for (let i = 0; i < arrayLength; i++) {
      // offset + 64 (length) + i * 64 (각 주소)
      const addressOffset = offset * 2 + 64 + i * 64;
      const address =
        '0x' + resultHex.slice(addressOffset + 24, addressOffset + 64); // 마지막 20바이트
      validatorAddresses.push(address);
    }

    // 각 Validator의 상세 정보 조회
    const validators = await Promise.all(
      validatorAddresses.map((address) => this.getValidator(address)),
    );

    return validators;
  }

  /**
   * Pending Validator 목록 조회
   *
   * pending_queued 또는 pending_initialized 상태의 Validator 목록을 반환합니다.
   *
   * 이더리움:
   * - Activation Queue에 대기 중인 Validator 목록
   * - Churn Limit에 따라 Epoch마다 활성화됨
   *
   * @returns Pending Validator 주소 배열
   */
  async getPendingValidators(): Promise<Address[]> {
    const deployed = this.contractService.getDeployedContracts();
    if (!deployed || !deployed.staking) {
      throw new Error('StakingContract is not deployed');
    }

    const stakingAddress = deployed.staking.address;

    // getPendingValidators()는 view 함수이므로 eth_call 사용
    const data = this.contractService.encodeFunctionCall(
      'getPendingValidators',
      [],
      [],
    );

    const result = await this.contractService.callContract(
      stakingAddress,
      data,
    );

    // 결과 파싱 (address[] 반환)
    const resultHex = result.result.startsWith('0x')
      ? result.result.slice(2)
      : result.result;

    // offset 읽기 (첫 32바이트)
    const offsetHex = resultHex.slice(0, 64);
    const offset = parseInt(offsetHex, 16);

    // offset 위치에서 배열 길이 읽기
    const lengthHex = resultHex.slice(offset * 2, offset * 2 + 64);
    const arrayLength = parseInt(lengthHex, 16);

    const validatorAddresses: Address[] = [];
    for (let i = 0; i < arrayLength; i++) {
      // 각 주소는 32바이트 (64 hex chars)
      const addressHex = resultHex.slice(
        offset * 2 + 64 + i * 64,
        offset * 2 + 64 + i * 64 + 64,
      );
      // 주소는 마지막 20바이트만 사용 (40 hex chars)
      validatorAddresses.push('0x' + addressHex.slice(24));
    }

    return validatorAddresses;
  }

  /**
   * Churn Limit 계산 (이더리움 표준)
   *
   * 이더리움 공식:
   * Churn Limit = max(4, floor(Total Active Validators / 65,536))
   *
   * 의미:
   * - Epoch당 최대 활성화/탈퇴 가능한 Validator 수
   * - 최소값: 4명
   * - 활성 Validator가 많을수록 Churn Limit 증가
   *
   * @returns Churn Limit (Epoch당 활성화 가능한 Validator 수)
   */
  private async calculateChurnLimit(): Promise<number> {
    const activeValidators = await this.getActiveValidators();
    const totalActive = activeValidators.length;

    // 이더리움 Churn Limit 공식: max(4, floor(활성 검증자 수 / 65536))
    const churnLimit = Math.max(4, Math.floor(totalActive / 65536));

    this.logger.debug(
      `Calculated Churn Limit: ${churnLimit} (Total Active: ${totalActive})`,
    );

    return churnLimit;
  }

  /**
   * Activation Queue 처리 (이더리움 Beacon Chain 동작)
   *
   * Epoch마다 Churn Limit만큼 Pending Validator를 활성화합니다.
   *
   * 이더리움:
   * - Beacon Chain이 Epoch 시작 시 Activation Queue 처리
   * - Churn Limit만큼만 활성화 (네트워크 안정성)
   * - pending_queued 상태의 Validator를 active_ongoing으로 변경
   *
   * 우리:
   * - BlockProducer가 Epoch 시작 시 호출
   * - Churn Limit 계산 후 해당 수만큼 활성화
   *
   * @param blockNumber - 현재 블록 번호 (Epoch 계산용)
   */
  async processActivationQueue(blockNumber: number): Promise<void> {
    // Epoch 시작 시에만 처리 (이더리움과 동일)
    const EPOCH_SIZE = 32; // blockchain.constants에서 가져와야 하지만 여기서는 하드코딩
    if (blockNumber % EPOCH_SIZE !== 0) {
      return;
    }

    const currentEpoch = Math.floor(blockNumber / EPOCH_SIZE);
    this.logger.log(`Processing Activation Queue for Epoch ${currentEpoch}...`);

    try {
      // Churn Limit 계산
      const churnLimit = await this.calculateChurnLimit();

      // Pending Validator 목록 조회
      const pendingValidators = await this.getPendingValidators();

      if (pendingValidators.length === 0) {
        this.logger.debug('No pending validators in queue.');
        return;
      }

      this.logger.log(
        `Found ${pendingValidators.length} pending validators. Churn Limit: ${churnLimit}`,
      );

      // Churn Limit만큼만 활성화
      let activatedCount = 0;
      for (const validatorAddress of pendingValidators) {
        if (activatedCount >= churnLimit) {
          this.logger.debug(
            `Churn limit (${churnLimit}) reached for this epoch. Remaining validators will be activated in next epochs.`,
          );
          break;
        }

        try {
          await this.activateValidator(validatorAddress);
          activatedCount++;
          this.logger.log(
            `✅ Activated validator ${validatorAddress} from queue (${activatedCount}/${churnLimit}).`,
          );
        } catch (error) {
          this.logger.error(
            `Failed to activate validator ${validatorAddress} from queue: ${error.message}`,
          );
        }
      }

      if (activatedCount === 0) {
        this.logger.log('No validators activated from queue in this epoch.');
      } else {
        this.logger.log(
          `Processed Activation Queue: ${activatedCount} validator(s) activated.`,
        );
      }
    } catch (error) {
      this.logger.error(`Failed to process Activation Queue: ${error.message}`);
    }
  }

  /**
   * 스테이킹 통계 조회
   *
   * 전체 스테이킹 시스템의 통계 정보를 조회합니다.
   *
   * 조회 정보:
   * - 전체 스테이킹 금액 (totalStaked)
   * - 전체 Validator 수 (totalValidators)
   * - 활성 Validator 수 (activeValidators)
   * - 전체 보상 (totalRewards)
   * - 전체 슬래싱 금액 (totalSlashed)
   * - 최소 스테이킹 금액 (MIN_STAKE)
   * - 최대 Validator 수 (MAX_VALIDATORS)
   * - 출금 대기 시간 (WITHDRAWAL_DELAY)
   *
   * 동작:
   * 1. StakingContract 주소 확인
   * 2. getStats() 함수 호출 (view 함수)
   * 3. 상수 값들도 조회 (MIN_STAKE, MAX_VALIDATORS, WITHDRAWAL_DELAY)
   * 4. 결과 조합 및 반환
   *
   * @returns 스테이킹 통계 정보
   */
  async getStats(): Promise<{
    totalStaked: string;
    totalValidators: number;
    activeValidators: number;
    totalRewards: string;
    totalSlashed: string;
    minStake: string;
    maxValidators: number;
    withdrawalDelay: string;
  }> {
    const deployed = this.contractService.getDeployedContracts();
    if (!deployed || !deployed.staking) {
      throw new Error('StakingContract is not deployed');
    }

    const stakingAddress = deployed.staking.address;

    // getStats()는 view 함수이므로 eth_call 사용
    const statsData = this.contractService.encodeFunctionCall(
      'getStats',
      [],
      [],
    );
    const statsResult = await this.contractService.callContract(
      stakingAddress,
      statsData,
    );

    // 상수 값들 조회
    const minStakeData = this.contractService.encodeFunctionCall(
      'MIN_STAKE',
      [],
      [],
    );
    const minStakeResult = await this.contractService.callContract(
      stakingAddress,
      minStakeData,
    );

    const maxValidatorsData = this.contractService.encodeFunctionCall(
      'MAX_VALIDATORS',
      [],
      [],
    );
    const maxValidatorsResult = await this.contractService.callContract(
      stakingAddress,
      maxValidatorsData,
    );

    const withdrawalDelayData = this.contractService.encodeFunctionCall(
      'WITHDRAWAL_DELAY',
      [],
      [],
    );
    const withdrawalDelayResult = await this.contractService.callContract(
      stakingAddress,
      withdrawalDelayData,
    );

    // getStats() 결과 파싱
    // getStats()는 (uint256, uint256, uint256, uint256, uint256) 반환
    // (totalStaked, totalValidators, activeValidators, totalRewards, totalSlashed)
    // 각 값은 32바이트 = 64 hex characters
    const statsHex = statsResult.result.startsWith('0x')
      ? statsResult.result.slice(2)
      : statsResult.result;

    const totalStaked = '0x' + statsHex.slice(0, 64);
    const totalValidators = parseInt(statsHex.slice(64, 128), 16);
    const activeValidators = parseInt(statsHex.slice(128, 192), 16);
    const totalRewards = '0x' + statsHex.slice(192, 256);
    const totalSlashed = '0x' + statsHex.slice(256, 320);

    return {
      totalStaked,
      totalValidators,
      activeValidators,
      totalRewards,
      totalSlashed,
      minStake: minStakeResult.result,
      maxValidators: Number(maxValidatorsResult.result),
      withdrawalDelay: withdrawalDelayResult.result,
    };
  }

  /**
   * Validator 활성화 (Backend에서 호출)
   *
   * StakingContract의 activateValidator() 함수를 호출하여
   * Pending 상태의 Validator를 Active 상태로 변경합니다.
   *
   * @param validatorAddress - 활성화할 Validator 주소
   * @returns 트랜잭션 해시 및 상태
   */
  async activateValidator(
    validatorAddress: Address,
  ): Promise<{ hash: string; status: string }> {
    const deployed = this.contractService.getDeployedContracts();
    if (!deployed || !deployed.staking) {
      throw new Error('StakingContract is not deployed');
    }

    const stakingAddress = deployed.staking.address;

    const data = this.contractService.encodeFunctionCall(
      'activateValidator',
      ['address'],
      [validatorAddress],
    );

    // Genesis Account 0 (배포 계정)으로 실행
    const genesisAccount0 = this.contractService.getGenesisAccount0();
    if (!genesisAccount0 || !genesisAccount0.privateKey) {
      throw new Error('Genesis account 0 is not loaded');
    }

    const result = await this.contractService.executeContractByUser(
      stakingAddress,
      data,
      genesisAccount0.privateKey,
      0n,
    );

    // 트랜잭션 상태 확인 (실패 시 에러 발생)
    this.logger.log(
      `Activating validator ${validatorAddress}, waiting for transaction confirmation...`,
    );
    const success = await this.contractService.waitForTransaction(
      result.hash,
      30, // 최대 30번 재시도
      2000, // 2초마다 체크
    );

    if (!success) {
      throw new Error(
        `Failed to activate validator ${validatorAddress}: transaction reverted or not included`,
      );
    }

    this.logger.log(`Validator ${validatorAddress} activated successfully`);

    return result;
  }

  /**
   * Proposer 보상 지급 (Backend에서 호출)
   *
   * StakingContract의 rewardProposer() 함수를 호출하여
   * Proposer에게 즉시 보상을 지급합니다.
   *
   * 이더리움:
   * - 블록 생성 시 즉시 Proposer에게 보상 지급
   *
   * 우리:
   * - 동일하게 구현
   * - BlockProducer에서 블록 생성 시마다 호출
   *
   * @param validatorAddress - Proposer 주소
   * @param amount - 보상 금액 (Wei, BigInt)
   * @returns 트랜잭션 해시 및 상태
   */
  async rewardProposer(
    validatorAddress: Address,
    amount: bigint,
  ): Promise<{ hash: string; status: string }> {
    const deployed = this.contractService.getDeployedContracts();
    if (!deployed || !deployed.staking) {
      throw new Error('StakingContract is not deployed');
    }

    const stakingAddress = deployed.staking.address;

    const data = this.contractService.encodeFunctionCall(
      'rewardProposer',
      ['address', 'uint256'],
      [validatorAddress, `0x${amount.toString(16)}`],
    );

    // Genesis Account 0 (배포 계정)으로 실행
    const genesisAccount0 = this.contractService.getGenesisAccount0();
    if (!genesisAccount0) {
      throw new Error('Genesis account 0 is not loaded');
    }

    return await this.contractService.executeContractByUser(
      stakingAddress,
      data,
      genesisAccount0.privateKey,
      0n,
    );
  }

  /**
   * Committee 보상 누적 (Backend에서 호출)
   *
   * StakingContract의 accumulateCommitteeReward() 함수를 호출하여
   * Committee 멤버의 보상을 Epoch 단위로 누적합니다.
   *
   * 이더리움:
   * - Attestation 제출 시 보상을 Epoch 단위로 누적
   * - Epoch 완료 시 일괄 지급
   *
   * 우리:
   * - 동일하게 구현
   * - BlockProducer에서 Attestation 제출 시마다 호출
   * - distributeEpochRewards()에서 일괄 지급
   *
   * @param epoch - Epoch 번호
   * @param validatorAddress - Committee 멤버 주소
   * @param amount - 보상 금액 (Wei, BigInt)
   * @returns 트랜잭션 해시 및 상태
   */
  async accumulateCommitteeReward(
    epoch: number,
    validatorAddress: Address,
    amount: bigint,
  ): Promise<{ hash: string; status: string }> {
    const deployed = this.contractService.getDeployedContracts();
    if (!deployed || !deployed.staking) {
      throw new Error('StakingContract is not deployed');
    }

    const stakingAddress = deployed.staking.address;

    const data = this.contractService.encodeFunctionCall(
      'accumulateCommitteeReward',
      ['uint256', 'address', 'uint256'],
      [
        `0x${BigInt(epoch).toString(16)}`,
        validatorAddress,
        `0x${amount.toString(16)}`,
      ],
    );

    // Genesis Account 0 (배포 계정)으로 실행
    const genesisAccount0 = this.contractService.getGenesisAccount0();
    if (!genesisAccount0) {
      throw new Error('Genesis account 0 is not loaded');
    }

    return await this.contractService.executeContractByUser(
      stakingAddress,
      data,
      genesisAccount0.privateKey,
      0n,
    );
  }

  /**
   * Epoch 보상 일괄 지급 (Backend에서 호출)
   *
   * StakingContract의 distributeEpochRewards() 함수를 호출하여
   * 특정 Epoch의 누적된 Committee 보상을 일괄 지급합니다.
   *
   * 이더리움:
   * - Epoch 완료 시 모든 Committee 보상을 일괄 지급
   * - Beacon Chain이 자동으로 호출
   *
   * 우리:
   * - 동일하게 구현
   * - BlockProducer에서 Epoch 완료 시 자동 호출
   *
   * @param epoch - Epoch 번호
   * @param validatorAddresses - 보상을 지급할 Validator 주소 배열
   * @returns 총 지급된 보상 금액 (Wei, BigInt)
   */
  async distributeEpochRewards(
    epoch: number,
    validatorAddresses: Address[],
  ): Promise<{ hash: string; status: string; totalDistributed: bigint }> {
    const deployed = this.contractService.getDeployedContracts();
    if (!deployed || !deployed.staking) {
      throw new Error('StakingContract is not deployed');
    }

    const stakingAddress = deployed.staking.address;

    // distributeEpochRewards(uint256 epoch, address[] calldata validatorAddresses)
    // address[] 배열 인코딩: offset + length + addresses
    const data = this.contractService.encodeFunctionCall(
      'distributeEpochRewards',
      ['uint256', 'address[]'],
      [`0x${BigInt(epoch).toString(16)}`, validatorAddresses],
    );

    // Genesis Account 0 (배포 계정)으로 실행
    const genesisAccount0 = this.contractService.getGenesisAccount0();
    if (!genesisAccount0 || !genesisAccount0.privateKey) {
      throw new Error('Genesis account 0 is not loaded');
    }

    const result = await this.contractService.executeContractByUser(
      stakingAddress,
      data,
      genesisAccount0.privateKey,
      0n,
    );

    // 트랜잭션 결과에서 totalDistributed 추출 (실제로는 Receipt의 logs에서 추출해야 함)
    // 일단 트랜잭션 해시만 반환하고, 나중에 Receipt에서 확인
    return {
      ...result,
      totalDistributed: 0n, // TODO: Receipt에서 실제 값 추출
    };
  }

  /**
   * 출금 대기열에 요청이 있는지 확인
   *
   * @returns 출금 요청이 있으면 true, 없으면 false
   */
  async hasPendingWithdrawals(): Promise<boolean> {
    const deployed = this.contractService.getDeployedContracts();
    if (!deployed || !deployed.staking) {
      return false;
    }

    const stakingAddress = deployed.staking.address;

    // getWithdrawalQueue()는 view 함수이므로 eth_call 사용
    const data = this.contractService.encodeFunctionCall(
      'getWithdrawalQueue',
      [],
      [],
    );

    try {
      const result = await this.contractService.callContract(
        stakingAddress,
        data,
      );

      // 결과 파싱 (address[] 반환)
      // 배열 길이는 첫 32바이트에 저장됨
      const resultHex = result.result.startsWith('0x')
        ? result.result.slice(2)
        : result.result;

      if (resultHex.length < 64) {
        return false;
      }

      // 배열 길이 추출 (첫 32바이트)
      const arrayLength = parseInt(resultHex.slice(0, 64), 16);

      return arrayLength > 0;
    } catch (error: any) {
      this.logger.warn(`Failed to check withdrawal queue: ${error.message}`);
      // 에러 발생 시 안전하게 false 반환 (호출은 계속 진행)
      return false;
    }
  }

  /**
   * Genesis Validator 등록 (VM을 통해 직접 호출, 트랜잭션 없이)
   *
   * 현재 상황:
   * - Execution Layer와 Consensus Layer가 통합되어 있음
   * - Validator 등록을 트랜잭션으로 처리하면 순환 의존성 발생:
   *   1. 블록 생성 → Validator 필요
   *   2. Validator 등록 → 트랜잭션 필요
   *   3. 트랜잭션 실행 → 블록 필요
   *
   * 해결 방법:
   * - Genesis Block 생성 시점에 VM을 통해 직접 StakingContract 함수 호출
   * - 트랜잭션 없이 상태 변경 (가스 비용 없음, 블록에 포함되지 않음)
   * - 이더리움 PoS와 달리 Execution Layer와 Consensus Layer가 분리되지 않았기 때문
   *
   * 추후 레이어 분리 시:
   * - Execution Layer: Deposit Contract에 트랜잭션으로 ETH 예치
   * - Consensus Layer: Beacon Chain이 Deposit 이벤트를 감지하여 Validator 등록
   * - 레이어 분리 시에는 트랜잭션 방식으로 처리 가능 (순환 의존성 없음)
   *
   * @param account - Genesis 계정 정보
   * @param blockService - BlockService 인스턴스 (VM 접근용)
   * @param blockNumber - 블록 번호 (Genesis Block은 0)
   * @param timestamp - 타임스탬프 (밀리초)
   * @returns 등록 성공 여부
   */
  async registerGenesisValidatorDirect(
    account: GenesisAccount,
    contractService: any,
    blockNumber: number,
    timestamp: number,
  ): Promise<boolean> {
    const deployed = this.contractService.getDeployedContracts();
    if (!deployed || !deployed.staking) {
      throw new Error('StakingContract is not deployed');
    }

    const stakingAddress = deployed.staking.address;

    try {
      // 이미 등록되어 있는지 확인
      const validatorInfo = await this.getValidator(account.address);
      if (
        validatorInfo.validatorAddress !==
        '0x0000000000000000000000000000000000000000'
      ) {
        // 이미 등록되어 있음
        if (validatorInfo.status === 'active_ongoing') {
          this.logger.debug(
            `Validator ${account.address} is already active. Skipping.`,
          );
          return true;
        }
        // pending 상태인 경우 활성화만 시도
        if (
          validatorInfo.status === 'pending_queued' ||
          validatorInfo.status === 'pending_initialized'
        ) {
          return await this.activateGenesisValidatorDirect(
            account,
            contractService,
            blockNumber,
            timestamp,
          );
        }
      }

      // 계정 잔액 확인
      const balance = await this.accountService.getBalance(account.address);
      const minStakeWei = BigInt(MIN_STAKE) * WEI_PER_DSTN;

      if (balance < minStakeWei) {
        throw new Error(
          `Account ${account.address} has insufficient balance (${balance} < ${minStakeWei})`,
        );
      }

      // deposit() 함수 호출 데이터 생성 (payable 함수이므로 value로 금액 전송)
      const depositData = this.contractService.encodeFunctionCall(
        'deposit',
        [],
        [],
      );

      // VM을 통해 직접 deposit() 호출 (트랜잭션 없이)
      const depositResult = (await (
        contractService as {
          executeContractDirect: (
            to: string,
            data: string,
            from: string,
            privateKey: string,
            value: bigint,
            blockNumber: number,
            timestamp: number,
          ) => Promise<{
            result: string;
            status: 1 | 0;
            gasUsed: bigint;
            logs: { address: string; topics: string[]; data: string }[];
          }>;
        }
      ).executeContractDirect(
        stakingAddress,
        depositData,
        account.address,
        account.privateKey,
        minStakeWei, // value로 32 DSTN 전송
        blockNumber,
        timestamp,
      )) as {
        result: string;
        status: 1 | 0;
        logs: { address: string; topics: string[]; data: string }[];
        gasUsed: bigint;
      };

      // deposit()은 payable 함수이므로 반환값이 없을 수 있음 (result가 '0x'여도 정상)
      // status가 1이면 성공, 0이면 실패
      if (!depositResult || depositResult.status === 0) {
        throw new Error(
          `Deposit failed: status=${depositResult?.status}, result=${depositResult?.result}`,
        );
      }

      // activateValidator() 호출
      return await this.activateGenesisValidatorDirect(
        account,
        contractService,
        blockNumber,
        timestamp,
      );
    } catch (error) {
      this.logger.error(
        `Failed to register validator ${account.address} via VM: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Genesis Validator 활성화 (VM을 통해 직접 호출, 트랜잭션 없이)
   *
   * @param account - Genesis 계정 정보
   * @param contractService - ContractService 인스턴스 (VM 접근용)
   * @param blockNumber - 블록 번호
   * @param timestamp - 타임스탬프 (밀리초)
   * @returns 활성화 성공 여부
   */
  private async activateGenesisValidatorDirect(
    account: GenesisAccount,
    contractService: any,
    blockNumber: number,
    timestamp: number,
  ): Promise<boolean> {
    const deployed = this.contractService.getDeployedContracts();
    if (!deployed || !deployed.staking) {
      throw new Error('StakingContract is not deployed');
    }

    const stakingAddress = deployed.staking.address;

    // activateValidator(address validatorAddress) 함수 호출 데이터 생성
    const activateData = this.contractService.encodeFunctionCall(
      'activateValidator',
      ['address'],
      [account.address],
    );

    // VM을 통해 직접 activateValidator() 호출 (트랜잭션 없이)
    const activateResult = (await (
      contractService as {
        executeContractDirect: (
          to: string,
          data: string,
          from: string,
          privateKey: string,
          value: bigint,
          blockNumber: number,
          timestamp: number,
        ) => Promise<{
          result: string;
          status: 1 | 0;
          gasUsed: bigint;
          logs: { address: string; topics: string[]; data: string }[];
        }>;
      }
    ).executeContractDirect(
      stakingAddress,
      activateData,
      account.address,
      account.privateKey,
      0n, // value는 0
      blockNumber,
      timestamp,
    )) as {
      result: string;
      status: 1 | 0;
      logs: { address: string; topics: string[]; data: string }[];
      gasUsed: bigint;
    };

    // activateValidator()도 반환값이 없을 수 있음 (result가 '0x'여도 정상)
    // status가 1이면 성공, 0이면 실패
    if (!activateResult || activateResult.status === 0) {
      throw new Error(
        `Activation failed: status=${activateResult?.status}, result=${activateResult?.result}`,
      );
    }

    return true;
  }

  /**
   * 출금 처리 (VM을 통해 직접 호출, 트랜잭션 없이)
   *
   * 이더리움:
   * - Beacon Chain이 Execution Layer로 출금 정보 전달
   * - Execution Layer가 블록 생성 시 자동 처리 (트랜잭션 없이)
   *
   * 우리:
   * - ContractService의 VM을 통해 processWithdrawals() 직접 호출
   * - 트랜잭션 풀을 거치지 않음
   * - 블록 생성 시 자동 처리
   *
   * @param maxProcess - 최대 처리할 출금 요청 수 (가스 제한 방지)
   * @param contractService - ContractService 인스턴스 (VM 접근용)
   * @param blockNumber - 현재 블록 번호
   * @param timestamp - 현재 블록 타임스탬프 (밀리초)
   * @returns 처리된 출금 요청 수
   */
  async processWithdrawalsDirect(
    maxProcess: number = 10,
    contractService: any, // ContractService 타입 (순환 의존성 방지)
    blockNumber: number,
    timestamp: number,
  ): Promise<{ processed: number }> {
    const deployed = this.contractService.getDeployedContracts();
    if (!deployed || !deployed.staking) {
      throw new Error('StakingContract is not deployed');
    }

    const stakingAddress = deployed.staking.address;

    // processWithdrawals(uint256 maxProcess) 함수 호출 데이터 생성
    const data = this.contractService.encodeFunctionCall(
      'processWithdrawals',
      ['uint256'],
      [`0x${BigInt(maxProcess).toString(16)}`],
    );

    // Genesis Account 0 (배포 계정)으로 실행
    const genesisAccount0 = this.contractService.getGenesisAccount0();
    if (!genesisAccount0 || !genesisAccount0.privateKey) {
      throw new Error('Genesis account 0 is not loaded or private key missing');
    }

    // ContractService의 VM을 통해 직접 호출 (트랜잭션 없이)
    const result = (await (
      contractService as {
        executeContractDirect: (
          to: string,
          data: string,
          from: string,
          privateKey: string,
          value: bigint,
          blockNumber: number,
          timestamp: number,
        ) => Promise<{
          result: string;
          status: 1 | 0;
          gasUsed: bigint;
          logs: { address: string; topics: string[]; data: string }[];
        }>;
      }
    ).executeContractDirect(
      stakingAddress,
      data,
      genesisAccount0.address,
      genesisAccount0.privateKey,
      0n, // value는 0
      blockNumber,
      timestamp,
    )) as {
      result: string;
      logs: { address: string; topics: string[]; data: string }[];
      gasUsed: bigint;
    };

    // 반환값 파싱 (uint256 processed)
    let processed = 0;
    if (result && result.result) {
      const resultHex = result.result.startsWith('0x')
        ? result.result.slice(2)
        : result.result;
      processed = parseInt(resultHex, 16);
    }

    // Withdrawn 이벤트 로그에서도 확인 (더 정확)
    if (result && result.logs) {
      const eventSignature = 'Withdrawn(address,address,uint256)';
      const eventSignatureHash = keccak('keccak256')
        .update(eventSignature)
        .digest('hex');
      const withdrawnEventSignature = `0x${eventSignatureHash}`;

      const withdrawnCount = result.logs.filter(
        (log: any) => log.topics && log.topics[0] === withdrawnEventSignature,
      ).length;

      // 이벤트 로그가 더 정확하므로 우선 사용
      if (withdrawnCount > 0) {
        processed = withdrawnCount;
      }
    }

    if (processed > 0) {
      this.logger.log(
        `✅ Processed ${processed} withdrawal(s) directly via VM`,
      );
    }

    return { processed };
  }

  /**
   * 출금 처리 (트랜잭션 방식, API 호출용)
   *
   * @deprecated 블록 생성 시에는 processWithdrawalsDirect 사용
   * API에서 수동 호출할 때만 사용
   *
   * @param maxProcess - 최대 처리할 출금 요청 수 (가스 제한 방지)
   * @returns 처리된 출금 요청 수
   */
  async processWithdrawals(
    maxProcess: number = 10,
  ): Promise<{ hash: string; status: string; processed: number }> {
    const deployed = this.contractService.getDeployedContracts();
    if (!deployed || !deployed.staking) {
      throw new Error('StakingContract is not deployed');
    }

    const stakingAddress = deployed.staking.address;

    // processWithdrawals(uint256 maxProcess)
    const data = this.contractService.encodeFunctionCall(
      'processWithdrawals',
      ['uint256'],
      [`0x${BigInt(maxProcess).toString(16)}`],
    );

    // Genesis Account 0 (배포 계정)으로 실행
    const genesisAccount0 = this.contractService.getGenesisAccount0();
    if (!genesisAccount0 || !genesisAccount0.privateKey) {
      throw new Error('Genesis account 0 is not loaded');
    }

    const result = await this.contractService.executeContractByUser(
      stakingAddress,
      data,
      genesisAccount0.privateKey,
      0n,
    );

    // 트랜잭션 상태 확인
    this.logger.log(
      `Processing withdrawals, waiting for transaction confirmation...`,
    );
    const success = await this.contractService.waitForTransaction(
      result.hash,
      30, // 최대 30번 재시도
      2000, // 2초마다 체크
    );

    if (!success) {
      this.logger.warn(
        `Withdrawal processing transaction failed or not included: ${result.hash}`,
      );
      return {
        ...result,
        processed: 0,
      };
    }

    this.logger.log(
      `Withdrawal processing transaction succeeded: ${result.hash}`,
    );

    // Receipt에서 Withdrawn 이벤트를 파싱하여 processed 수 확인
    // waitForTransaction이 true를 반환했다는 것은 이미 Receipt가 LevelDB에 저장되어 있다는 의미
    let processed = 0;
    try {
      const receipt = await this.contractService.getTransactionReceipt(
        result.hash,
      );
      if (receipt && receipt.logs) {
        // Withdrawn 이벤트 시그니처: keccak256("Withdrawn(address,address,uint256)")
        // topics[0] = 이벤트 시그니처 해시
        // keccak256("Withdrawn(address,address,uint256)") 계산
        const eventSignature = 'Withdrawn(address,address,uint256)';
        const eventSignatureHash = keccak('keccak256')
          .update(eventSignature)
          .digest('hex');
        const withdrawnEventSignature = `0x${eventSignatureHash}`;

        // logs에서 Withdrawn 이벤트 개수 세기
        processed = receipt.logs.filter(
          (log) => log.topics && log.topics[0] === withdrawnEventSignature,
        ).length;
      } else if (receipt && !receipt.logs) {
        // Receipt는 있지만 logs가 없는 경우 (출금 처리된 항목이 없음)
        this.logger.debug(
          `Receipt found but no logs (no withdrawals processed): ${result.hash}`,
        );
      } else {
        // waitForTransaction이 성공했는데 Receipt가 없다는 것은 이상함
        // 이 경우는 거의 발생하지 않지만, 혹시 모를 경우를 대비
        this.logger.warn(
          `Receipt not found for transaction: ${result.hash}. This should not happen after waitForTransaction succeeded.`,
        );
      }
    } catch (error: any) {
      this.logger.warn(
        `Failed to parse withdrawal events from receipt: ${error.message}`,
      );
    }

    if (processed > 0) {
      this.logger.log(`✅ Processed ${processed} withdrawal(s)`);
    }

    return {
      ...result,
      processed,
    };
  }

  /**
   * 서버 시작 시 자동 실행
   *
   * 현재 상황:
   * - Execution Layer와 Consensus Layer가 통합되어 있음
   * - Validator 등록을 트랜잭션으로 처리하면 순환 의존성 발생:
   *   1. 블록 생성 → Validator 필요
   *   2. Validator 등록 → 트랜잭션 필요
   *   3. 트랜잭션 실행 → 블록 필요
   *
   * 해결 방법:
   * - Genesis Block 생성 시점에 VM을 통해 직접 StakingContract 함수 호출
   * - BlockService.createGenesisBlock()에서 registerGenesisValidatorDirect() 호출
   * - 트랜잭션 없이 상태 변경 (가스 비용 없음, 블록에 포함되지 않음)
   *
   * 추후 레이어 분리 시:
   * - Execution Layer: Deposit Contract에 트랜잭션으로 ETH 예치
   * - Consensus Layer: Beacon Chain이 Deposit 이벤트를 감지하여 Validator 등록
   * - 레이어 분리 시에는 트랜잭션 방식으로 처리 가능 (순환 의존성 없음)
   * - 이 경우 onApplicationBootstrap에서 트랜잭션 방식으로 등록하도록 변경
   *
   * 현재 구현:
   * - Genesis Validator 등록은 BlockService.createGenesisBlock()에서 처리됨
   * - 이 메서드는 StakingContract 배포 확인 및 Genesis Block 대기만 수행
   */
  async onApplicationBootstrap(): Promise<void> {
    // StakingContract가 배포되어 있는지 확인
    const deployed = this.contractService.getDeployedContracts();
    if (!deployed || !deployed.staking) {
      this.logger.warn(
        'StakingContract is not deployed. Genesis Validator registration will be skipped.',
      );
      return;
    }

    try {
      // Genesis Block 생성 완료 대기 (BlockService에서 Validator 등록을 처리하므로 대기만 함)
      await this.waitForGenesisBlock(10000);
      this.logger.log(
        'Genesis Block confirmed. Validator registration is handled by BlockService.',
      );
    } catch (error) {
      this.logger.error(`Failed to wait for Genesis Block: ${error.message}`);
    }

    // 기존 트랜잭션 방식 등록 코드 (주석 처리)
    // 추후 레이어 분리 시 사용 예정:
    /*
    try {
      // Genesis Block 생성 완료 대기 (최대 10초)
      await this.waitForGenesisBlock(10000);

      // 첫 번째 Validator만 동기로 등록 (블록 생성을 위해 필수)
      this.logger.log(
        'Registering first Genesis Validator synchronously (for block production)...',
      );
      try {
        await this.registerSingleGenesisValidator(0); // 첫 번째 계정
        this.logger.log(
          'First Genesis Validator registered. Block production can start.',
        );
      } catch (error) {
        this.logger.error(
          `Failed to register first Genesis Validator: ${String(error)}`,
        );
        // 첫 번째 등록 실패 시에도 서버는 계속 실행 (수동 등록 가능)
      }

      // 나머지 Validator는 비동기로 등록 (서버 시작을 막지 않음)
      setImmediate(() => {
        void (async () => {
          try {
            await this.registerGenesisValidators(1); // 1번부터 시작 (0번은 이미 등록됨)
          } catch (error) {
            this.logger.error(
              `Failed to register remaining Genesis Validators: ${String(error)}`,
            );
            // 에러가 발생해도 서버는 계속 실행
          }
        })();
      });
    } catch (error) {
      this.logger.error(`Failed to wait for Genesis Block: ${error.message}`);
      // 에러가 발생해도 서버는 계속 실행
    }
    */
  }

  /**
   * Genesis Block 생성 완료 대기
   *
   * KV DB 삭제 후 재시작 시 Genesis Block이 다시 생성되므로,
   * 생성이 완료될 때까지 대기합니다.
   *
   * @param timeoutMs - 최대 대기 시간 (밀리초)
   */
  private async waitForGenesisBlock(timeoutMs: number): Promise<void> {
    const startTime = Date.now();
    const checkInterval = 500; // 500ms마다 확인

    while (Date.now() - startTime < timeoutMs) {
      try {
        // BlockService를 통해 Genesis Block 확인
        // 간단히 StakingContract 호출로 상태 확인
        const deployed = this.contractService.getDeployedContracts();
        if (deployed?.staking) {
          const stakingAddress = deployed.staking.address;

          // MIN_STAKE 조회로 컨트랙트 접근 가능 여부 확인
          const data = this.contractService.encodeFunctionCall(
            'MIN_STAKE',
            [],
            [],
          );
          await this.contractService.callContract(stakingAddress, data);

          // 성공하면 Genesis Block이 생성된 것
          this.logger.debug(
            'Genesis Block confirmed. Proceeding with Validator registration.',
          );
          return;
        }
      } catch {
        // 아직 Genesis Block이 생성되지 않았거나, 컨트랙트 접근 불가
        await new Promise((resolve) => setTimeout(resolve, checkInterval));
        continue;
      }
    }

    this.logger.warn(
      `Genesis Block not confirmed within ${timeoutMs}ms. Proceeding anyway.`,
    );
  }

  /**
   * 단일 Genesis Validator 등록 (동기)
   *
   * 블록 생성을 위해 최소 1명의 Validator를 동기로 등록합니다.
   *
   * @param accountIndex - genesis-accounts.json에서 등록할 계정 인덱스 (0부터 시작)
   */
  private async registerSingleGenesisValidator(
    accountIndex: number,
  ): Promise<void> {
    const accountsPath = this.findAccountsFile();
    if (!accountsPath) {
      throw new Error('genesis-accounts.json not found');
    }

    const fileContent = fs.readFileSync(accountsPath, 'utf8');
    const accounts: GenesisAccount[] = JSON.parse(fileContent);

    if (accountIndex >= accounts.length) {
      throw new Error(
        `Account index ${accountIndex} is out of range (total: ${accounts.length})`,
      );
    }

    const account = accounts[accountIndex];

    try {
      // 이미 등록되어 있는지 확인
      const validatorInfo = await this.getValidator(account.address);

      // validatorAddress가 0x0000...이 아니면 이미 등록됨
      if (
        validatorInfo.validatorAddress !==
        '0x0000000000000000000000000000000000000000'
      ) {
        // 이미 등록되어 있지만, 활성화 안 된 경우 활성화 시도
        if (
          validatorInfo.status === 'pending_queued' ||
          validatorInfo.status === 'pending_initialized'
        ) {
          this.logger.debug(
            `Validator ${account.address} is registered but not activated. Attempting activation...`,
          );
          const activateResult = await this.activateValidator(account.address);
          await this.waitForTransactionConfirmation(activateResult.hash, 30000);
          this.logger.log(
            `✅ Successfully activated validator ${account.address}`,
          );
          return;
        } else if (validatorInfo.status === 'active_ongoing') {
          this.logger.log(
            `Validator ${account.address} is already active. Skipping.`,
          );
          return;
        } else {
          throw new Error(
            `Validator ${account.address} is in unexpected status: ${validatorInfo.status}`,
          );
        }
      }

      // 계정 잔액 확인
      const balance = await this.accountService.getBalance(account.address);
      const minStakeWei = BigInt(MIN_STAKE) * WEI_PER_DSTN;

      if (balance < minStakeWei) {
        throw new Error(
          `Account ${account.address} has insufficient balance (${balance} < ${minStakeWei})`,
        );
      }

      // deposit() 호출 (32 DSTN 예치)
      this.logger.debug(
        `Depositing ${MIN_STAKE} DSTN for validator ${account.address}...`,
      );
      const depositResult = await this.deposit(
        account.privateKey,
        `0x${minStakeWei.toString(16)}`,
      );

      // 트랜잭션 완료 대기
      await this.waitForTransactionConfirmation(depositResult.hash, 30000);

      // activateValidator() 호출
      this.logger.debug(`Activating validator ${account.address}...`);
      const activateResult = await this.activateValidator(account.address);

      // 활성화 트랜잭션 완료 대기
      await this.waitForTransactionConfirmation(activateResult.hash, 30000);

      this.logger.log(
        `✅ Successfully registered validator ${account.address}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to register validator ${account.address}: ${error.message}`,
      );
      throw error; // 동기 등록이므로 에러를 다시 throw
    }
  }

  /**
   * Genesis Validator 자동 등록 (비동기)
   *
   * genesis-accounts.json에서 지정된 인덱스부터 90개 계정을 읽어서
   * StakingContract에 자동으로 등록합니다.
   *
   * 동작:
   * 1. genesis-accounts.json에서 startIndex부터 최대 90개 계정 읽기
   * 2. 각 계정이 이미 등록되어 있는지 확인
   * 3. 등록되지 않은 경우:
   *    - 계정 잔액 확인 (32 DSTN 이상 필요)
   *    - deposit() 호출 (32 DSTN 예치)
   *    - activateValidator() 호출 (활성화)
   *
   * @param startIndex - 시작 인덱스 (0번은 이미 등록되었으므로 1부터 시작)
   */
  private async registerGenesisValidators(
    startIndex: number = 0,
  ): Promise<void> {
    const accountsPath = this.findAccountsFile();
    if (!accountsPath) {
      this.logger.warn(
        'genesis-accounts.json not found. Skipping Genesis Validator registration.',
      );
      return;
    }

    const fileContent = fs.readFileSync(accountsPath, 'utf8');
    const accounts: GenesisAccount[] = JSON.parse(fileContent);

    // startIndex부터 최대 90개까지 등록
    const endIndex = Math.min(
      startIndex + GENESIS_VALIDATOR_COUNT,
      accounts.length,
    );
    const accountsToRegister = accounts.slice(startIndex, endIndex);

    this.logger.log(
      `Registering ${accountsToRegister.length} Genesis Validators to StakingContract...`,
    );

    let registered = 0;
    let skipped = 0;
    let failed = 0;

    for (const account of accountsToRegister) {
      try {
        // 이미 등록되어 있는지 확인
        const validatorInfo = await this.getValidator(account.address);

        // validatorAddress가 0x0000...이 아니면 이미 등록됨
        if (
          validatorInfo.validatorAddress !==
          '0x0000000000000000000000000000000000000000'
        ) {
          // 이미 등록되어 있지만, 활성화 안 된 경우 활성화 시도
          if (
            validatorInfo.status === 'pending_queued' ||
            validatorInfo.status === 'pending_initialized'
          ) {
            this.logger.debug(
              `Validator ${account.address} is registered but not activated. Attempting activation...`,
            );
            try {
              // activateValidator() 호출
              const activateResult = await this.activateValidator(
                account.address,
              );
              // 활성화 트랜잭션 완료 대기
              await this.waitForTransactionConfirmation(
                activateResult.hash,
                30000,
              );
              registered++;
              this.logger.debug(
                `Successfully activated validator ${account.address} (${registered}/${accountsToRegister.length})`,
              );
            } catch (activateError) {
              this.logger.error(
                `Failed to activate validator ${account.address}: ${activateError.message}`,
              );
              failed++;
            }
          } else {
            // 이미 활성화되었거나 다른 상태
            this.logger.debug(
              `Validator ${account.address} is already registered with status: ${validatorInfo.status}. Skipping.`,
            );
            skipped++;
          }
          continue;
        }

        // 계정 잔액 확인
        const balance = await this.accountService.getBalance(account.address);
        const minStakeWei = BigInt(MIN_STAKE) * WEI_PER_DSTN;

        if (balance < minStakeWei) {
          this.logger.warn(
            `Account ${account.address} has insufficient balance (${balance} < ${minStakeWei}). Skipping.`,
          );
          failed++;
          continue;
        }

        // deposit() 호출 (32 DSTN 예치)
        this.logger.debug(
          `Depositing ${MIN_STAKE} DSTN for validator ${account.address}...`,
        );
        const depositResult = await this.deposit(
          account.privateKey,
          `0x${minStakeWei.toString(16)}`,
        );

        // 트랜잭션 완료 대기 (블록 생성 시간 고려: 12초)
        // KV DB 삭제 후 재시작 시 블록 생성이 느릴 수 있으므로 충분한 대기
        await this.waitForTransactionConfirmation(depositResult.hash, 30000);

        // activateValidator() 호출
        this.logger.debug(`Activating validator ${account.address}...`);
        const activateResult = await this.activateValidator(account.address);

        // 활성화 트랜잭션 완료 대기
        await this.waitForTransactionConfirmation(activateResult.hash, 30000);

        registered++;
        this.logger.debug(
          `Successfully registered validator ${account.address} (${registered}/${accountsToRegister.length})`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to register validator ${account.address}: ${error.message}`,
        );
        failed++;
      }
    }

    this.logger.log(
      `Genesis Validator registration completed: ${registered} registered, ${skipped} skipped, ${failed} failed`,
    );

    if (failed > 0) {
      this.logger.warn(
        `${failed} validators failed to register. They may need manual registration.`,
      );
    }
  }

  /**
   * 트랜잭션 확인 대기
   *
   * KV DB 삭제 후 재시작 시 블록 생성이 느릴 수 있으므로,
   * 트랜잭션이 블록에 포함될 때까지 대기합니다.
   *
   * @param txHash - 트랜잭션 해시
   * @param timeoutMs - 최대 대기 시간 (밀리초)
   */
  private async waitForTransactionConfirmation(
    txHash: string,
    timeoutMs: number,
  ): Promise<void> {
    const startTime = Date.now();
    const checkInterval = 2000; // 2초마다 확인

    while (Date.now() - startTime < timeoutMs) {
      try {
        // TransactionService를 통해 트랜잭션 확인
        // 간단히 블록 생성 대기 (실제로는 트랜잭션 Receipt 확인 필요)
        await new Promise((resolve) => setTimeout(resolve, checkInterval));

        // TODO: 실제 트랜잭션 Receipt 확인 로직 추가
        // 현재는 블록 생성 시간(12초)을 고려하여 대기
        return;
      } catch (error) {
        this.logger.warn(
          `Failed to confirm transaction ${txHash}: ${error.message}`,
        );
        await new Promise((resolve) => setTimeout(resolve, checkInterval));
      }
    }

    this.logger.warn(
      `Transaction ${txHash} not confirmed within ${timeoutMs}ms. Proceeding anyway.`,
    );
  }

  /**
   * genesis-accounts.json 파일 찾기
   */
  private findAccountsFile(): string | null {
    const possiblePaths = [
      path.resolve(process.cwd(), 'genesis-accounts.json'),
      path.resolve(__dirname, '../../genesis-accounts.json'),
      path.resolve(__dirname, '../../../genesis-accounts.json'),
    ];

    for (const filePath of possiblePaths) {
      if (fs.existsSync(filePath)) {
        return filePath;
      }
    }

    return null;
  }
}
