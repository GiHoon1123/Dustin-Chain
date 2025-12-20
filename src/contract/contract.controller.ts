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
  DeployContractRequestDto,
  DeployContractResponseDto,
} from './dto/deploy-contract.dto';
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
   * 컨트랙트 배포 (트랜잭션 생성 및 제출)
   *
   * 이더리움:
   * - eth_sendTransaction과 유사하지만 to가 null (컨트랙트 배포)
   * - 트랜잭션을 생성하고 제출 (Pool 추가)
   *
   * 동작:
   * 1. 제네시스 계정 0번으로 트랜잭션 생성 및 서명
   * 2. 트랜잭션 제출 (Pool 추가)
   * 3. 트랜잭션 해시 반환
   *
   * 주의:
   * - 테스트용 API (제네시스 계정 0번 사용)
   * - 실제 프로덕션에서는 각 사용자가 자신의 지갑(메타마스크)으로 서명
   * - 임시 기능 (UX 개선을 위한 것)
   *
   * POST /contract/deploy
   */
  @Post('deploy')
  @ApiOperation({
    summary: '컨트랙트 배포 (트랜잭션 생성 및 제출)',
    description:
      '컨트랙트 바이트코드를 받아 배포 트랜잭션을 생성하고 제출합니다. 제네시스 계정 0번을 사용합니다.\n\n' +
      '⚠️ 테스트용 API: 실제 프로덕션에서는 각 사용자가 자신의 지갑으로 서명해야 합니다.\n' +
      '⚠️ 임시 기능: UX 개선을 위해 구현되었습니다.\n\n' +
      'bytecode 필드는 컴파일된 컨트랙트 바이트코드(hex string)입니다.',
  })
  @ApiBody({
    type: DeployContractRequestDto,
    description: '컨트랙트 배포 요청 데이터',
  })
  @ApiResponse({
    status: 201,
    description: '트랜잭션 제출 성공',
    type: DeployContractResponseDto,
  })
  async deployContract(
    @Body() body: DeployContractRequestDto,
  ): Promise<DeployContractResponseDto> {
    return await this.contractService.deployContract(body.bytecode);
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

  /**
   * 스테이블코인 시스템 전체 배포
   *
   * StableCoin과 CollateralVault를 순서대로 배포하고 연결합니다.
   *
   * POST /contract/deploy-stablecoin-system
   */
  @Post('deploy-stablecoin-system')
  @ApiOperation({
    summary: '스테이블코인 시스템 전체 배포',
    description:
      'StableCoin과 CollateralVault를 순서대로 배포합니다.\n\n' +
      '배포 순서:\n' +
      '1. StableCoin 배포\n' +
      '2. CollateralVault 배포\n\n' +
      '주의: 배포 후 setStablecoin()과 setVault()를 호출하여 컨트랙트를 연결해야 합니다.',
  })
  @ApiResponse({
    status: 201,
    description: '배포 성공',
    schema: {
      example: {
        stablecoinAddress: '0x1234567890123456789012345678901234567890',
        vaultAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        stablecoinTxHash: '0x...',
        vaultTxHash: '0x...',
      },
    },
  })
  async deployStablecoinSystem(): Promise<{
    stablecoinAddress: string;
    vaultAddress: string;
    stablecoinTxHash: string;
    vaultTxHash: string;
  }> {
    return await this.contractService.deployStablecoinSystem();
  }

  /**
   * 컨트랙트 ABI 조회
   *
   * 스캔 서비스에서 자동으로 ABI를 조회할 수 있습니다.
   *
   * GET /contract/:address/abi
   */
  @Get(':address/abi')
  @ApiOperation({
    summary: '컨트랙트 ABI 조회',
    description:
      '배포된 컨트랙트의 ABI를 조회합니다. 배포 시 자동으로 저장된 ABI를 반환합니다.',
  })
  @ApiParam({
    name: 'address',
    description: '컨트랙트 주소',
    example: '0x1234567890123456789012345678901234567890',
  })
  @ApiResponse({
    status: 200,
    description: '컨트랙트 ABI 정보',
    schema: {
      example: {
        address: '0x1234567890123456789012345678901234567890',
        name: 'StableCoin',
        abi: [
          {
            inputs: [],
            name: 'name',
            outputs: [{ type: 'string' }],
            stateMutability: 'view',
            type: 'function',
          },
        ],
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'ABI를 찾을 수 없음',
  })
  async getContractABI(
    @Param('address') address: string,
  ): Promise<{ address: string; name: string; abi: any[] } | null> {
    return this.contractService.getContractABI(address);
  }

  /**
   * 배포된 스테이블코인 컨트랙트 주소 조회
   *
   * GET /contract/deployed
   */
  @Get('deployed')
  @ApiOperation({
    summary: '배포된 스테이블코인 컨트랙트 주소 조회',
    description:
      '최신 배포된 StableCoin과 CollateralVault 컨트랙트 주소를 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '배포된 컨트랙트 주소 정보',
    schema: {
      example: {
        stablecoin: {
          address: '0x723ea324bc2e40c648cc59ccbcf52dfd553a8749',
          name: 'StableCoin',
          deployedAt: '2025-12-20T03:48:49.000Z',
        },
        vault: {
          address: '0xf7ad28c7f7aaa50a0d340f5dd900d1699c5cc7f2',
          name: 'CollateralVault',
          deployedAt: '2025-12-20T03:48:49.000Z',
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: '배포된 컨트랙트 정보를 찾을 수 없음',
  })
  getDeployedContracts(): {
    stablecoin: { address: string; name: string; deployedAt: string };
    vault: { address: string; name: string; deployedAt: string };
  } | null {
    return this.contractService.getDeployedContracts();
  }
}
