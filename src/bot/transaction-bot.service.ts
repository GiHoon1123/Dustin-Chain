import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import * as fs from 'fs';
import * as path from 'path';
import { AccountService } from '../account/account.service';
import { CHAIN_ID } from '../common/constants/blockchain.constants';
import { CryptoService } from '../common/crypto/crypto.service';
import { Address } from '../common/types/common.types';
import { TransactionService } from '../transaction/transaction.service';

interface GenesisAccount {
  index: number;
  address: string;
  publicKey: string;
  privateKey: string;
}

/**
 * Transaction Bot Service
 *
 * 역할:
 * - 10초마다 4-5개 트랜잭션 자동 생성
 * - 인덱스 100-255 계정 간 무작위 송금
 * - 최소 잔액 체크 (1 DSTN)
 *
 * 목적:
 * - 네트워크 활성화
 * - 블록 히스토리 생성
 * - 실제 블록체인처럼 보이게
 */
@Injectable()
export class TransactionBotService {
  private readonly logger = new Logger(TransactionBotService.name);
  private readonly MIN_BALANCE = BigInt(1) * BigInt(10 ** 18); // 1 DSTN (최소 잔액)
  private readonly MIN_INDEX = 100;
  private readonly MAX_INDEX = 255;
  private accounts: GenesisAccount[] = [];
  private isRunning = false;

  constructor(
    private readonly transactionService: TransactionService,
    private readonly accountService: AccountService,
    private readonly cryptoService: CryptoService,
  ) {}

  async onApplicationBootstrap() {
    this.loadAccounts();
    this.isRunning = true;
    this.logger.log(
      `🤖 TransactionBot started (${this.accounts.length} accounts active)`,
    );
    this.logger.log(`📊 Target: 0.4-0.5 tx/sec, ~24-30 tx/block (60s), ~1,440-1,800 tx/hour`);
  }

  /**
   * genesis-accounts.json에서 인덱스 100-255 계정 로드
   */
  private loadAccounts(): void {
    try {
      const accountsPath = this.findAccountsFile();
      if (!accountsPath) {
        this.logger.error('genesis-accounts.json not found');
        return;
      }

      const fileContent = fs.readFileSync(accountsPath, 'utf8');
      const allAccounts: GenesisAccount[] = JSON.parse(fileContent);

      // 인덱스 100-255만 필터링
      this.accounts = allAccounts.filter(
        (acc) => acc.index >= this.MIN_INDEX && acc.index <= this.MAX_INDEX,
      );

      this.logger.log(`Loaded ${this.accounts.length} bot accounts`);
    } catch (error: any) {
      this.logger.error(`Failed to load accounts: ${error.message}`);
    }
  }

  private findAccountsFile(): string | null {
    const possiblePaths = [
      path.resolve(process.cwd(), 'genesis-accounts.json'),
      path.resolve(__dirname, '../../genesis-accounts.json'),
      path.resolve(__dirname, '../../../genesis-accounts.json'),
    ];

    for (const filePath of possiblePaths) {
      if (fs.existsSync(filePath)) {
        return filePath;
      }
    }

    return null;
  }

  /**
   * 10초마다 4-5개 트랜잭션 생성
   *
   * 결과:
   * - 60초(1블록) = 4-5개 × 6회 = 24-30개 트랜잭션
   * - 시간당 = 1,440-1,800개 트랜잭션
   */
  @Interval(10000)
  async generateTransactions() {
    if (!this.isRunning || this.accounts.length === 0) {
      return;
    }

    try {
      // 4-5개 무작위
      const count = Math.floor(Math.random() * 2) + 4; // 4 or 5

      for (let i = 0; i < count; i++) {
        await this.sendRandomTransaction();
      }
    } catch (error: any) {
      this.logger.error(`Bot error: ${error.message}`);
    }
  }

  /**
   * 무작위 트랜잭션 생성 및 전송
   */
  private async sendRandomTransaction(): Promise<void> {
    try {
      // 1. 무작위 송신자 선택
      const fromAccount = this.selectRandomAccount();

      // 2. 잔액 체크
      const balance = await this.accountService.getBalance(fromAccount.address);
      if (balance < this.MIN_BALANCE) {
        this.logger.debug(
          `Account ${fromAccount.address.slice(0, 10)}... has insufficient balance (${this.formatDSTN(balance)} DSTN)`,
        );
        return;
      }

      // 3. 무작위 수신자 선택 (송신자 제외)
      const toAccount = this.selectRandomAccount(fromAccount.address);

      // 4. 무작위 금액 (0.5~10 DSTN)
      const amount =
        BigInt(Math.floor(Math.random() * 95 + 5)) * BigInt(10 ** 17); // 0.5~10 DSTN

      // 5. 잔액 충분한지 재확인 (금액 + 가스비)
      const gasPrice = BigInt(1000000000); // 1 Gwei
      const gasLimit = BigInt(21000);
      const totalCost = amount + gasPrice * gasLimit;

      if (balance < totalCost + this.MIN_BALANCE) {
        this.logger.debug(
          `Account ${fromAccount.address.slice(0, 10)}... cannot afford tx (needs ${this.formatDSTN(totalCost)} + 1 DSTN reserve)`,
        );
        return;
      }

      // 6. Nonce 가져오기
      const nonce = await this.accountService.getNonce(fromAccount.address);

      // 7. 트랜잭션 해시 계산 (TransactionService와 동일한 방식)
      const data = '0x';
      const txData = {
        from: fromAccount.address,
        to: toAccount.address,
        value: amount.toString(),
        nonce,
        gasPrice: gasPrice.toString(),
        gasLimit: gasLimit.toString(),
        data,
        chainId: CHAIN_ID,
      };
      const txHash = this.cryptoService.hashUtf8(JSON.stringify(txData));

      // 8. 트랜잭션 서명 (EIP-155)
      const signature = this.cryptoService.signTransaction(
        txHash,
        fromAccount.privateKey,
        CHAIN_ID,
      );

      // 9. 트랜잭션 제출
      await this.transactionService.submitTransaction(
        fromAccount.address,
        toAccount.address,
        amount,
        nonce,
        signature,
        {
          gasPrice,
          gasLimit,
          data,
        },
      );

      this.logger.debug(
        `✅ Bot TX: ${fromAccount.address.slice(0, 8)}...→${toAccount.address.slice(0, 8)}... (${this.formatDSTN(amount)} DSTN)`,
      );
    } catch (error: any) {
      // 에러는 조용히 무시 (Nonce 충돌 등)
      this.logger.debug(`Bot TX failed: ${error.message}`);
    }
  }

  /**
   * 무작위 계정 선택
   */
  private selectRandomAccount(excludeAddress?: Address): GenesisAccount {
    // ✅ Modern approach: filter 후 random 선택
    const candidates = excludeAddress
      ? this.accounts.filter((acc) => acc.address !== excludeAddress)
      : this.accounts;

    const randomIndex = Math.floor(Math.random() * candidates.length);
    return candidates[randomIndex];
  }

  /**
   * DSTN 포맷 (Wei → DSTN)
   */
  private formatDSTN(wei: bigint): string {
    const dstn = Number(wei) / 10 ** 18;
    return dstn.toFixed(2);
  }

  /**
   * 봇 통계 조회
   */
  async getStats() {
    return {
      isRunning: this.isRunning,
      activeAccounts: this.accounts.length,
      minBalance: '1 DSTN',
      targetRate: '0.4-0.5 tx/sec',
      expectedTxPerBlock: '24-30',
      expectedTxPerHour: '1,440-1,800',
    };
  }

  /**
   * 봇 상태 조회 (API용)
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      accountCount: this.accounts.length,
      minBalance: this.MIN_BALANCE.toString(),
      targetRate: '0.4-0.5 tx/sec',
    };
  }

  /**
   * 봇 중지 (필요시)
   */
  stop() {
    this.isRunning = false;
    this.logger.log('🛑 TransactionBot stopped');
  }

  /**
   * 봇 재시작 (필요시)
   */
  start() {
    this.isRunning = true;
    this.logger.log('🚀 TransactionBot restarted');
  }
}
