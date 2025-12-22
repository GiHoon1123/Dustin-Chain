import { Controller, Get, Post, Param, HttpException, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags, ApiParam } from '@nestjs/swagger';
import { CompilerService } from './compiler.service';

/**
 * Compiler Controller
 *
 * Solidity 컨트랙트 컴파일 API
 *
 * 엔드포인트:
 * - POST /compiler/compile-all: 모든 컨트랙트 컴파일
 * - POST /compiler/compile/:contractName: 특정 컨트랙트 컴파일
 * - GET /compiler/results: 컴파일 결과 조회
 * - GET /compiler/results/:contractName: 특정 컨트랙트 결과 조회
 */
@ApiTags('compiler')
@Controller('compiler')
export class CompilerController {
  constructor(private readonly compilerService: CompilerService) {}

  /**
   * 모든 컨트랙트 컴파일
   *
   * POST /compiler/compile-all
   */
  @Post('compile-all')
  @ApiOperation({
    summary: '모든 컨트랙트 컴파일',
    description: 'contracts/ 디렉토리의 모든 .sol 파일을 컴파일합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '컴파일 성공',
  })
  @ApiResponse({
    status: 500,
    description: '컴파일 실패',
  })
  async compileAll() {
    try {
      const result = await this.compilerService.compileAll();
      return result;
    } catch (error: any) {
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: error.message || 'Compilation failed',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 특정 컨트랙트 컴파일
   *
   * POST /compiler/compile/:contractName
   */
  @Post('compile/:contractName')
  @ApiOperation({
    summary: '특정 컨트랙트 컴파일',
    description: '지정한 컨트랙트 파일을 컴파일합니다.',
  })
  @ApiParam({
    name: 'contractName',
    description: '컨트랙트 파일명 (확장자 제외)',
    example: 'StakingContract',
  })
  @ApiResponse({
    status: 200,
    description: '컴파일 성공',
  })
  @ApiResponse({
    status: 404,
    description: '컨트랙트 파일을 찾을 수 없음',
  })
  @ApiResponse({
    status: 500,
    description: '컴파일 실패',
  })
  async compileContract(@Param('contractName') contractName: string) {
    try {
      const result = await this.compilerService.compileContract(contractName);
      return result;
    } catch (error: any) {
      if (error.message.includes('not found')) {
        throw new HttpException(
          {
            statusCode: HttpStatus.NOT_FOUND,
            message: error.message,
          },
          HttpStatus.NOT_FOUND,
        );
      }
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: error.message || 'Compilation failed',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 컴파일 결과 조회
   *
   * GET /compiler/results
   */
  @Get('results')
  @ApiOperation({
    summary: '컴파일 결과 조회',
    description: '모든 컴파일된 컨트랙트의 바이트코드와 ABI를 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '조회 성공',
  })
  async getResults() {
    return this.compilerService.getCompilationResults();
  }

  /**
   * 특정 컨트랙트 결과 조회
   *
   * GET /compiler/results/:contractName
   */
  @Get('results/:contractName')
  @ApiOperation({
    summary: '특정 컨트랙트 결과 조회',
    description: '지정한 컨트랙트의 바이트코드와 ABI를 조회합니다.',
  })
  @ApiParam({
    name: 'contractName',
    description: '컨트랙트 이름',
    example: 'StakingContract',
  })
  @ApiResponse({
    status: 200,
    description: '조회 성공',
  })
  async getContractResults(@Param('contractName') contractName: string) {
    return this.compilerService.getCompilationResults(contractName);
  }
}

