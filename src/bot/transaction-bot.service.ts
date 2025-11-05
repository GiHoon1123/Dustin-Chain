import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import * as fs from 'fs';
import * as path from 'path';
import { AccountService } from '../account/account.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { Address } from '../common/types/common.types';
import { ContractService } from '../contract/contract.service';
import { TransactionPool } from '../transaction/pool/transaction.pool';
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
 * - 10분마다 컨트랙트 배포 (순차적으로)
 *
 * 목적:
 * - 네트워크 활성화
 * - 블록 히스토리 생성
 * - 실제 블록체인처럼 보이게
 * - 컨트랙트 자동 배포
 */
@Injectable()
export class TransactionBotService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TransactionBotService.name);
  private readonly MIN_BALANCE = BigInt(1) * BigInt(10 ** 18); // 1 DSTN (최소 잔액)
  private readonly MIN_INDEX = 100;
  private readonly MAX_INDEX = 255;
  private accounts: GenesisAccount[] = [];
  private genesisAccount0: GenesisAccount | null = null;
  private deploymentAccounts: GenesisAccount[] = []; // 0-100번 계정 (컨트랙트 배포용)
  private contractBytecodes: string[] = [];
  private isRunning = false;
  private txCount = 0; // 생성된 트랜잭션 수 (일반 + 컨트랙트 배포)
  private contractDeployCount = 0; // 컨트랙트 배포 트랜잭션 수

  constructor(
    private readonly transactionService: TransactionService,
    private readonly accountService: AccountService,
    private readonly contractService: ContractService,
    private readonly cryptoService: CryptoService,
    private readonly txPool: TransactionPool,
  ) {}

  onApplicationBootstrap() {
    this.loadAccounts();
    this.loadGenesisAccount0();
    this.loadDeploymentAccounts(); // 0-100번 계정 로드
    this.loadContractBytecodes();
    this.isRunning = true;
    // this.logger.log(
    //   `🤖 TransactionBot started (${this.accounts.length} accounts active)`,
    // );
    // this.logger.log(
    //   `📊 Target: 0.4-0.5 tx/sec, ~24-30 tx/block (60s), ~1,440-1,800 tx/hour`,
    // );
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

      // this.logger.log(`Loaded ${this.accounts.length} bot accounts`);
    } catch (error: any) {
      this.logger.error(`Failed to load accounts: ${error.message}`);
    }
  }

  /**
   * 제네시스 계정 0번 로드 (컨트랙트 배포용)
   */
  private loadGenesisAccount0(): void {
    try {
      const accountsPath = this.findAccountsFile();
      if (!accountsPath) {
        this.logger.error('genesis-accounts.json not found');
        return;
      }

      const fileContent = fs.readFileSync(accountsPath, 'utf8');
      const allAccounts: GenesisAccount[] = JSON.parse(fileContent);

      // 인덱스 0번 찾기
      this.genesisAccount0 = allAccounts.find((acc) => acc.index === 0) || null;

      if (this.genesisAccount0) {
        this.logger.log(
          `Genesis account 0 loaded for contract deployment: ${this.genesisAccount0.address}`,
        );
      } else {
        this.logger.error('Genesis account 0 not found');
      }
    } catch (error: any) {
      this.logger.error(`Failed to load genesis account 0: ${error.message}`);
    }
  }

  /**
   * 0-100번 계정 로드 (컨트랙트 배포용)
   */
  private loadDeploymentAccounts(): void {
    try {
      const accountsPath = this.findAccountsFile();
      if (!accountsPath) {
        this.logger.error('genesis-accounts.json not found');
        return;
      }

      const fileContent = fs.readFileSync(accountsPath, 'utf8');
      const allAccounts: GenesisAccount[] = JSON.parse(fileContent);

      // 0-100번 계정만 필터링
      this.deploymentAccounts = allAccounts.filter(
        (acc) => acc.index >= 0 && acc.index <= 100,
      );

      this.logger.log(
        `Loaded ${this.deploymentAccounts.length} deployment accounts (index 0-100)`,
      );
    } catch (error: any) {
      this.logger.error(`Failed to load deployment accounts: ${error.message}`);
    }
  }

  /**
   * contract-bytecodes.json 파일에서 바이트코드 로드
   */
  private loadContractBytecodes(): void {
    try {
      const bytecodesPath = this.findBytecodesFile();
      if (!bytecodesPath) {
        this.logger.error('contract-bytecodes.json not found');
        return;
      }

      const fileContent = fs.readFileSync(bytecodesPath, 'utf8');
      const data: { contracts: { name: string; bytecode: string }[] } =
        JSON.parse(fileContent);

      this.contractBytecodes = data.contracts.map(
        (contract) => contract.bytecode,
      );

      this.logger.log(
        `Loaded ${this.contractBytecodes.length} contract bytecodes for deployment`,
      );
    } catch (error: any) {
      this.logger.error(`Failed to load contract bytecodes: ${error.message}`);
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

  private findBytecodesFile(): string | null {
    const possiblePaths = [
      path.resolve(process.cwd(), 'contract-bytecodes.json'),
      path.resolve(__dirname, '../../contract-bytecodes.json'),
      path.resolve(__dirname, '../../../contract-bytecodes.json'),
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
  @Interval(60000)
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
      this.logger.log(
        `Generated ${count} transactions for ${this.accounts.length} accounts`,
      );
    } catch (error: any) {
      this.logger.error(`Bot error: ${error.message}`);
    }
  }

  /**
   * 10분마다 컨트랙트 배포 (600,000ms = 10분)
   *
   * 3개의 컨트랙트 중 랜덤으로 하나를 선택하여 배포
   */
  @Interval(600000)
  async deployContract() {
    if (!this.isRunning || !this.genesisAccount0) {
      return;
    }

    if (this.contractBytecodes.length === 0) {
      return;
    }

    try {
      // Pool에 같은 nonce의 트랜잭션이 있는지 확인 (pending + queued 모두 확인)
      const currentNonce = await this.accountService.getNonce(
        this.genesisAccount0.address,
      );
      const pendingTxs = this.txPool.getPending();
      const queuedTxs = this.txPool.getQueued();
      const allTxs = [...pendingTxs, ...queuedTxs];

      const hasPendingTx = allTxs.some(
        (tx) =>
          tx.from.toLowerCase() ===
            this.genesisAccount0!.address.toLowerCase() &&
          tx.nonce === currentNonce,
      );

      if (hasPendingTx) {
        // Pool에 이미 같은 nonce의 트랜잭션이 있으면 건너뛰기
        return;
      }

      // 3개 컨트랙트 중 랜덤으로 하나 선택
      const randomIndex = Math.floor(
        Math.random() * this.contractBytecodes.length,
      );
      const bytecode = this.contractBytecodes[randomIndex];

      // ContractService.deployContract 사용 (수동 배포 API와 동일한 로직)
      const result = await this.contractService.deployContract(bytecode);

      // 트랜잭션 카운터 증가
      this.txCount++;
      this.contractDeployCount++;

      this.logger.log(
        `Contract deployment #${randomIndex + 1}/${this.contractBytecodes.length} (random) submitted: ${result.hash}`,
      );
    } catch (error: any) {
      // Duplicate nonce 에러는 정상적인 상황이므로 조용히 무시
      if (error.message?.includes('Duplicate nonce')) {
        // 조용히 무시 (이미 Pool에 있는 트랜잭션)
        return;
      }
      this.logger.error(`Contract deployment failed: ${error.message}`);
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
        // this.logger.debug(
        //   `Account ${fromAccount.address.slice(0, 10)}... has insufficient balance (${this.formatDSTN(balance)} DSTN)`,
        // );
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
        // this.logger.debug(
        //   `Account ${fromAccount.address.slice(0, 10)}... cannot afford tx (needs ${this.formatDSTN(totalCost)} + 1 DSTN reserve)`,
        // );
        return;
      }

      // 6. TransactionService.signTransaction() 사용
      // - nonce 계산 자동 처리 (pending/queued 고려)
      // - RLP 기반 해시 계산 (서명 검증 통과)
      const data = '0x';
      const signedTx = await this.transactionService.signTransaction(
        fromAccount.privateKey,
        toAccount.address,
        amount,
        {
          data,
          gasPrice,
          gasLimit,
        },
      );

      // 7. 서명된 트랜잭션에서 정보 추출하여 제출
      await this.transactionService.submitTransaction(
        signedTx.from,
        signedTx.to,
        signedTx.value,
        signedTx.nonce,
        signedTx.getSignature(),
        {
          gasPrice: signedTx.gasPrice,
          gasLimit: signedTx.gasLimit,
          data: signedTx.data,
        },
      );

      // 트랜잭션 카운터 증가
      this.txCount++;

      // this.logger.debug(
      //   `✅ Bot TX: ${fromAccount.address.slice(0, 8)}...→${toAccount.address.slice(0, 8)}... (${this.formatDSTN(amount)} DSTN)`,
      // );
    } catch (error: any) {
      // 에러는 조용히 무시 (Nonce 충돌 등)
      this.logger.debug(`Bot TX failed: ${error.message}`);
    }
  }

  /**
   * 무작위 계정 선택
   */
  private selectRandomAccount(excludeAddress?: Address): GenesisAccount {
    // Modern approach: filter 후 random 선택
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
  getStats() {
    return {
      isRunning: this.isRunning,
      activeAccounts: this.accounts.length,
      minBalance: '1 DSTN',
      targetRate: '0.4-0.5 tx/sec',
      expectedTxPerBlock: '24-30',
      expectedTxPerHour: '1,440-1,800',
      totalTransactions: this.txCount,
      contractDeployments: this.contractDeployCount,
      regularTransactions: this.txCount - this.contractDeployCount,
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
      totalTransactions: this.txCount,
      contractDeployments: this.contractDeployCount,
    };
  }

  /**
   * 봇 중지 (필요시)
   */
  stop() {
    this.isRunning = false;
    // this.logger.log('🛑 TransactionBot stopped');
  }

  /**
   * 봇 재시작 (필요시)
   */
  start() {
    this.isRunning = true;
    // this.logger.log('🚀 TransactionBot restarted');
  }
}
