import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ContractService } from './contract.service';
import {
  CallContractRequestDto,
  CallContractResponseDto,
} from './dto/call-contract.dto';
import {
  ExecuteContractRequestDto,
  ExecuteContractResponseDto,
} from './dto/execute-contract.dto';

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
      '상태 변경 없이 컨트랙트 메서드를 실행합니다. (view, pure 함수)\n\n' +
      'data 필드는 ABI 인코딩된 함수 호출 데이터입니다.\n' +
      '프론트엔드에서 ABI를 사용해 함수 선택자(4바이트) + 파라미터를 인코딩하여 전달해야 합니다.',
  })
  @ApiBody({
    type: CallContractRequestDto,
    description: '컨트랙트 호출 요청 데이터',
  })
  @ApiResponse({
    status: 200,
    description: '실행 결과',
    type: CallContractResponseDto,
  })
  async callContract(
    @Body() body: CallContractRequestDto,
  ): Promise<CallContractResponseDto> {
    return await this.contractService.callContract(
      body.to,
      body.data,
      body.from,
    );
  }

  /**
   * 컨트랙트 쓰기 메서드 실행 (트랜잭션 생성 및 제출)
   *
   * 이더리움:
   * - eth_sendTransaction: 트랜잭션 생성 및 제출
   * - 상태 변경 함수 호출용 (setValue, transfer 등)
   *
   * 동작:
   * 1. 제네시스 계정 0번으로 트랜잭션 생성 및 서명
   * 2. 트랜잭션 제출 (Pool 추가)
   * 3. 트랜잭션 해시 반환
   *
   * 주의:
   * - 테스트용 API (제네시스 계정 0번 사용)
   * - 실제 프로덕션에서는 각 사용자가 자신의 지갑(메타마스크)으로 서명
   *
   * POST /contract/execute
   */
  @Post('execute')
  @ApiOperation({
    summary: '컨트랙트 쓰기 메서드 실행 (트랜잭션 생성 및 제출)',
    description:
      '상태 변경이 있는 컨트랙트 메서드를 실행합니다. 제네시스 계정 0번을 사용하여 트랜잭션을 생성하고 제출합니다.\n\n' +
      '⚠️ 테스트용 API: 실제 프로덕션에서는 각 사용자가 자신의 지갑으로 서명해야 합니다.\n\n' +
      'data 필드는 ABI 인코딩된 함수 호출 데이터입니다.\n' +
      '프론트엔드에서 ABI를 사용해 함수 선택자(4바이트) + 파라미터를 인코딩하여 전달해야 합니다.',
  })
  @ApiBody({
    type: ExecuteContractRequestDto,
    description: '컨트랙트 쓰기 작업 요청 데이터',
  })
  @ApiResponse({
    status: 201,
    description: '트랜잭션 제출 성공',
    type: ExecuteContractResponseDto,
  })
  async executeContract(
    @Body() body: ExecuteContractRequestDto,
  ): Promise<ExecuteContractResponseDto> {
    return await this.contractService.executeContract(body.to, body.data);
  }
}
