import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

/**
 * 담보 예치 요청 DTO
 */
export class DepositCollateralRequestDto {
  @ApiProperty({
    description: '사용자 개인키',
    example: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[a-fA-F0-9]{64}$/, {
    message: 'privateKey must be a valid private key',
  })
  privateKey: string;

  @ApiProperty({
    description: '예치할 금액 (Wei 단위)',
    example: '1000000000000000000000',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+$/, {
    message: 'amount must be a non-negative integer string',
  })
  amount: string;
}

/**
 * 스테이블코인 발행 요청 DTO
 */
export class MintStablecoinRequestDto {
  @ApiProperty({
    description: '사용자 개인키',
    example: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[a-fA-F0-9]{64}$/, {
    message: 'privateKey must be a valid private key',
  })
  privateKey: string;

  @ApiProperty({
    description: '발행할 스테이블코인 양 (Wei 단위)',
    example: '500000000000000000000',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+$/, {
    message: 'stablecoinAmount must be a non-negative integer string',
  })
  stablecoinAmount: string;
}

/**
 * 스테이블코인 상환 요청 DTO
 */
export class RedeemStablecoinRequestDto {
  @ApiProperty({
    description: '사용자 개인키',
    example: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[a-fA-F0-9]{64}$/, {
    message: 'privateKey must be a valid private key',
  })
  privateKey: string;

  @ApiProperty({
    description: '상환할 스테이블코인 양 (Wei 단위)',
    example: '500000000000000000000',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+$/, {
    message: 'stablecoinAmount must be a non-negative integer string',
  })
  stablecoinAmount: string;
}

/**
 * 담보 인출 요청 DTO
 */
export class WithdrawCollateralRequestDto {
  @ApiProperty({
    description: '사용자 개인키',
    example: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[a-fA-F0-9]{64}$/, {
    message: 'privateKey must be a valid private key',
  })
  privateKey: string;

  @ApiProperty({
    description: '인출할 금액 (Wei 단위)',
    example: '1000000000000000000000',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+$/, {
    message: 'amount must be a non-negative integer string',
  })
  amount: string;
}

/**
 * 청산 요청 DTO
 */
export class LiquidateRequestDto {
  @ApiProperty({
    description: '청산 실행자 개인키',
    example: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[a-fA-F0-9]{64}$/, {
    message: 'privateKey must be a valid private key',
  })
  privateKey: string;

  @ApiProperty({
    description: '청산 대상 사용자 주소',
    example: '0x742d35cc6634c0532925a3b844bc9e7595f0beb0',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[a-fA-F0-9]{40}$/, {
    message: 'userAddress must be a valid Ethereum address',
  })
  userAddress: string;
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

/**
 * 포지션 조회 응답 DTO
 */
export class PositionResponseDto {
  @ApiProperty({
    description: '담보 양 (Wei 단위, hex)',
    example: '0x00000000000000000000000000000000000000000000000021e19e0c9bab240000',
  })
  collateralAmount: string;

  @ApiProperty({
    description: '부채 양 (Wei 단위, hex)',
    example: '0x00000000000000000000000000000000000000000000000006f05b59d3b20000',
  })
  debtAmount: string;

  @ApiProperty({
    description: '담보비율 (hex)',
    example: '0x00000000000000000000000000000000000000000000000000000000000000c8',
  })
  collateralRatio: string;
}

/**
 * 건강도 조회 응답 DTO
 */
export class HealthResponseDto {
  @ApiProperty({
    description: '건강도 여부',
    example: true,
  })
  isHealthy: boolean;
}

