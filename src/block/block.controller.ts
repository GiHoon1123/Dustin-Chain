import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { BlockService } from './block.service';
import { BlockDto, ChainStatsDto } from './dto/block.dto';
import { BlockProducer } from './producer/block.producer';

/**
 * Block Controller
 *
 * 블록 조회 API (읽기 전용)
 *
 * 이더리움:
 * - eth_getBlockByNumber
 * - eth_getBlockByHash
 * - eth_blockNumber
 *
 * 우리:
 * - GET /block/latest
 * - GET /block/number/:number
 * - GET /block/hash/:hash
 * - GET /block/stats
 *
 * 참고:
 * - 블록 생성 API 없음 (자동 생성)
 * - 조회만 가능
 */
@ApiTags('block')
@Controller('block')
export class BlockController {
  constructor(
    private readonly blockService: BlockService,
    private readonly blockProducer: BlockProducer,
  ) {}

  /**
   * 최신 블록 조회
   *
   * GET /block/latest
   */
  @Get('latest')
  @ApiOperation({
    summary: '최신 블록 조회',
    description: '가장 최근에 생성된 블록을 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '최신 블록 정보',
    type: BlockDto,
  })
  async getLatestBlock(): Promise<BlockDto> {
    const block = await this.blockService.getLatestBlock();

    if (!block) {
      throw new NotFoundException('No blocks found');
    }

    return {
      ...block.toJSON(),
      timestamp: new Date(block.timestamp).toISOString(),
    };
  }

  /**
   * 블록 번호로 조회
   *
   * GET /block/number/:number
   */
  @Get('number/:number')
  @ApiOperation({
    summary: '블록 번호로 조회',
    description: '특정 블록 번호의 블록을 조회합니다.',
  })
  @ApiParam({
    name: 'number',
    description: '블록 번호',
    example: 123,
    type: Number,
  })
  @ApiResponse({
    status: 200,
    description: '블록 정보',
    type: BlockDto,
  })
  async getBlockByNumber(@Param('number') number: string): Promise<BlockDto> {
    const blockNumber = parseInt(number, 10);

    if (isNaN(blockNumber) || blockNumber < 0) {
      throw new NotFoundException('Invalid block number');
    }

    const block = await this.blockService.getBlockByNumber(blockNumber);

    if (!block) {
      throw new NotFoundException(`Block #${blockNumber} not found`);
    }

    return {
      ...block.toJSON(),
      timestamp: new Date(block.timestamp).toISOString(),
    };
  }

  /**
   * 블록 해시로 조회
   *
   * GET /block/hash/:hash
   */
  @Get('hash/:hash')
  @ApiOperation({
    summary: '블록 해시로 조회',
    description: '특정 블록 해시의 블록을 조회합니다.',
  })
  @ApiParam({
    name: 'hash',
    description: '블록 해시',
    example:
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  })
  @ApiResponse({
    status: 200,
    description: '블록 정보',
    type: BlockDto,
  })
  async getBlockByHash(@Param('hash') hash: string): Promise<BlockDto> {
    const block = await this.blockService.getBlockByHash(hash);

    if (!block) {
      throw new NotFoundException(`Block ${hash} not found`);
    }

    return {
      ...block.toJSON(),
      timestamp: new Date(block.timestamp).toISOString(),
    };
  }

  /**
   * 체인 통계
   *
   * GET /block/stats
   */
  @Get('stats')
  @ApiOperation({
    summary: '블록체인 통계',
    description: '체인 높이, 총 트랜잭션 수 등의 통계를 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '블록체인 통계',
    type: ChainStatsDto,
  })
  async getChainStats(): Promise<ChainStatsDto> {
    return this.blockService.getChainStats();
  }

  /**
   * Block Producer 상태
   *
   * GET /block/producer-status
   */
  @Get('producer-status')
  @ApiOperation({
    summary: 'Block Producer 상태',
    description: '블록 생성기의 현재 상태를 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: 'Block Producer 상태',
  })
  getProducerStatus() {
    return this.blockProducer.getStatus();
  }
}
