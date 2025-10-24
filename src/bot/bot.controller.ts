import { Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TransactionBotService } from './transaction-bot.service';

/**
 * Bot Controller
 *
 * 트랜잭션 봇 제어 API
 *
 * 목적:
 * - 개발/테스트 시 봇 거래 on/off
 * - 서버 비용 절감
 * - 메모리 관리
 *
 * API:
 * - POST /bot/start - 봇 시작
 * - POST /bot/stop - 봇 중지
 * - GET /bot/status - 봇 상태
 */
@ApiTags('bot')
@Controller('bot')
export class BotController {
  constructor(private readonly botService: TransactionBotService) {}

  /**
   * 봇 상태 조회
   *
   * GET /bot/status
   */
  @Get('status')
  @ApiOperation({
    summary: '봇 상태 조회',
    description: '트랜잭션 봇의 현재 상태를 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '봇 상태',
    schema: {
      example: {
        isRunning: true,
        accountCount: 156,
        minBalance: '1000000000000000000',
        targetRate: '4-5 tx/sec',
      },
    },
  })
  getStatus() {
    return this.botService.getStatus();
  }

  /**
   * 봇 시작
   *
   * POST /bot/start
   */
  @Post('start')
  @ApiOperation({
    summary: '봇 시작',
    description: '트랜잭션 봇을 시작합니다. (테스트/개발용)',
  })
  @ApiResponse({
    status: 200,
    description: '봇 시작 성공',
    schema: {
      example: {
        success: true,
        message: 'Transaction bot started',
        status: {
          isRunning: true,
          accountCount: 156,
          minBalance: '1000000000000000000',
          targetRate: '4-5 tx/sec',
        },
      },
    },
  })
  start() {
    this.botService.start();
    return {
      success: true,
      message: 'Transaction bot started',
      status: this.botService.getStatus(),
    };
  }

  /**
   * 봇 중지
   *
   * POST /bot/stop
   */
  @Post('stop')
  @ApiOperation({
    summary: '봇 중지',
    description: '트랜잭션 봇을 중지합니다. (테스트/개발용)',
  })
  @ApiResponse({
    status: 200,
    description: '봇 중지 성공',
    schema: {
      example: {
        success: true,
        message: 'Transaction bot stopped',
        status: {
          isRunning: false,
          accountCount: 156,
          minBalance: '1000000000000000000',
          targetRate: '4-5 tx/sec',
        },
      },
    },
  })
  stop() {
    this.botService.stop();
    return {
      success: true,
      message: 'Transaction bot stopped',
      status: this.botService.getStatus(),
    };
  }
}
