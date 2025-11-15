import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { BlockService } from './block.service';
import { BlockDto, ChainStatsDto } from './dto/block.dto';
import { BlockProducer } from './producer/block.producer';
import { TransactionService } from '../transaction/transaction.service';
import { LogDto } from '../transaction/dto/get-logs.dto';

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
    private readonly transactionService: TransactionService,
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

    // ✅ toJSON()에서 이미 Ethereum 표준 형식으로 변환됨 (Hex String)
    return block.toJSON();
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

    // ✅ toJSON()에서 이미 Ethereum 표준 형식으로 변환됨 (Hex String)
    return block.toJSON();
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

    // ✅ toJSON()에서 이미 Ethereum 표준 형식으로 변환됨 (Hex String)
    return block.toJSON();
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

  /**
   * 블록 생성 시작
   *
   * POST /block/mining/start
   */
  @Post('mining/start')
  @ApiOperation({
    summary: '블록 생성 시작',
    description: '블록 생성을 시작합니다. (테스트/개발용)',
  })
  @ApiResponse({
    status: 200,
    description: '블록 생성 시작 성공',
    schema: {
      example: {
        success: true,
        message: 'Block mining started',
        status: {
          isRunning: true,
          genesisTime: '2025-10-23T00:00:00.000Z',
          currentSlot: 100,
          blockTime: 12,
        },
      },
    },
  })
  startMining() {
    this.blockProducer.start();
    return {
      success: true,
      message: 'Block mining started',
      status: this.blockProducer.getStatus(),
    };
  }

  /**
   * 블록 생성 중지
   *
   * POST /block/mining/stop
   */
  @Post('mining/stop')
  @ApiOperation({
    summary: '블록 생성 중지',
    description: '블록 생성을 중지합니다. (테스트/개발용)',
  })
  @ApiResponse({
    status: 200,
    description: '블록 생성 중지 성공',
    schema: {
      example: {
        success: true,
        message: 'Block mining stopped',
        status: {
          isRunning: false,
          genesisTime: '2025-10-23T00:00:00.000Z',
          currentSlot: 100,
          blockTime: 12,
        },
      },
    },
  })
  stopMining() {
    this.blockProducer.stop();
    return {
      success: true,
      message: 'Block mining stopped',
      status: this.blockProducer.getStatus(),
    };
  }

  /**
   * 로그 조회 (eth_getLogs)
   *
   * 이더리움 표준:
   * - eth_getLogs RPC 메서드와 동일한 동작
   * - logsBloom을 활용한 빠른 필터링
   * - 블록 범위와 필터 조건에 맞는 로그 조회
   *
   * GET /block/logs
   */
  @Get('logs')
  @ApiOperation({
    summary: '로그 조회 (eth_getLogs)',
    description:
      '블록 범위와 필터 조건에 맞는 로그를 조회합니다. logsBloom을 활용하여 빠르게 필터링합니다. (Ethereum JSON-RPC 표준)',
  })
  @ApiQuery({
    name: 'fromBlock',
    required: false,
    description: '시작 블록 번호 (hex string 또는 "latest")',
    example: '0x0',
  })
  @ApiQuery({
    name: 'toBlock',
    required: false,
    description: '끝 블록 번호 (hex string 또는 "latest")',
    example: 'latest',
  })
  @ApiQuery({
    name: 'address',
    required: false,
    description: '컨트랙트 주소 (단일 주소 또는 쉼표로 구분된 배열)',
    example: '0x29ee51dd76197743f997cdf76a6d3aa4d16d2bca',
    type: String,
  })
  @ApiQuery({
    name: 'topics',
    required: false,
    description: '토픽 필터 배열 (JSON 문자열, 최대 4개)',
    example: '["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"]',
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: '필터링된 로그 배열 (이더리움 표준 형식)',
    type: [LogDto],
  })
  async getLogs(
    @Query('fromBlock') fromBlock?: string,
    @Query('toBlock') toBlock?: string,
    @Query('address') address?: string | string[],
    @Query('topics') topics?: string,
  ): Promise<LogDto[]> {
    // address 파싱 (단일 주소 문자열 또는 쉼표로 구분된 배열)
    let addresses: string[] | undefined;
    if (address) {
      if (Array.isArray(address)) {
        addresses = address;
      } else if (address.includes(',')) {
        addresses = address.split(',').map((addr) => addr.trim());
      } else {
        addresses = [address];
      }
    }

    // topics 파싱 (JSON 문자열)
    let parsedTopics: (string | string[] | null)[] | undefined;
    if (topics) {
      try {
        parsedTopics = JSON.parse(topics);
      } catch {
        parsedTopics = undefined;
      }
    }

    const logs = await this.transactionService.getLogs(
      fromBlock,
      toBlock,
      addresses,
      parsedTopics,
    );

    return logs;
  }
}
