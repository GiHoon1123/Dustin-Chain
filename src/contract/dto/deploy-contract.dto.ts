import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

/**
 * 컨트랙트 배포 요청 DTO
 *
 * 이더리움 표준:
 * - eth_sendTransaction과 유사하지만 to가 null (컨트랙트 배포)
 * - data에는 컴파일된 컨트랙트 바이트코드가 들어감
 *
 * 주의:
 * - 테스트용 API (제네시스 계정 0번 사용)
 * - 실제 프로덕션에서는 각 사용자가 자신의 지갑으로 서명해야 함
 * - 임시 기능 (UX 개선을 위한 것)
 *
 * 사용 예시:
 * - 프론트엔드에서 Solidity 컨트랙트 컴파일 후 바이트코드 추출
 * - 추출한 바이트코드를 이 DTO로 전달
 * - 서버에서 제네시스 계정 0번으로 트랜잭션 생성, 서명, 제출
 */
export class DeployContractRequestDto {
  @ApiProperty({
    description: '컨트랙트 바이트코드 (컴파일된 hex string)',
    example: '0x608060405234801561000f575f5ffd5b50604051611416380380611416833981810160405281019061003191906102f5565b...',
    pattern: '^0x[a-fA-F0-9]*$',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[a-fA-F0-9]*$/, {
    message: 'bytecode must be a valid hex string starting with 0x',
  })
  bytecode: string;
}

/**
 * 컨트랙트 배포 응답 DTO
 *
 * 이더리움 표준:
 * - eth_sendTransaction 응답과 유사한 구조
 * - hash: 트랜잭션 해시 (고유 식별자)
 * - status: pending (아직 블록에 포함되지 않음)
 *
 * 참고:
 * - 트랜잭션이 블록에 포함되면 컨트랙트 주소를 계산할 수 있음
 * - 컨트랙트 주소 = keccak256(rlp([sender, nonce]))[12:]
 */
export class DeployContractResponseDto {
  @ApiProperty({
    description: '트랜잭션 해시 (고유 식별자)',
    example: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  })
  hash: string;

  @ApiProperty({
    description: '트랜잭션 상태 (pending: Pool에 추가됨, 아직 블록에 포함되지 않음)',
    example: 'pending',
    enum: ['pending'],
  })
  status: string;
}
