import { ApiProperty } from '@nestjs/swagger';

/**
 * 잔액 추가 요청 DTO
 */
export class AddBalanceRequestDto {
  @ApiProperty({
    description: '계정 주소',
    example: '0x1234567890123456789012345678901234567890',
  })
  address: string;

  @ApiProperty({
    description: '추가할 금액 (Wei 단위)',
    example: '1000000000000000000',
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
