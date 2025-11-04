import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

/**
 * 컨트랙트 쓰기 작업 요청 DTO
 *
 * 이더리움 표준:
 * - eth_sendTransaction과 유사한 구조
 * - data는 ABI 인코딩된 함수 호출 데이터
 *
 * 주의:
 * - 테스트용 API (제네시스 계정 0번 사용)
 * - 실제 프로덕션에서는 각 사용자가 자신의 지갑으로 서명
 *
 * 사용 예시:
 * - 프론트엔드에서 ABI를 사용해 함수 파라미터를 인코딩
 * - 인코딩된 data를 이 DTO로 전달
 * - 서버에서 제네시스 계정 0번으로 트랜잭션 생성, 서명, 제출
 */
export class ExecuteContractRequestDto {
  @ApiProperty({
    description: '컨트랙트 주소',
    example: '0xecf68c4b32adfa0d70dd8ab89a296513f831b593',
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
    example:
      '0x55241077000000000000000000000000000000000000000000000000000000000000002a',
    pattern: '^0x[a-fA-F0-9]*$',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[a-fA-F0-9]*$/, {
    message: 'data must be a valid hex string starting with 0x',
  })
  data: string;
}

/**
 * 컨트랙트 쓰기 작업 응답 DTO
 *
 * 이더리움 표준:
 * - eth_sendTransaction 응답과 유사한 구조
 * - hash: 트랜잭션 해시 (고유 식별자)
 * - status: pending (아직 블록에 포함되지 않음)
 */
export class ExecuteContractResponseDto {
  @ApiProperty({
    description: '트랜잭션 해시 (고유 식별자)',
    example:
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  })
  hash: string;

  @ApiProperty({
    description:
      '트랜잭션 상태 (pending: Pool에 추가됨, 아직 블록에 포함되지 않음)',
    example: 'pending',
    enum: ['pending'],
  })
  status: string;
}
