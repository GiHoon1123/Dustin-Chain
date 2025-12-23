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
   * 출금 처리 (VM을 통해 직접 호출, 트랜잭션 없이)
   *
   * 이더리움:
   * - Beacon Chain이 Execution Layer로 출금 정보 전달
   * - Execution Layer가 블록 생성 시 자동 처리 (트랜잭션 없이)
   *
   * 우리:
   * - BlockService의 VM을 통해 processWithdrawals() 직접 호출
   * - 트랜잭션 풀을 거치지 않음
   * - 블록 생성 시 자동 처리
   *
   * @param maxProcess - 최대 처리할 출금 요청 수 (가스 제한 방지)
   * @param blockService - BlockService 인스턴스 (VM 접근용)
   * @param blockNumber - 현재 블록 번호
   * @param timestamp - 현재 블록 타임스탬프 (밀리초)
   * @returns 처리된 출금 요청 수
   */
  async processWithdrawalsDirect(
    maxProcess: number = 10,
    blockService: any, // BlockService 타입 (순환 의존성 방지)
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
    if (!genesisAccount0) {
      throw new Error('Genesis account 0 is not loaded');
    }

    // BlockService의 VM을 통해 직접 호출 (트랜잭션 없이)
    const result = (await (
      blockService as {
        executeContractDirect: (
          to: string,
          data: string,
          from: string,
          value: bigint,
          blockNumber: number,
          timestamp: number,
        ) => Promise<{
          result: string;
          logs: { address: string; topics: string[]; data: string }[];
          gasUsed: bigint;
        }>;
      }
    ).executeContractDirect(
      stakingAddress,
      data,
      genesisAccount0.address,
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
   * Genesis 계정 중 처음 90명을 StakingContract에 자동 등록합니다.
   *
   * KV DB 삭제 시나리오 고려:
   * - LevelDB를 지우고 재실행하면 모든 상태가 초기화됨
   * - StakingContract의 상태도 모두 초기화됨
   * - 따라서 모든 Validator를 다시 등록해야 함
   * - 이미 등록된 Validator는 스킵 (정상 운영 시)
   *
   * 동작:
   * 1. StakingContract 배포 확인
   * 2. Genesis Block 생성 완료 대기
   * 3. Genesis Validator 자동 등록 (registerGenesisValidators만 비동기로 실행)
   *
   * 주의:
   * - onApplicationBootstrap은 동기로 완료되지만, registerGenesisValidators는 백그라운드에서 실행
   * - 다른 모듈의 onApplicationBootstrap은 정상적으로 동기 실행됨
   * - Validator 등록은 서버 시작을 지연시키지 않음
   */
  async onApplicationBootstrap(): Promise<void> {
    // StakingContract가 배포되어 있는지 확인
    const deployed = this.contractService.getDeployedContracts();
    if (!deployed || !deployed.staking) {
      this.logger.warn(
        'StakingContract is not deployed. Skipping Genesis Validator registration.',
      );
      return;
    }

    try {
      // Genesis Block 생성 완료 대기 (최대 10초)
      await this.waitForGenesisBlock(10000);

      // registerGenesisValidators만 비동기로 실행 (서버 시작을 막지 않음)
      // setImmediate를 사용하여 현재 실행 컨텍스트가 완료된 후 실행
      setImmediate(() => {
        void (async () => {
          try {
            await this.registerGenesisValidators();
          } catch (error) {
            this.logger.error(
              `Failed to register Genesis Validators: ${String(error)}`,
            );
            // 에러가 발생해도 서버는 계속 실행 (Validator 등록은 수동으로도 가능)
          }
        })();
      });

      // onApplicationBootstrap은 즉시 완료 (Promise 반환)
      // registerGenesisValidators는 백그라운드에서 계속 실행됨
    } catch (error) {
      this.logger.error(`Failed to wait for Genesis Block: ${error.message}`);
      // 에러가 발생해도 서버는 계속 실행
    }
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
   * Genesis Validator 자동 등록
   *
   * genesis-accounts.json에서 처음 90개 계정을 읽어서
   * StakingContract에 자동으로 등록합니다.
   *
   * 동작:
   * 1. genesis-accounts.json에서 처음 90개 계정 읽기
   * 2. 각 계정이 이미 등록되어 있는지 확인
   * 3. 등록되지 않은 경우:
   *    - 계정 잔액 확인 (32 DSTN 이상 필요)
   *    - deposit() 호출 (32 DSTN 예치)
   *    - activateValidator() 호출 (활성화)
   */
  private async registerGenesisValidators(): Promise<void> {
    const accountsPath = this.findAccountsFile();
    if (!accountsPath) {
      this.logger.warn(
        'genesis-accounts.json not found. Skipping Genesis Validator registration.',
      );
      return;
    }

    const fileContent = fs.readFileSync(accountsPath, 'utf8');
    const accounts: GenesisAccount[] = JSON.parse(fileContent);

    // 처음 90개만 등록
    const accountsToRegister = accounts.slice(0, GENESIS_VALIDATOR_COUNT);

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
          this.logger.debug(
            `Validator ${account.address} is already registered. Skipping.`,
          );
          skipped++;
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
