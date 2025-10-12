import { ApiProperty } from '@nestjs/swagger';

/**
 * 계정 정보 응답 DTO
 *
 * 이더리움 계정 상태:
 * - address: 계정 주소
 * - balance: 잔액 (Wei 단위)
 * - nonce: 트랜잭션 순서 번호
 */
export class AccountDto {
  @ApiProperty({
    description: '계정 주소 (0x + 40자리 hex)',
    example: '0x1234567890123456789012345678901234567890',
  })
  address: string;

  @ApiProperty({
    description: '잔액 (Wei 단위) - 1 DSTN = 10^18 Wei',
    example: '1000000000000000000',
  })
  balance: string;

  @ApiProperty({
    description: '논스 (트랜잭션 순서 번호)',
    example: 5,
  })
  nonce: number;
}
