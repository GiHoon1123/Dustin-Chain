import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ContractService } from './contract.service';

/**
 * Contract Controller
 *
 * 컨트랙트 관련 HTTP API
 *
 * 이더리움:
 * - eth_getCode: 컨트랙트 바이트코드 조회
 * - eth_call: 상태 변경 없이 컨트랙트 메서드 실행
 *
 * 우리:
 * - GET /contract/:address/bytecode: 바이트코드 조회
 * - POST /contract/call: 읽기 메서드 호출
 */
@ApiTags('contract')
@Controller('contract')
export class ContractController {
  constructor(private readonly contractService: ContractService) {}

  /**
   * 컨트랙트 바이트코드 조회
   *
   * 이더리움:
   * - eth_getCode
   *
   * GET /contract/:address/bytecode
   */
  @Get(':address/bytecode')
  @ApiOperation({
    summary: '컨트랙트 바이트코드 조회',
    description: '특정 컨트랙트 주소의 바이트코드를 조회합니다.',
  })
  @ApiParam({
    name: 'address',
    description: '컨트랙트 주소',
    example: '0x1234567890123456789012345678901234567890',
  })
  @ApiResponse({
    status: 200,
    description: '컨트랙트 바이트코드 정보',
    schema: {
      example: {
        address: '0x1234567890123456789012345678901234567890',
        bytecode: '0x608060405234801561001057600080fd5b50...',
        codeHash: '0x...',
      },
    },
  })
  async getContractBytecode(
    @Param('address') address: string,
  ): Promise<{ address: string; bytecode: string; codeHash: string }> {
    return await this.contractService.getContractBytecode(address);
  }

  /**
   * 컨트랙트 읽기 메서드 호출 (eth_call)
   *
   * 이더리움:
   * - eth_call: 상태 변경 없이 컨트랙트 메서드 실행
   * - view, pure 함수 호출용
   *
   * POST /contract/call
   */
  @Post('call')
  @ApiOperation({
    summary: '컨트랙트 읽기 메서드 호출 (eth_call)',
    description:
      '상태 변경 없이 컨트랙트 메서드를 실행합니다. (view, pure 함수)',
  })
  @ApiResponse({
    status: 200,
    description: '실행 결과',
    schema: {
      example: {
        result:
          '0x0000000000000000000000000000000000000000000000000de0b6b3a7640000',
        gasUsed: '0x5208',
      },
    },
  })
  async callContract(
    @Body()
    body: {
      to: string;
      data: string;
      from?: string;
    },
  ): Promise<{ result: string; gasUsed: string }> {
    return await this.contractService.callContract(
      body.to,
      body.data,
      body.from,
    );
  }
}
