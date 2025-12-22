import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { StakingService } from './staking.service';
import {
  DepositRequestDto,
  RequestWithdrawalRequestDto,
  SetWithdrawalAddressRequestDto,
  StakingStatsResponseDto,
  TransactionResponseDto,
  ValidatorInfoResponseDto,
  ValidatorsResponseDto,
} from './dto/staking.dto';

/**
 * Staking Controller
 *
 * 스테이킹 시스템 관련 HTTP API
 */
@ApiTags('staking')
@Controller('staking')
export class StakingController {
  constructor(private readonly stakingService: StakingService) {}

  /**
   * 스테이킹 예치
   *
   * POST /staking/deposit
   */
  @Post('deposit')
  @ApiOperation({
    summary: '스테이킹 예치',
    description: 'DSTN을 스테이킹하여 Validator가 됩니다. 최소 32 DSTN 필요.',
  })
  @ApiResponse({
    status: 201,
    description: '스테이킹 예치 성공',
    type: TransactionResponseDto,
  })
  async deposit(
    @Body() body: DepositRequestDto,
  ): Promise<TransactionResponseDto> {
    return await this.stakingService.deposit(body.privateKey, body.amount);
  }

  /**
   * 출금 주소 설정
   *
   * POST /staking/set-withdrawal-address
   */
  @Post('set-withdrawal-address')
  @ApiOperation({
    summary: '출금 주소 설정',
    description: 'Validator의 출금 받을 주소를 설정합니다.',
  })
  @ApiResponse({
    status: 201,
    description: '출금 주소 설정 성공',
    type: TransactionResponseDto,
  })
  async setWithdrawalAddress(
    @Body() body: SetWithdrawalAddressRequestDto,
  ): Promise<TransactionResponseDto> {
    return await this.stakingService.setWithdrawalAddress(
      body.privateKey,
      body.withdrawalAddress,
    );
  }

  /**
   * 출금 요청
   *
   * POST /staking/request-withdrawal
   */
  @Post('request-withdrawal')
  @ApiOperation({
    summary: '출금 요청',
    description: '스테이킹된 자금을 출금하기 위해 요청합니다. 대기 시간 후 자동 전송.',
  })
  @ApiResponse({
    status: 201,
    description: '출금 요청 성공',
    type: TransactionResponseDto,
  })
  async requestWithdrawal(
    @Body() body: RequestWithdrawalRequestDto,
  ): Promise<TransactionResponseDto> {
    return await this.stakingService.requestWithdrawal(body.privateKey);
  }

  /**
   * Validator 정보 조회
   *
   * GET /staking/validator/:address
   */
  @Get('validator/:address')
  @ApiOperation({
    summary: 'Validator 정보 조회',
    description: '특정 Validator의 상세 정보를 조회합니다.',
  })
  @ApiParam({
    name: 'address',
    description: 'Validator 주소',
    example: '0x742d35cc6634c0532925a3b844bc9e7595f0beb0',
  })
  @ApiResponse({
    status: 200,
    description: 'Validator 정보 조회 성공',
    type: ValidatorInfoResponseDto,
  })
  async getValidator(
    @Param('address') address: string,
  ): Promise<ValidatorInfoResponseDto> {
    return await this.stakingService.getValidator(address);
  }

  /**
   * 활성 Validator 목록 조회
   *
   * GET /staking/validators
   */
  @Get('validators')
  @ApiOperation({
    summary: '활성 Validator 목록 조회',
    description: '현재 활성 상태인 모든 Validator 목록을 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: 'Validator 목록 조회 성공',
    type: ValidatorsResponseDto,
  })
  async getValidators(): Promise<ValidatorsResponseDto> {
    const validators = await this.stakingService.getActiveValidators();
    return {
      validators,
      total: validators.length,
    };
  }

  /**
   * 스테이킹 통계 조회
   *
   * GET /staking/stats
   */
  @Get('stats')
  @ApiOperation({
    summary: '스테이킹 통계 조회',
    description: '전체 스테이킹 시스템의 통계 정보를 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '스테이킹 통계 조회 성공',
    type: StakingStatsResponseDto,
  })
  async getStats(): Promise<StakingStatsResponseDto> {
    return await this.stakingService.getStats();
  }
}

