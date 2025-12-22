import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

/**
 * 네이티브 토큰(DSTN) 전송 요청 DTO
 */
export class SendNativeRequestDto {
  @ApiProperty({
    description: '사용자 개인키',
    example:
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[a-fA-F0-9]{64}$/, {
    message: 'privateKey must be a valid private key',
  })
  privateKey: string;

  @ApiProperty({
    description: '수신자 주소',
    example: '0x742d35cc6634c0532925a3b844bc9e7595f0beb0',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[a-fA-F0-9]{40}$/, {
    message: 'to must be a valid Ethereum address',
  })
  to: string;

  @ApiProperty({
    description: '전송할 금액 (Wei 단위, Hex String)',
    example: '0x8ac7230489e80000', // 10 DSTN = 10 * 10^18 Wei
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[0-9a-fA-F]+$/, {
    message: 'amount must be a hex string with 0x prefix',
  })
  amount: string;

  @ApiPropertyOptional({
    description: '가스 가격 (Wei 단위, Hex String, 선택)',
    example: '0x3b9aca00', // 1 Gwei = 1000000000 Wei
  })
  @IsOptional()
  @IsString()
  @Matches(/^0x[0-9a-fA-F]+$/, {
    message: 'gasPrice must be a hex string with 0x prefix',
  })
  gasPrice?: string;

  @ApiPropertyOptional({
    description: '가스 한도 (Hex String, 선택)',
    example: '0x5208', // 21000 (기본 전송 가스)
  })
  @IsOptional()
  @IsString()
  @Matches(/^0x[0-9a-fA-F]+$/, {
    message: 'gasLimit must be a hex string with 0x prefix',
  })
  gasLimit?: string;
}

/**
 * 네이티브 토큰 전송 응답 DTO
 */
export class SendNativeResponseDto {
  @ApiProperty({
    description: '트랜잭션 해시',
    example: '0x1234567890abcdef...',
  })
  hash: string;

  @ApiProperty({
    description: '트랜잭션 상태',
    example: 'pending',
  })
  status: string;
}
