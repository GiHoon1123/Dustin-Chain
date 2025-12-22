import { Injectable, Logger } from '@nestjs/common';
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
@Injectable()
export class StakingService {
  private readonly logger = new Logger(StakingService.name);

  constructor(private readonly contractService: ContractService) {}

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
    const resultHex = result.result.startsWith('0x') ? result.result.slice(2) : result.result;
    
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
    const resultHex = result.result.startsWith('0x') ? result.result.slice(2) : result.result;
    
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
      const address = '0x' + resultHex.slice(addressOffset + 24, addressOffset + 64); // 마지막 20바이트
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
    const statsData = this.contractService.encodeFunctionCall('getStats', [], []);
    const statsResult = await this.contractService.callContract(
      stakingAddress,
      statsData,
    );

    // 상수 값들 조회
    const minStakeData = this.contractService.encodeFunctionCall('MIN_STAKE', [], []);
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
    const statsHex = statsResult.result.startsWith('0x') ? statsResult.result.slice(2) : statsResult.result;
    
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
}

