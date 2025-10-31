import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

/**
 * 트랜잭션 전송 요청 DTO
 *
 * 이더리움:
 * - 이미 서명된 트랜잭션을 받음
 * - rawTransaction (RLP 인코딩) 또는 분리된 필드
 *
 * 우리:
 * - 분리된 필드로 받음 (간단하게)
 * - 나중에 RLP 지원 추가
 */
export class SendTransactionRequestDto {
  @ApiProperty({
    description: '발신자 주소',
    example: '0x742d35cc6634c0532925a3b844bc9e7595f0beb0',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[a-fA-F0-9]{40}$/, {
    message: 'from must be a valid Ethereum address',
  })
  from: string;

  @ApiProperty({
    description: '수신자 주소',
    example: '0x1234567890123456789012345678901234567890',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[a-fA-F0-9]{40}$/, {
    message: 'to must be a valid Ethereum address',
  })
  to: string;

  @ApiProperty({
    description: '송금 금액 (Wei 단위)',
    example: '1000000000000000000',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[1-9]\d*$/, {
    message: 'value must be a positive integer string',
  })
  value: string;

  @ApiProperty({
    description: '가스 가격 (Wei 단위)',
    example: '1000000000',
    required: false,
  })
  @IsString()
  @IsOptional()
  @Matches(/^[1-9]\d*$/, {
    message: 'gasPrice must be a positive integer string',
  })
  gasPrice?: string;

  @ApiProperty({
    description: '가스 한도',
    example: '21000',
    required: false,
  })
  @IsString()
  @IsOptional()
  @Matches(/^[1-9]\d*$/, {
    message: 'gasLimit must be a positive integer string',
  })
  gasLimit?: string;

  @ApiProperty({
    description: '데이터 필드 (Hex String)',
    example: '0x',
    required: false,
    default: '0x',
  })
  @IsString()
  @IsOptional()
  @Matches(/^0x[0-9a-fA-F]*$/, {
    message: 'data must be a hex string with 0x prefix',
  })
  data?: string;

  @ApiProperty({
    description: '논스 (발신자 계정의 현재 nonce)',
    example: 5,
  })
  @IsInt()
  @Min(0)
  nonce: number;

  @ApiProperty({
    description: '서명 v (EIP-155)',
    example: 27,
  })
  @IsInt()
  @Min(0)
  v: number;

  @ApiProperty({
    description: '서명 r (64 hex)',
    example:
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[a-fA-F0-9]{64}$/, {
    message: 'r must be 64 hex characters',
  })
  r: string;

  @ApiProperty({
    description: '서명 s (64 hex)',
    example:
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[a-fA-F0-9]{64}$/, {
    message: 's must be 64 hex characters',
  })
  s: string;
}

/**
 * 트랜잭션 전송 응답 DTO
 */
export class SendTransactionResponseDto {
  @ApiProperty({
    description: '성공 여부',
    example: true,
  })
  success: boolean;

  @ApiProperty({
    description: '트랜잭션 해시',
    example:
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  })
  hash: string;

  @ApiProperty({
    description: '트랜잭션 상태',
    example: 'pending',
  })
  status: string;

  @ApiProperty({
    description: '메시지',
    example: 'Transaction submitted to mempool',
  })
  message: string;
}
