import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

/**
 * 스테이킹 예치 요청 DTO
 */
export class DepositRequestDto {
  @ApiProperty({
    description: '사용자 개인키',
    example:
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[a-fA-F0-9]{64}$/, {
    message: 'privateKey must be a valid private key',
  })
  privateKey: string;

  @ApiProperty({
    description: '예치할 금액 (Wei 단위, Hex String, 최소 32 DSTN)',
    example: '0x1bc16d674ec8000000', // 32 DSTN = 32 * 10^18 Wei
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[0-9a-fA-F]+$/, {
    message: 'amount must be a hex string with 0x prefix',
  })
  amount: string;
}

/**
 * 출금 주소 설정 요청 DTO
 */
export class SetWithdrawalAddressRequestDto {
  @ApiProperty({
    description: '사용자 개인키',
    example:
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[a-fA-F0-9]{64}$/, {
    message: 'privateKey must be a valid private key',
  })
  privateKey: string;

  @ApiProperty({
    description: '출금 주소',
    example: '0x742d35cc6634c0532925a3b844bc9e7595f0beb0',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[a-fA-F0-9]{40}$/, {
    message: 'withdrawalAddress must be a valid Ethereum address',
  })
  withdrawalAddress: string;
}

/**
 * 출금 요청 DTO
 */
export class RequestWithdrawalRequestDto {
  @ApiProperty({
    description: '사용자 개인키',
    example:
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[a-fA-F0-9]{64}$/, {
    message: 'privateKey must be a valid private key',
  })
  privateKey: string;
}

/**
 * Validator 정보 응답 DTO
 */
export class ValidatorInfoResponseDto {
  @ApiProperty({
    description: 'Validator 주소',
    example: '0x742d35cc6634c0532925a3b844bc9e7595f0beb0',
  })
  validatorAddress: string;

  @ApiProperty({
    description: '스테이킹 금액 (Wei 단위, Hex String)',
    example: '0x1bc16d674ec8000000', // 32 DSTN
  })
  stakedAmount: string;

  @ApiProperty({
    description: 'Validator 상태',
    example: 'active_ongoing',
    enum: [
      'pending_initialized',
      'pending_queued',
      'active_ongoing',
      'active_exiting',
      'exited_withdrawable',
      'exited_withdrawn',
    ],
  })
  status: string;

  @ApiProperty({
    description: '출금 주소',
    example: '0x742d35cc6634c0532925a3b844bc9e7595f0beb0',
  })
  withdrawalAddress: string;

  @ApiProperty({
    description: '활성화 시간 (Unix timestamp)',
    example: '1703123456',
  })
  activatedAt: string;

  @ApiProperty({
    description: '출금 요청 시간 (Unix timestamp, 없으면 0)',
    example: '0',
  })
  exitRequestedAt: string;

  @ApiProperty({
    description: '총 보상 (Wei 단위, Hex String)',
    example: '0x0',
  })
  totalRewards: string;

  @ApiProperty({
    description: '슬래싱된 금액 (Wei 단위, Hex String)',
    example: '0x0',
  })
  slashedAmount: string;
}

/**
 * Validator 목록 응답 DTO
 */
export class ValidatorsResponseDto {
  @ApiProperty({
    description: 'Validator 목록',
    type: [ValidatorInfoResponseDto],
  })
  validators: ValidatorInfoResponseDto[];

  @ApiProperty({
    description: '총 Validator 수',
    example: 10,
  })
  total: number;
}

/**
 * 스테이킹 통계 응답 DTO
 */
export class StakingStatsResponseDto {
  @ApiProperty({
    description: '전체 스테이킹 금액 (Wei 단위, Hex String)',
    example: '0x21e19e0c9bab2400000', // 10,000 DSTN
  })
  totalStaked: string;

  @ApiProperty({
    description: '전체 Validator 수',
    example: 10,
  })
  totalValidators: number;

  @ApiProperty({
    description: '활성 Validator 수',
    example: 8,
  })
  activeValidators: number;

  @ApiProperty({
    description: '전체 보상 (Wei 단위, Hex String)',
    example: '0x0',
  })
  totalRewards: string;

  @ApiProperty({
    description: '전체 슬래싱 금액 (Wei 단위, Hex String)',
    example: '0x0',
  })
  totalSlashed: string;

  @ApiProperty({
    description: '최소 스테이킹 금액 (Wei 단위, Hex String)',
    example: '0x1bc16d674ec8000000', // 32 DSTN
  })
  minStake: string;

  @ApiProperty({
    description: '최대 Validator 수',
    example: 100,
  })
  maxValidators: number;

  @ApiProperty({
    description: '출금 대기 시간 (초)',
    example: 60,
  })
  withdrawalDelay: string;
}

/**
 * 트랜잭션 응답 DTO
 */
export class TransactionResponseDto {
  @ApiProperty({
    description: '트랜잭션 해시',
    example: '0x1234567890abcdef...',
  })
  hash: string;

  @ApiProperty({
    description: '트랜잭션 상태',
    example: 'pending',
  })
  status: string;
}

