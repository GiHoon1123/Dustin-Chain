import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ValidatorService } from './validator.service';

/**
 * Validator Controller
 *
 * Validator 조회 API
 *
 * 현재:
 * - 256개 Genesis Validator (읽기 전용)
 * - 등록 API 없음 (하드코딩)
 *
 * 나중에:
 * - POST /validator/stake (스테이킹)
 * - POST /validator/unstake (인출)
 */
@ApiTags('validator')
@Controller('validator')
export class ValidatorController {
  constructor(private readonly validatorService: ValidatorService) {}

  /**
   * 모든 Validator 조회
   *
   * GET /validator/list
   */
  @Get('list')
  @ApiOperation({
    summary: '모든 Validator 조회',
    description: 'Genesis Validator 256개 목록을 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: 'Validator 목록',
  })
  async getValidators() {
    const validators = await this.validatorService.getAllValidators();
    return {
      total: validators.length,
      validators: validators.map((v) => v.toJSON()),
    };
  }

  /**
   * Validator 통계
   *
   * GET /validator/stats
   */
  @Get('stats')
  @ApiOperation({
    summary: 'Validator 통계',
    description: 'Validator 개수, Committee 크기 등을 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: 'Validator 통계',
  })
  async getStats() {
    return await this.validatorService.getStats();
  }
}
