import { ApiProperty } from '@nestjs/swagger';

/**
 * 지갑 생성 응답 DTO
 */
export class CreateWalletResponseDto {
  @ApiProperty({
    description: '개인키 (절대 공유하지 마세요!)',
    example:
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  })
  privateKey: string;

  @ApiProperty({
    description: '공개키',
    example:
      'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  })
  publicKey: string;

  @ApiProperty({
    description: '계정 주소',
    example: '0x1234567890123456789012345678901234567890',
  })
  address: string;

  @ApiProperty({
    description: '잔액 (Wei 단위)',
    example: '0',
  })
  balance: string;

  @ApiProperty({
    description: '논스',
    example: 0,
  })
  nonce: number;
}
