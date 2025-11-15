import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { GetLogsRequestDto, LogDto } from './dto/get-logs.dto';
import {
  SendTransactionRequestDto,
  SendTransactionResponseDto,
} from './dto/send-transaction.dto';
import {
  SignTransactionRequestDto,
  SignTransactionResponseDto,
} from './dto/sign-transaction.dto';
import { TransactionDto } from './dto/transaction.dto';
import { TransactionService } from './transaction.service';

/**
 * Transaction Controller
 *
 * API:
 * - POST /transaction/sign: 트랜잭션 서명 (테스트용)
 * - POST /transaction/send: 서명된 트랜잭션 제출
 * - GET /transaction/:hash: 트랜잭션 조회
 */
@ApiTags('transaction')
@Controller('transaction')
export class TransactionController {
  constructor(private readonly transactionService: TransactionService) {}

  /**
   * 트랜잭션 서명 생성 (테스트용)
   *
   * ⚠️ 주의:
   * - 실제 프로덕션 금지
   * - 개인키를 서버로 보내면 안됨
   * - 오직 개발/테스트용
   *
   * 실제:
   * - web3.js가 클라이언트에서 서명
   * - 서명된 트랜잭션만 서버로 전송
   *
   * POST /transaction/sign
   */
  @Post('sign')
  @ApiOperation({
    summary: '트랜잭션 서명 생성 (테스트용)',
    description:
      '개인키로 트랜잭션을 서명합니다. ⚠️ 실제 프로덕션에서는 절대 사용 금지! 클라이언트(web3.js)에서 서명해야 합니다.',
  })
  @ApiResponse({
    status: 201,
    description: '서명된 트랜잭션 반환',
    type: SignTransactionResponseDto,
  })
  async signTransaction(
    @Body() body: SignTransactionRequestDto,
  ): Promise<SignTransactionResponseDto> {
    const { privateKey, to, value, gasPrice, gasLimit, data } = body;

    const tx = await this.transactionService.signTransaction(
      privateKey,
      to ?? null,
      BigInt(value),
      {
        gasPrice: gasPrice ? BigInt(gasPrice) : undefined,
        gasLimit: gasLimit ? BigInt(gasLimit) : undefined,
        data,
      },
    );

    return {
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: tx.value.toString(),
      nonce: tx.nonce,
      v: tx.v,
      r: tx.r,
      s: tx.s,
      gasPrice: tx.gasPrice.toString(),
      gasLimit: tx.gasLimit.toString(),
      data: tx.data,
    };
  }

  /**
   * 서명된 트랜잭션 제출
   *
   * 이더리움:
   * - 클라이언트가 서명한 트랜잭션 받음
   * - 검증 후 Mempool 추가
   *
   * 검증:
   * 1. 서명 검증 (발신자 확인)
   * 2. Nonce 검증
   * 3. 잔액 검증
   *
   * POST /transaction/send
   */
  @Post('send')
  @ApiOperation({
    summary: '서명된 트랜잭션 제출',
    description:
      '서명된 트랜잭션을 네트워크에 제출합니다. 검증 후 Mempool에 추가됩니다.',
  })
  @ApiResponse({
    status: 201,
    description: '트랜잭션 제출 성공',
    type: SendTransactionResponseDto,
  })
  async sendTransaction(
    @Body() body: SendTransactionRequestDto,
  ): Promise<SendTransactionResponseDto> {
    const { from, to, value, nonce, gasPrice, gasLimit, data, v, r, s } = body;

    const tx = await this.transactionService.submitTransaction(
      from,
      to ?? null,
      BigInt(value),
      nonce,
      { v, r, s },
      {
        gasPrice: gasPrice ? BigInt(gasPrice) : undefined,
        gasLimit: gasLimit ? BigInt(gasLimit) : undefined,
        data,
      },
    );

    return {
      success: true,
      hash: tx.hash,
      status: tx.status,
      message: 'Transaction submitted to mempool',
    };
  }

  /**
   * 임시: 검증 우회 전송 (컨트랙트 배포용 to=null 허용)
   *
   * - class-validator를 거치지 않고 body를 직접 파싱
   * - 배포 트랜잭션(to=null) 테스트를 위한 임시 엔드포인트
   */
  // 임시 send-raw 엔드포인트 제거됨

  /**
   * 로그 조회 (eth_getLogs)
   *
   * 이더리움 표준:
   * - eth_getLogs RPC 메서드와 동일한 동작
   * - logsBloom을 활용한 빠른 필터링
   *
   * RPC 표준:
   * - 파라미터: {fromBlock?, toBlock?, address?, topics?}
   * - address: 단일 주소 문자열 또는 주소 배열
   * - topics: 배열 (최대 4개), 각 요소는 null, 단일 topic, 또는 topic 배열
   * - fromBlock/toBlock 기본값: "latest"
   *
   * 주의: 라우트 순서 중요 - :hash 라우트보다 먼저 정의해야 함
   *
   * GET /transaction/logs
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

  /**
   * 트랜잭션 조회
   *
   * GET /transaction/:hash
   */
  @Get(':hash')
  @ApiOperation({
    summary: '트랜잭션 조회',
    description: '트랜잭션 해시로 트랜잭션 정보를 조회합니다.',
  })
  @ApiParam({
    name: 'hash',
    description: '트랜잭션 해시',
    example:
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  })
  @ApiResponse({
    status: 200,
    description: '트랜잭션 정보',
    type: TransactionDto,
  })
  async getTransaction(@Param('hash') hash: string): Promise<any> {
    return await this.transactionService.getTransaction(hash);
  }

  /**
   * Receipt 조회 (Ethereum JSON-RPC 표준)
   *
   * 이더리움:
   * - eth_getTransactionReceipt
   * - Receipt 있으면: Receipt 객체 직접 반환
   * - Receipt 없으면: null 반환
   *
   * GET /transaction/:hash/receipt
   */
  @Get(':hash/receipt')
  @ApiOperation({
    summary: 'Receipt 조회',
    description:
      '트랜잭션 해시로 Receipt를 조회합니다. Receipt는 트랜잭션이 블록에 포함된 후에만 조회 가능합니다. (Ethereum JSON-RPC 표준)',
  })
  @ApiParam({
    name: 'hash',
    description: '트랜잭션 해시',
    example:
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  })
  @ApiResponse({
    status: 200,
    description: 'Receipt 정보 (이더리움 표준 형식)',
  })
  async getReceipt(@Param('hash') hash: string): Promise<any> {
    const receipt = await this.transactionService.getReceipt(hash);

    // 이더리움 표준: Receipt 없으면 null 반환
    if (!receipt) {
      return null;
    }

    // 이더리움 표준: Receipt 객체 직접 반환 (래퍼 없음)
    return receipt.toJSON();
  }
}
