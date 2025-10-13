import { ApiProperty } from '@nestjs/swagger';

/**
 * Block Header DTO
 *
 * 블록 헤더 정보만 (트랜잭션 제외)
 */
export class BlockHeaderDto {
  @ApiProperty({
    description: '블록 번호',
    example: 123,
  })
  number: number;

  @ApiProperty({
    description: '블록 해시',
    example:
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  })
  hash: string;

  @ApiProperty({
    description: '이전 블록 해시',
    example:
      '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  })
  parentHash: string;

  @ApiProperty({
    description: '블록 생성 시간 (ISO 8601)',
    example: '2025-10-12T12:00:00.000Z',
  })
  timestamp: string;

  @ApiProperty({
    description: '블록 생성자 주소 (Proposer)',
    example: '0x0000000000000000000000000000000000000001',
  })
  proposer: string;

  @ApiProperty({
    description: '포함된 트랜잭션 개수',
    example: 5,
  })
  transactionCount: number;

  @ApiProperty({
    description: '상태 루트 해시',
    example:
      '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  })
  stateRoot: string;

  @ApiProperty({
    description: '트랜잭션 루트 해시',
    example:
      '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  })
  transactionsRoot: string;
}

/**
 * Block DTO (전체)
 *
 * 블록 전체 정보 (트랜잭션 포함)
 */
export class BlockDto {
  @ApiProperty({
    description: '블록 번호',
    example: 123,
  })
  number: number;

  @ApiProperty({
    description: '블록 해시',
    example:
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  })
  hash: string;

  @ApiProperty({
    description: '이전 블록 해시',
    example:
      '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  })
  parentHash: string;

  @ApiProperty({
    description: '블록 생성 시간 (ISO 8601)',
    example: '2025-10-12T12:00:00.000Z',
  })
  timestamp: string;

  @ApiProperty({
    description: '블록 생성자 주소 (Proposer)',
    example: '0x0000000000000000000000000000000000000001',
  })
  proposer: string;

  @ApiProperty({
    description: '포함된 트랜잭션 개수',
    example: 5,
  })
  transactionCount: number;

  @ApiProperty({
    description: '트랜잭션 리스트',
    type: 'array',
    items: { type: 'object' },
  })
  transactions: any[];

  @ApiProperty({
    description: '상태 루트 해시',
    example:
      '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  })
  stateRoot: string;

  @ApiProperty({
    description: '트랜잭션 루트 해시',
    example:
      '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  })
  transactionsRoot: string;
}

/**
 * Chain Stats DTO
 */
export class ChainStatsDto {
  @ApiProperty({
    description: '체인 높이 (총 블록 개수)',
    example: 1234,
  })
  height: number;

  @ApiProperty({
    description: '최신 블록 번호',
    example: 1233,
  })
  latestBlockNumber: number | null;

  @ApiProperty({
    description: '최신 블록 해시',
    example:
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  })
  latestBlockHash: string | null;

  @ApiProperty({
    description: '전체 트랜잭션 개수',
    example: 5678,
  })
  totalTransactions: number;

  @ApiProperty({
    description: 'Genesis Proposer 주소',
    example: '0x0000000000000000000000000000000000000001',
  })
  genesisProposer: string;
}

