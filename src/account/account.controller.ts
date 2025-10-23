import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CryptoService } from '../common/crypto/crypto.service';
import { AccountService } from './account.service';
import { AccountDto } from './dto/account.dto';
import {
  AddBalanceRequestDto,
  AddBalanceResponseDto,
} from './dto/add-balance.dto';
import { CreateWalletResponseDto } from './dto/create-wallet.dto';

/**
 * AccountController
 *
 * 계정 관련 HTTP API를 제공하는 컨트롤러
 *
 * 제공하는 API:
 * - POST /account/create-wallet: 새 지갑 생성 (개인키 + 주소)
 * - GET /account/:address: 계정 정보 조회 (주소, 잔액, 논스)
 * - POST /account/add-balance: 잔액 추가 (테스트용)
 *
 * 왜 필요한가:
 * - 프론트엔드나 클라이언트가 블록체인과 상호작용할 수 있는 진입점
 * - 계정 생성, 조회 등의 기능을 HTTP API로 노출
 */
@ApiTags('account')
@Controller('account')
export class AccountController {
  constructor(
    private readonly accountService: AccountService,
    private readonly cryptoService: CryptoService,
  ) {}

  /**
   * 새 지갑 생성
   *
   * 이더리움에서:
   * - 클라이언트(Metamask 등)가 로컬에서 생성
   * - 서버에 개인키를 보내지 않음
   *
   * 여기서는:
   * - 학습 목적으로 서버에서 생성
   * - 실제 프로덕션에서는 클라이언트가 생성해야 함
   *
   * 주소 생성 과정:
   * 1. 개인키 생성 (256비트 무작위 숫자)
   * 2. 개인키 -> 공개키 (secp256k1 타원곡선 곱셈)
   * 3. 공개키(64바이트) -> Keccak-256 해시 (32바이트)
   * 4. 해시의 마지막 20바이트 -> 0x 접두사 추가 -> 주소
   *
   * 따라서 주소는 공개키의 일부가 아니라, 공개키를 해시한 값의 일부입니다.
   *
   * POST /account/create-wallet
   *
   * Response:
   * {
   *   "privateKey": "0x...",
   *   "publicKey": "0x...",
   *   "address": "0x...",
   *   "balance": "0",
   *   "nonce": 0
   * }
   */
  @Post('create-wallet')
  @ApiOperation({
    summary: '새 지갑 생성',
    description:
      '새로운 지갑을 생성합니다. 개인키, 공개키, 주소를 반환합니다. (주의: 실제 프로덕션에서는 클라이언트에서 생성해야 합니다)',
  })
  @ApiResponse({
    status: 201,
    description: '지갑이 성공적으로 생성됨',
    type: CreateWalletResponseDto,
  })
  async createWallet(): Promise<CreateWalletResponseDto> {
    const keyPair = this.cryptoService.generateKeyPair();

    // 계정을 블록체인 상태에 등록 (잔액 0, nonce 0)
    await this.accountService.getOrCreateAccount(keyPair.address);

    return {
      privateKey: keyPair.privateKey,
      publicKey: keyPair.publicKey,
      address: keyPair.address,
      balance: '0',
      nonce: 0,
    };
  }

  /**
   * 특정 주소의 계정 정보 조회
   *
   * GET /account/:address
   *
   * Response:
   * {
   *   "address": "0x...",
   *   "balance": "1000000000000000000",
   *   "nonce": 5
   * }
   */
  @Get(':address')
  @ApiOperation({
    summary: '계정 정보 조회',
    description: '특정 주소의 계정 정보(주소, 잔액, 논스)를 조회합니다.',
  })
  @ApiParam({
    name: 'address',
    description: '조회할 계정 주소 (0x로 시작하는 40자리 hex)',
    example: '0x1234567890123456789012345678901234567890',
  })
  @ApiResponse({
    status: 200,
    description: '계정 정보 조회 성공',
    type: AccountDto,
  })
  async getAccount(@Param('address') address: string): Promise<any> {
    const account = await this.accountService.getOrCreateAccount(address);
    // ✅ toJSON()에서 이미 Ethereum 표준 형식으로 변환됨 (Hex String)
    return account.toJSON();
  }

  /**
   * 잔액 추가 (테스트용)
   *
   * 주의:
   * - 실제 블록체인에서는 이런 API가 없음
   * - 오직 테스트 및 개발 목적
   * - Genesis 블록이나 채굴 보상으로만 자산 생성 가능
   *
   * POST /account/add-balance
   * Body:
   * {
   *   "address": "0x...",
   *   "amount": "1000000000000000000"
   * }
   */
  @Post('add-balance')
  @ApiOperation({
    summary: '잔액 추가 (테스트용)',
    description:
      '테스트 목적으로 특정 주소에 잔액을 추가합니다. 실제 블록체인에서는 이런 API가 존재하지 않습니다.',
  })
  @ApiResponse({
    status: 201,
    description: '잔액 추가 성공',
    type: AddBalanceResponseDto,
  })
  async addBalance(
    @Body() body: AddBalanceRequestDto,
  ): Promise<AddBalanceResponseDto> {
    const { address, amount } = body;

    // DTO에서 이미 형식 검증 완료
    // Service에서 비즈니스 로직 처리
    await this.accountService.addBalance(address, BigInt(amount));

    return {
      success: true,
      address,
      amount,
      newBalance: (await this.accountService.getBalance(address)).toString(),
    };
  }
}
