import { ApiProperty } from '@nestjs/swagger';

/**
 * 계정 정보 응답 DTO - Ethereum JSON-RPC 표준
 *
 * 이더리움 계정 상태:
 * - address: 계정 주소
 * - balance: 잔액 (Wei 단위, Hex String)
 * - nonce: 트랜잭션 순서 번호 (Hex String)
 */
export class AccountDto {
  @ApiProperty({
    description: '계정 주소 (0x + 40자리 hex)',
    example: '0x1234567890123456789012345678901234567890',
  })
  address: string;

  @ApiProperty({
    description: '잔액 (Wei, Hex String) - 1 DSTN = 10^18 Wei',
    example: '0xde0b6b3a7640000',
  })
  balance: string; // ✅ Hex String

  @ApiProperty({
    description: '논스 (Hex String)',
    example: '0x5',
  })
  nonce: string; // ✅ Hex String
}
