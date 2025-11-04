import { ApiProperty } from '@nestjs/swagger';

/**
 * 트랜잭션 정보 응답 DTO - Ethereum JSON-RPC 표준
 *
 * 이더리움 표준:
 * - value, nonce, v, blockNumber, timestamp: Hex String
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
    description: '송금 금액 (Wei, Hex String)',
    example: '0xde0b6b3a7640000',
  })
  value: string; // ✅ Hex String

  @ApiProperty({
    description: '논스 (Hex String)',
    example: '0x5',
  })
  nonce: string; // ✅ Hex String

  @ApiProperty({
    description: '서명 v (Hex String)',
    example: '0x1b',
  })
  v: string; // ✅ Hex String

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
    description: '블록 번호 (confirmed 상태인 경우, Hex String)',
    example: '0x7b',
    required: false,
  })
  blockNumber?: string; // ✅ Hex String

  @ApiProperty({
    description: '생성 시간 (Unix timestamp, Hex String)',
    example: '0x617e0f42',
  })
  timestamp: string; // ✅ Hex String (Unix timestamp)
}
