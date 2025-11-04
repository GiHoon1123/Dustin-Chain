import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

/**
 * 컨트랙트 호출 요청 DTO
 *
 * 이더리움 표준:
 * - eth_call과 동일한 구조
 * - data는 ABI 인코딩된 함수 호출 데이터
 *
 * 사용 예시:
 * - 프론트엔드에서 ABI를 사용해 함수 파라미터를 인코딩
 * - 인코딩된 data를 이 DTO로 전달
 * - 코어는 data를 그대로 EVM에 전달하여 실행
 */
export class CallContractRequestDto {
  @ApiProperty({
    description: '컨트랙트 주소',
    example: '0x29ee51dd76197743f997cdf76a6d3aa4d16d2bca',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[a-fA-F0-9]{40}$/, {
    message: 'to must be a valid Ethereum address',
  })
  to: string;

  @ApiProperty({
    description:
      '함수 호출 데이터 (ABI 인코딩된 hex string) - 함수 선택자(4바이트) + 파라미터 인코딩',
    example: '0x20965255',
    pattern: '^0x[a-fA-F0-9]*$',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[a-fA-F0-9]*$/, {
    message: 'data must be a valid hex string starting with 0x',
  })
  data: string;

  @ApiPropertyOptional({
    description:
      '호출자 주소 (선택사항, 없으면 빈 주소 사용) - view/pure 함수 호출 시 불필요',
    example: '0x4acdbc84ec7bbb08c556c745862d470c7e73e34f',
  })
  @IsOptional()
  @IsString()
  @Matches(/^0x[a-fA-F0-9]{40}$/, {
    message: 'from must be a valid Ethereum address',
  })
  from?: string;
}

/**
 * 컨트랙트 호출 응답 DTO
 *
 * 이더리움 표준:
 * - eth_call 응답과 동일한 구조
 * - result: 함수 실행 결과 (ABI 인코딩된 hex string)
 * - gasUsed: 사용한 가스 (hex string)
 */
export class CallContractResponseDto {
  @ApiProperty({
    description:
      '함수 실행 결과 (ABI 인코딩된 hex string) - view/pure 함수의 반환값',
    example: '0x000000000000000000000000000000000000000000000000000000000000002a',
  })
  result: string;

  @ApiProperty({
    description: '사용한 가스 (hex string)',
    example: '0x5208',
  })
  gasUsed: string;
}
