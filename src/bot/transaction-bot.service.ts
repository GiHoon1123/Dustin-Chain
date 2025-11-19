import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import * as fs from 'fs';
import * as path from 'path';
import { AccountService } from '../account/account.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { Address } from '../common/types/common.types';
import { ContractService } from '../contract/contract.service';
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
  private accounts: GenesisAccount[] = [];
  private deploymentAccounts: GenesisAccount[] = []; // 0-100번 계정 (컨트랙트 배포용)
  private tokenAccounts: GenesisAccount[] = []; // 151-255번 계정 (토큰 거래용)
  private contractBytecodes: string[] = [];
  private tokenBytecodes: Array<{ name: string; bytecode: string }> = [];
  private deployedTokens = new Map<string, string>(); // tokenName → contractAddress
  private isRunning = false;
  private txCount = 0; // 생성된 트랜잭션 수 (일반 + 컨트랙트 배포)
  private contractDeployCount = 0; // 컨트랙트 배포 트랜잭션 수
  private tokenTxCount = 0; // 토큰 전송 트랜잭션 수

  constructor(
    private readonly transactionService: TransactionService,
    private readonly accountService: AccountService,
    private readonly contractService: ContractService,
    private readonly cryptoService: CryptoService,
  ) {}

  onApplicationBootstrap() {
    this.loadAccounts();
    this.loadDeploymentAccounts(); // 0-100번 계정 로드
    this.loadTokenAccounts(); // 151-255번 계정 로드
    this.loadContractBytecodes();
    this.loadTokenBytecodes();
    this.isRunning = true;
    // this.logger.log(
    //   `🤖 TransactionBot started (${this.accounts.length} accounts active)`,
    // );
    // this.logger.log(
    //   `📊 Target: 0.4-0.5 tx/sec, ~24-30 tx/block (60s), ~1,440-1,800 tx/hour`,
    // );
  }

  /**
   * genesis-accounts.json에서 인덱스 100-150 계정 로드
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
        (acc) => acc.index >= 100 && acc.index <= 150,
      );

      // this.logger.log(`Loaded ${this.accounts.length} bot accounts`);
    } catch (error: any) {
      this.logger.error(`Failed to load accounts: ${error.message}`);
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
   * 151-255번 계정 로드 (토큰 거래용)
   */
  private loadTokenAccounts(): void {
    try {
      const accountsPath = this.findAccountsFile();
      if (!accountsPath) {
        this.logger.error('genesis-accounts.json not found');
        return;
      }

      const fileContent = fs.readFileSync(accountsPath, 'utf8');
      const allAccounts: GenesisAccount[] = JSON.parse(fileContent);

      this.tokenAccounts = allAccounts.filter(
        (acc) => acc.index >= 151 && acc.index <= 255,
      );

      this.logger.log(
        `Loaded ${this.tokenAccounts.length} token accounts (index 151-255)`,
      );
    } catch (error: any) {
      this.logger.error(`Failed to load token accounts: ${error.message}`);
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

  /**
   * token-bytecodes.json 파일에서 바이트코드 로드
   */
  private loadTokenBytecodes(): void {
    try {
      const bytecodesPath = this.findTokenBytecodesFile();
      if (!bytecodesPath) {
        this.logger.error('token-bytecodes.json not found');
        return;
      }

      const fileContent = fs.readFileSync(bytecodesPath, 'utf8');
      const data: { contracts: { name: string; bytecode: string }[] } =
        JSON.parse(fileContent);

      this.tokenBytecodes = data.contracts.map((contract) => ({
        name: contract.name,
        bytecode: contract.bytecode,
      }));

      this.logger.log(
        `Loaded ${this.tokenBytecodes.length} token bytecodes for deployment`,
      );
    } catch (error: any) {
      this.logger.error(`Failed to load token bytecodes: ${error.message}`);
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

  private findTokenBytecodesFile(): string | null {
    const possiblePaths = [
      path.resolve(process.cwd(), 'token-bytecodes.json'),
      path.resolve(__dirname, '../../token-bytecodes.json'),
      path.resolve(__dirname, '../../../token-bytecodes.json'),
    ];

    for (const filePath of possiblePaths) {
      if (fs.existsSync(filePath)) {
        return filePath;
      }
    }

    return null;
  }

  /**
   * 120초마다 4-5개 트랜잭션 생성
   */
  @Interval(1400000)
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
   * 5분마다 토큰 배포 및 초기 분배 (300,000ms = 5분)
   */
  @Interval(1400000)
  async deployTokenAndDistribute() {
    if (!this.isRunning || this.tokenAccounts.length === 0) {
      return;
    }

    if (this.tokenBytecodes.length === 0) {
      return;
    }

    for (const token of this.tokenBytecodes) {
      if (this.deployedTokens.has(token.name)) {
        continue;
      }

      const existingAddress = await this.findDeployedTokenByBytecode(
        token.bytecode,
      );
      if (existingAddress) {
        this.deployedTokens.set(token.name, existingAddress);
        continue;
      }

      try {
        const deployerAccount =
          this.tokenAccounts[
            Math.floor(Math.random() * this.tokenAccounts.length)
          ];

        const tx = await this.transactionService.signTransaction(
          deployerAccount.privateKey,
          null,
          0n,
          {
            data: token.bytecode.startsWith('0x')
              ? token.bytecode
              : `0x${token.bytecode}`,
            gasPrice: 1000000000n,
            gasLimit: 5000000n,
          },
        );

        const submittedTx = await this.transactionService.submitTransaction(
          tx.from,
          null,
          tx.value,
          tx.nonce,
          tx.getSignature(),
          {
            gasPrice: tx.gasPrice,
            gasLimit: tx.gasLimit,
            data: tx.data,
          },
        );

        const contractAddress = await this.waitForContractAddress(
          submittedTx.hash,
        );
        if (contractAddress) {
          this.deployedTokens.set(token.name, contractAddress);

          await this.distributeInitialTokens(
            token.name,
            deployerAccount,
            contractAddress,
          );
        }

        this.txCount++;
        this.contractDeployCount++;
      } catch (error: any) {
        if (error.message?.includes('Duplicate nonce')) {
          continue;
        }
        this.logger.error(
          `Token deployment failed (${token.name}): ${error.message}`,
        );
      }
    }
  }

  /**
   * 10분마다 컨트랙트 배포 (600,000ms = 10분)
   *
   * 3개의 컨트랙트 중 랜덤으로 하나를 선택하여 배포
   *
   * 주의: ContractService.deployContract()가 내부적으로 deploymentAccounts 중
   * 랜덤 계정을 선택하여 배포하므로, 봇에서는 단순히 호출만 하면 됩니다.
   */
  @Interval(1400000)
  async deployContract() {
    if (!this.isRunning) {
      return;
    }

    if (this.contractBytecodes.length === 0) {
      this.logger.warn('No contract bytecodes loaded, skipping deployment');
      return;
    }

    try {
      // 3개 컨트랙트 중 랜덤으로 하나 선택
      const randomIndex = Math.floor(
        Math.random() * this.contractBytecodes.length,
      );
      const bytecode = this.contractBytecodes[randomIndex];

      // ContractService.deployContract 사용 (수동 배포 API와 동일한 로직)
      // ContractService 내부에서 deploymentAccounts 중 랜덤 계정을 선택하여 배포
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

      // Deployment accounts 에러도 조용히 무시 (계정이 로드되지 않은 경우)
      if (error.message?.includes('Deployment accounts are not loaded')) {
        this.logger.warn('Deployment accounts not loaded, skipping deployment');
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
      //   `Bot TX: ${fromAccount.address.slice(0, 8)}...→${toAccount.address.slice(0, 8)}... (${this.formatDSTN(amount)} DSTN)`,
      // );
    } catch (error: any) {
      // 에러는 조용히 무시 (Nonce 충돌 등)
      this.logger.debug(`Bot TX failed: ${error.message}`);
    }
  }

  /**
   * 30초마다 토큰 전송 (30,000ms = 30초)
   */
  @Interval(1400000)
  async generateTokenTransactions() {
    if (!this.isRunning || this.tokenAccounts.length === 0) {
      return;
    }

    if (this.deployedTokens.size === 0) {
      return;
    }

    try {
      const count = 5;

      for (let i = 0; i < count; i++) {
        await this.sendTokenTransaction();
      }
    } catch (error: any) {
      this.logger.error(`Token transaction error: ${error.message}`);
    }
  }

  /**
   * 블록체인에서 특정 바이트코드로 이미 배포된 토큰 찾기
   * (151-255번 계정들의 배포 트랜잭션 receipt에서 확인)
   *
   * 최적화: 처음 몇 개 계정만 체크하고, 샘플링 방식으로 빠르게 확인
   */
  private async findDeployedTokenByBytecode(
    bytecode: string,
  ): Promise<string | null> {
    const normalizedBytecode = bytecode.startsWith('0x')
      ? bytecode.toLowerCase()
      : `0x${bytecode.toLowerCase()}`;

    // 최적화: 처음 20개 계정만 체크 (빠른 확인)
    const accountsToCheck = this.tokenAccounts.slice(0, 20);

    for (const account of accountsToCheck) {
      try {
        const nonce = await this.accountService.getNonce(account.address);
        if (nonce === 0) {
          continue;
        }

        // 각 계정의 최신 nonce부터 역순으로 확인 (최근 배포가 있을 가능성)
        for (let n = nonce - 1; n >= 0 && n >= nonce - 5; n--) {
          try {
            const contractAddress = this.calculateContractAddress(
              account.address,
              n,
            );

            const contractInfo =
              await this.contractService.getContractBytecode(contractAddress);

            if (
              contractInfo.bytecode &&
              contractInfo.bytecode.toLowerCase() === normalizedBytecode
            ) {
              return contractAddress;
            }
          } catch {
            continue;
          }
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  /**
   * 컨트랙트 주소 계산 (이더리움 표준: keccak256(rlp([sender, nonce]))[12:])
   */
  private calculateContractAddress(sender: Address, nonce: number): Address {
    const senderBytes = this.cryptoService.hexToBytes(sender);
    const hash = this.cryptoService.rlpHashBuffer([senderBytes, nonce]);
    return `0x${this.cryptoService.bytesToHex(hash.slice(12))}`;
  }

  /**
   * 배포 트랜잭션의 receipt를 조회하여 컨트랙트 주소 가져오기
   */
  private async waitForContractAddress(
    txHash: string,
    maxRetries: number = 10,
    delayMs: number = 6000,
  ): Promise<string | null> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const receipt = await this.transactionService.getReceipt(txHash);
        if (receipt && receipt.contractAddress) {
          return receipt.contractAddress;
        }
      } catch {
        // Receipt가 아직 생성되지 않음
      }

      if (i < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    this.logger.warn(
      `Failed to get contract address for deployment tx: ${txHash}`,
    );
    return null;
  }

  /**
   * 토큰 초기 분배: 10개 계정에게 각 10억 토큰 전송
   */
  private async distributeInitialTokens(
    tokenName: string,
    deployerAccount: GenesisAccount,
    contractAddress: string,
  ): Promise<void> {
    const initialRecipients = this.tokenAccounts
      .filter((acc) => acc.address !== deployerAccount.address)
      .sort(() => Math.random() - 0.5)
      .slice(0, 10);

    const amountPerAccount = BigInt(1000000000) * BigInt(10 ** 18);

    for (const recipient of initialRecipients) {
      try {
        await this.sendTokenTransferDirect(
          contractAddress,
          deployerAccount,
          recipient.address,
          amountPerAccount,
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error: any) {
        if (error.message?.includes('Duplicate nonce')) {
          continue;
        }
      }
    }
  }

  /**
   * 토큰 전송 트랜잭션 생성
   */
  private async sendTokenTransaction(): Promise<void> {
    if (this.deployedTokens.size === 0) {
      return;
    }

    const tokenNames = Array.from(this.deployedTokens.keys());
    const tokenName = tokenNames[Math.floor(Math.random() * tokenNames.length)];
    const contractAddress = this.deployedTokens.get(tokenName)!;

    const fromAccount =
      this.tokenAccounts[Math.floor(Math.random() * this.tokenAccounts.length)];

    const balance = await this.getTokenBalance(
      contractAddress,
      fromAccount.address,
    );
    if (balance === 0n) {
      return;
    }

    const toAccount = this.selectRandomTokenAccount(fromAccount.address);

    const amount =
      balance / BigInt(10) + BigInt(Math.floor(Math.random() * 100) * 10 ** 18);

    try {
      await this.sendTokenTransfer(
        tokenName,
        fromAccount,
        toAccount.address,
        amount,
      );
      this.txCount++;
      this.tokenTxCount++;
    } catch (error: any) {
      if (error.message?.includes('Duplicate nonce')) {
        return;
      }
    }
  }

  /**
   * ERC20 transfer 함수 호출
   */
  private async sendTokenTransfer(
    tokenName: string,
    fromAccount: GenesisAccount,
    toAddress: Address,
    amount: bigint,
  ): Promise<void> {
    const contractAddress = this.deployedTokens.get(tokenName);
    if (!contractAddress) {
      throw new Error(`Token ${tokenName} not deployed`);
    }

    await this.sendTokenTransferDirect(
      contractAddress,
      fromAccount,
      toAddress,
      amount,
    );
  }

  /**
   * ERC20 transfer 함수 호출 (직접 주소 사용)
   */
  private async sendTokenTransferDirect(
    contractAddress: Address,
    fromAccount: GenesisAccount,
    toAddress: Address,
    amount: bigint,
  ): Promise<void> {
    const transferSelector = 'a9059cbb';
    const toAddressPadded = toAddress.slice(2).toLowerCase().padStart(64, '0');
    const amountHex = amount.toString(16).padStart(64, '0');
    const data = `0x${transferSelector}${toAddressPadded}${amountHex}`;

    const tx = await this.transactionService.signTransaction(
      fromAccount.privateKey,
      contractAddress,
      0n,
      {
        data,
        gasPrice: 1000000000n,
        gasLimit: 100000n,
      },
    );

    await this.transactionService.submitTransaction(
      tx.from,
      tx.to,
      tx.value,
      tx.nonce,
      tx.getSignature(),
      {
        gasPrice: tx.gasPrice,
        gasLimit: tx.gasLimit,
        data: tx.data,
      },
    );
  }

  /**
   * ERC20 balanceOf 함수 호출
   */
  private async getTokenBalance(
    contractAddress: Address,
    ownerAddress: Address,
  ): Promise<bigint> {
    try {
      const balanceOfSelector = '70a08231';
      const ownerAddressPadded = ownerAddress
        .slice(2)
        .toLowerCase()
        .padStart(64, '0');
      const data = `0x${balanceOfSelector}${ownerAddressPadded}`;

      const result = await this.contractService.callContract(
        contractAddress,
        data,
        ownerAddress,
      );

      if (!result.result || result.result === '0x') {
        return 0n;
      }

      return BigInt(result.result);
    } catch {
      return 0n;
    }
  }

  /**
   * 무작위 계정 선택
   */
  private selectRandomAccount(excludeAddress?: Address): GenesisAccount {
    const candidates = excludeAddress
      ? this.accounts.filter((acc) => acc.address !== excludeAddress)
      : this.accounts;

    const randomIndex = Math.floor(Math.random() * candidates.length);
    return candidates[randomIndex];
  }

  /**
   * 토큰 계정 중 무작위 선택
   */
  private selectRandomTokenAccount(excludeAddress?: Address): GenesisAccount {
    const candidates = excludeAddress
      ? this.tokenAccounts.filter((acc) => acc.address !== excludeAddress)
      : this.tokenAccounts;

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
      tokenAccountCount: this.tokenAccounts.length,
      tokenBytecodesLoaded: this.tokenBytecodes.length,
      deployedTokens: Array.from(this.deployedTokens.entries()).map(
        ([name, address]) => ({ name, address }),
      ),
      minBalance: this.MIN_BALANCE.toString(),
      targetRate: '0.4-0.5 tx/sec',
      totalTransactions: this.txCount,
      contractDeployments: this.contractDeployCount,
      tokenTransactions: this.tokenTxCount,
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
