import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ConsensusService } from './consensus.service';

/**
 * Consensus Controller
 *
 * Consensus 정보 조회 API
 *
 * - 현재 Slot/Epoch
 * - Consensus 통계
 */
@ApiTags('consensus')
@Controller('consensus')
export class ConsensusController {
  constructor(private readonly consensusService: ConsensusService) {}

  /**
   * Consensus 통계
   *
   * GET /consensus/stats
   */
  @Get('stats')
  @ApiOperation({
    summary: 'Consensus 통계',
    description: '현재 Slot, Epoch, Genesis Time 등을 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: 'Consensus 통계',
  })
  getStats() {
    return this.consensusService.getStats();
  }
}
