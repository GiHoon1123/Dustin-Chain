import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

/**
 * 트랜잭션 서명 요청 DTO (테스트용)
 *
 * ⚠️ 주의:
 * - 실제 프로덕션에서는 절대 사용 금지
 * - 개인키를 서버로 보내면 안됨
 * - 오직 개발/테스트 목적
 *
 * 실제 사용:
 * - web3.js 같은 SDK가 클라이언트에서 서명
 * - 서명된 트랜잭션만 서버로 전송
 */
export class SignTransactionRequestDto {
  @ApiProperty({
    description: '개인키 (⚠️ 테스트용만! 실제로는 클라이언트에서 서명)',
    example:
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[a-fA-F0-9]{64}$/, {
    message: 'privateKey must be a valid private key (0x + 64 hex characters)',
  })
  privateKey: string;

  @ApiProperty({
    description: '수신자 주소',
    example: '0x742d35cc6634c0532925a3b844bc9e7595f0beb0',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[a-fA-F0-9]{40}$/, {
    message: 'to must be a valid Ethereum address (0x + 40 hex characters)',
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
}

/**
 * 트랜잭션 서명 응답 DTO
 */
export class SignTransactionResponseDto {
  @ApiProperty({
    description: '트랜잭션 해시',
    example:
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  })
  hash: string;

  @ApiProperty({
    description: '발신자 주소',
    example: '0x742d35cc6634c0532925a3b844bc9e7595f0beb0',
  })
  from: string;

  @ApiProperty({
    description: '수신자 주소',
    example: '0x742d35cc6634c0532925a3b844bc9e7595f0beb0',
  })
  to: string;

  @ApiProperty({
    description: '송금 금액 (Wei 단위)',
    example: '1000000000000000000',
  })
  value: string;

  @ApiProperty({
    description: '논스',
    example: 5,
  })
  nonce: number;

  @ApiProperty({
    description: '서명 v',
    example: 27,
  })
  v: number;

  @ApiProperty({
    description: '서명 r',
    example:
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  })
  r: string;

  @ApiProperty({
    description: '서명 s',
    example:
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  })
  s: string;
}
