import { ApiProperty } from '@nestjs/swagger';

/**
 * 트랜잭션 정보 응답 DTO
 */
export class TransactionDto {
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
    example: '0x1234567890123456789012345678901234567890',
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

  @ApiProperty({
    description: '트랜잭션 상태',
    example: 'pending',
    enum: ['pending', 'confirmed', 'failed'],
  })
  status: string;

  @ApiProperty({
    description: '블록 번호 (confirmed 상태인 경우)',
    example: 123,
    required: false,
  })
  blockNumber?: number;

  @ApiProperty({
    description: '생성 시간',
    example: '2025-10-12T12:00:00.000Z',
  })
  timestamp: string;
}
