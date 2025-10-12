import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

/**
 * 잔액 추가 요청 DTO
 *
 * 검증 규칙:
 * - address: 0x로 시작하는 40자리 hex (이더리움 주소 형식)
 * - amount: 양수 정수 문자열 (Wei 단위)
 */
export class AddBalanceRequestDto {
  @ApiProperty({
    description: '계정 주소 (0x + 40자리 hex)',
    example: '0x1234567890123456789012345678901234567890',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[a-fA-F0-9]{40}$/, {
    message:
      'address must be a valid Ethereum address (0x + 40 hex characters)',
  })
  address: string;

  @ApiProperty({
    description: '추가할 금액 (Wei 단위, 양수)',
    example: '1000000000000000000',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[1-9]\d*$/, {
    message: 'amount must be a positive integer string',
  })
  amount: string;
}

/**
 * 잔액 추가 응답 DTO
 */
export class AddBalanceResponseDto {
  @ApiProperty({
    description: '성공 여부',
    example: true,
  })
  success: boolean;

  @ApiProperty({
    description: '계정 주소',
    example: '0x1234567890123456789012345678901234567890',
  })
  address: string;

  @ApiProperty({
    description: '추가된 금액 (Wei 단위)',
    example: '1000000000000000000',
  })
  amount: string;

  @ApiProperty({
    description: '업데이트된 잔액 (Wei 단위)',
    example: '2000000000000000000',
  })
  newBalance: string;
}
