import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

/**
 * Get Logs Request DTO (eth_getLogs)
 *
 * 이더리움 표준:
 * - eth_getLogs RPC 메서드와 동일한 파라미터 구조
 * - logsBloom을 활용한 빠른 필터링
 *
 * 필터 파라미터:
 * - fromBlock: 시작 블록 번호 (hex string 또는 "latest")
 * - toBlock: 끝 블록 번호 (hex string 또는 "latest")
 * - address: 컨트랙트 주소 (선택, 배열 가능)
 * - topics: 토픽 필터 배열 (선택, 최대 4개)
 */
export class GetLogsRequestDto {
  @ApiPropertyOptional({
    description:
      '시작 블록 번호 (hex string 또는 "latest") - 생략 시 최신 블록',
    example: '0x0',
  })
  @IsOptional()
  @IsString()
  fromBlock?: string;

  @ApiPropertyOptional({
    description:
      '끝 블록 번호 (hex string 또는 "latest") - 생략 시 최신 블록',
    example: 'latest',
  })
  @IsOptional()
  @IsString()
  toBlock?: string;

  @ApiPropertyOptional({
    description:
      '컨트랙트 주소 (선택) - 단일 주소 문자열 또는 주소 배열 (RPC 표준)',
    example: '0x29ee51dd76197743f997cdf76a6d3aa4d16d2bca',
  })
  @IsOptional()
  address?: string | string[];

  @ApiPropertyOptional({
    description:
      '토픽 필터 배열 (최대 4개) - 각 요소는 null, 단일 topic, 또는 topic 배열',
    example: [
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
    ],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  topics?: (string | string[] | null)[];
}

/**
 * Log DTO (이더리움 표준)
 */
export class LogDto {
  @ApiProperty({
    description: '로그를 발생시킨 컨트랙트 주소',
  })
  address: string;

  @ApiProperty({
    description: '로그 토픽 (indexed 파라미터)',
    type: [String],
  })
  topics: string[];

  @ApiProperty({
    description: '로그 데이터 (non-indexed 파라미터)',
  })
  data: string;

  @ApiProperty({
    description: '블록 번호 (Hex String)',
  })
  blockNumber: string;

  @ApiProperty({
    description: '트랜잭션 해시',
  })
  transactionHash: string;

  @ApiProperty({
    description: '트랜잭션 인덱스 (Hex String)',
  })
  transactionIndex: string;

  @ApiProperty({
    description: '블록 해시',
  })
  blockHash: string;

  @ApiProperty({
    description: '로그 인덱스 (Hex String)',
  })
  logIndex: string;

  @ApiProperty({
    description: '로그가 제거되었는지 여부',
  })
  removed: boolean;
}

