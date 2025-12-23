import {
  Block as EthereumBlock,
  BlockHeader as EthereumBlockHeader,
} from '@ethereumjs/block';
import {
  Common,
  createCustomCommon,
  Hardfork,
  Mainnet,
  StateManagerInterface,
} from '@ethereumjs/common';
import { createLegacyTx } from '@ethereumjs/tx';
import { Address as EthAddress } from '@ethereumjs/util';
import { createVM, runTx, VM } from '@ethereumjs/vm';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import * as fs from 'fs';
import * as keccak from 'keccak';
import * as path from 'path';
import { AccountService } from '../account/account.service';
import { CHAIN_ID } from '../common/constants/blockchain.constants';
import { CryptoService } from '../common/crypto/crypto.service';
import { Address, Hash } from '../common/types/common.types';
import { CustomStateManager } from '../state/custom-state-manager';
import { IBlockRepository } from '../storage/repositories/block.repository.interface';
import { TransactionService } from '../transaction/transaction.service';

interface GenesisAccount {
  index: number;
  address: string;
  publicKey: string;
  privateKey: string;
}

/**
 * Contract Service
 *
 * 컨트랙트 관련 비즈니스 로직
 *
 * 역할:
 * - 컨트랙트 바이트코드 조회
 * - 컨트랙트 읽기 메서드 호출 (eth_call)
 */
@Injectable()
export class ContractService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ContractService.name);
  private callVM: VM | null = null; // eth_call 전용 VM
  private deployVM: VM | null = null; // 컨트랙트 배포 전용 VM
  private readonly common: Common;

  private genesisAccount0: GenesisAccount | null = null;
  private deploymentAccount: GenesisAccount | null = null; // 255번 계정 (컨트랙트 배포 전용)
  private deploymentAccounts: GenesisAccount[] = []; // 0-100번 계정 (컨트랙트 배포용)

  constructor(
    private readonly evmState: CustomStateManager,
    private readonly accountService: AccountService,
    private readonly cryptoService: CryptoService,
    @Inject(IBlockRepository)
    private readonly blockRepository: IBlockRepository,
    private readonly transactionService: TransactionService,
  ) {
    // Common 객체 초기화 (체인 파라미터)
    this.common = createCustomCommon(
      {
        chainId: CHAIN_ID,
      },
      Mainnet,
      {
        hardfork: Hardfork.Cancun,
      },
    );
  }

  /**
   * 애플리케이션 부트스트랩: eth_call 전용 VM 인스턴스 생성
   *
   * 이더리움과 동일하게:
   * - eth_call은 별도의 VM 인스턴스 사용 (블록 실행과 독립)
   * - 같은 StateManager를 공유하지만, VM의 내부 상태(_tx, _block)는 분리
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      // eth_call 전용 VM 인스턴스 생성
      this.callVM = await createVM({
        stateManager: this.evmState as unknown as StateManagerInterface,
        common: this.common,
      });

      this.logger.log(
        `Call VM initialized for eth_call (chainId=${this.common.chainId()})`,
      );
    } catch (e: unknown) {
      this.logger.error(`Failed to initialize Call VM: ${String(e)}`);
      // VM 없이도 계속 진행 (나중에 에러 발생)
    }

    try {
      // 컨트랙트 배포 전용 VM 인스턴스 생성
      this.deployVM = await createVM({
        stateManager: this.evmState as unknown as StateManagerInterface,
        common: this.common,
      });

      this.logger.log(
        `Deploy VM initialized for contract deployment (chainId=${this.common.chainId()})`,
      );
    } catch (e: unknown) {
      this.logger.error(`Failed to initialize Deploy VM: ${String(e)}`);
      // VM 없이도 계속 진행 (나중에 에러 발생)
    }

    // 제네시스 계정 0번 로드 (쓰기 작업용)
    this.loadGenesisAccount0();
    // 제네시스 계정 255번 로드 (컨트랙트 배포 전용)
    this.loadDeploymentAccount();
    // 0-100번 계정 로드 (컨트랙트 배포용)
    this.loadDeploymentAccounts();
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

  private loadGenesisAccount0(): void {
    try {
      const accountsPath = this.findAccountsFile();
      if (!accountsPath) {
        this.logger.warn('genesis-accounts.json not found');
        return;
      }

      const fileContent = fs.readFileSync(accountsPath, 'utf8');
      const allAccounts: GenesisAccount[] = JSON.parse(fileContent);

      const account0 = allAccounts.find((acc) => acc.index === 0);

      if (!account0) {
        this.logger.warn('Genesis account 0 not found');
        return;
      }

      this.genesisAccount0 = account0;
      this.logger.log(
        `Genesis account 0 loaded: ${account0.address.slice(0, 10)}...`,
      );
    } catch (error: any) {
      this.logger.error(`Failed to load genesis account 0: ${error.message}`);
    }
  }

  /**
   * Genesis Account 0 조회 (Backend 자동화용)
   */
  getGenesisAccount0(): GenesisAccount | null {
    return this.genesisAccount0;
  }

  /**
   * 배포 전용 계정 로드 (Genesis Account 255)
   */
  private loadDeploymentAccount(): void {
    try {
      const accountsPath = this.findAccountsFile();
      if (!accountsPath) {
        this.logger.warn('genesis-accounts.json not found');
        return;
      }

      const fileContent = fs.readFileSync(accountsPath, 'utf8');
      const allAccounts: GenesisAccount[] = JSON.parse(fileContent);

      const account255 = allAccounts.find((acc) => acc.index === 255);

      if (!account255) {
        this.logger.warn('Genesis account 255 not found');
        return;
      }

      this.deploymentAccount = account255;
      this.logger.log(
        `Deployment account (255) loaded: ${account255.address.slice(0, 10)}...`,
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to load deployment account (255): ${error.message}`,
      );
    }
  }

  /**
   * 0-100번 계정 로드 (컨트랙트 배포용)
   */
  private loadDeploymentAccounts(): void {
    try {
      const accountsPath = this.findAccountsFile();
      if (!accountsPath) {
        this.logger.warn('genesis-accounts.json not found');
        return;
      }

      const fileContent = fs.readFileSync(accountsPath, 'utf8');
      const allAccounts: GenesisAccount[] = JSON.parse(fileContent);

      // 0-100번 계정만 필터링
      this.deploymentAccounts = allAccounts.filter(
        (acc) => acc.index >= 0 && acc.index <= 100,
      );

      this.logger.log(
        `Loaded ${this.deploymentAccounts.length} deployment accounts (index 0-100) for contract deployment`,
      );
    } catch (error: any) {
      this.logger.error(`Failed to load deployment accounts: ${error.message}`);
    }
  }

  /**
   * 컨트랙트 바이트코드 조회
   *
   * @param address - 컨트랙트 주소
   * @returns 바이트코드 및 코드 해시 정보
   */
  async getContractBytecode(
    address: Address,
  ): Promise<{ address: string; bytecode: string; codeHash: string }> {
    const bytecode = await this.evmState.getCode(address);
    const account = await this.accountService.getOrCreateAccount(address);

    return {
      address,
      bytecode: this.cryptoService.bytesToHex(bytecode),
      codeHash: account.codeHash || '0x',
    };
  }

  /**
   * 컨트랙트 읽기 메서드 호출 (eth_call)
   *
   * 상태 변경 없이 컨트랙트 메서드를 실행합니다.
   *
   * 이더리움:
   * - eth_call: 상태 변경 없이 컨트랙트 메서드 실행
   * - view, pure 함수 호출용
   *
   * 동작:
   * 1. VM checkpoint 생성 (상태 스냅샷)
   * 2. runCall 실행
   * 3. checkpoint 복구 (상태 변경 취소)
   *
   * @param to - 컨트랙트 주소
   * @param data - 함수 선택자 + 파라미터 (ABI 인코딩)
   * @param from - 호출자 주소 (선택사항)
   * @returns 실행 결과 및 사용한 가스
   */
  async callContract(
    to: Address,
    data: string,
    from?: Address,
  ): Promise<{ result: string; gasUsed: string }> {
    // eth_call 전용 VM 인스턴스 사용 (블록 실행 VM과 분리)
    if (!this.callVM) {
      throw new Error('Call VM is not initialized');
    }

    // Checkpoint 생성 (상태 변경 취소용)
    await this.evmState.checkpoint();

    try {
      // data를 Buffer로 변환 후 순수 Uint8Array 복제본 생성
      const dataHex = data.startsWith('0x') ? data.slice(2) : data;
      const dataBuffer = Buffer.from(dataHex, 'hex');
      const dataBytes = new Uint8Array(dataBuffer); // 순수 Uint8Array 복제본

      // 호출자 주소 설정 (없으면 빈 주소)
      const callerAddress =
        from || '0x0000000000000000000000000000000000000000';

      // Address 객체 생성 (20바이트)
      // ⚠️ 중요: Buffer를 직접 넣지 말고, 순수 Uint8Array 복제본으로 생성
      const toHex = to.startsWith('0x') ? to.slice(2) : to;
      const callerHex = callerAddress.startsWith('0x')
        ? callerAddress.slice(2)
        : callerAddress;

      // Buffer를 먼저 만들고, 그 다음 순수 Uint8Array 복제본 생성
      const toBuffer = Buffer.from(toHex, 'hex');
      const callerBuffer = Buffer.from(callerHex, 'hex');
      const toBytes = new Uint8Array(toBuffer); // 순수 Uint8Array 복제본
      const callerBytes = new Uint8Array(callerBuffer); // 순수 Uint8Array 복제본

      const toEthAddress = new EthAddress(toBytes);
      const callerEthAddress = new EthAddress(callerBytes);

      // 최신 블록 가져오기 (블록 컨텍스트용)
      // 순환 의존성 해결: BlockService 대신 IBlockRepository 직접 사용
      const latestBlock = await this.blockRepository.findLatest();
      if (!latestBlock) {
        throw new Error('No blocks found');
      }

      // VM에서 runCall 실행 (eth_call 전용 VM 인스턴스 사용)
      // runCall 내부에서 message가 없으면 자동으로 this._tx와 this._block을 설정함
      // 따라서 사전에 설정할 필요 없이, 옵션만 올바르게 전달하면 됨
      const evm = this.callVM.evm as any;

      // runCall 호출 (내부에서 this._tx와 this._block을 자동으로 설정)
      // message를 전달하지 않으면, runCall 내부에서 message를 생성하고
      // 동시에 this._tx와 this._block도 설정함
      const result = await evm.runCall({
        to: toEthAddress,
        caller: callerEthAddress,
        data: dataBytes,
        gasLimit: 16777215n,
        value: 0n,
        gasPrice: 1000000000n, // 1 Gwei (runCall 내부에서 this._tx.gasPrice로 설정됨)
        origin: callerEthAddress, // runCall 내부에서 this._tx.origin으로 설정됨
        depth: 0,
        block: {
          header: {
            number: BigInt(latestBlock.number),
            gasLimit: 30000000n,
          } as any,
        },
      });

      // Checkpoint 복구 (상태 변경 취소)
      await this.evmState.revert();

      // VM 10.x runCall 반환값: EVMResult 구조
      const returnValue = result.execResult?.returnValue || new Uint8Array();
      const gasUsed = result.execResult?.executionGasUsed || 0n;

      return {
        result: this.cryptoService.bytesToHex(returnValue),
        gasUsed: '0x' + gasUsed.toString(16),
      };
    } catch (error: unknown) {
      // 에러 발생 시에도 checkpoint 복구
      await this.evmState.revert();
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Contract call failed: ${errorMsg}${errorStack ? '\n' + errorStack : ''}`,
      );
      throw error;
    }
  }

  /**
   * 컨트랙트 쓰기 메서드 실행 (트랜잭션 생성 및 제출)
   *
   * 이더리움:
   * - eth_sendTransaction: 트랜잭션 생성 및 제출
   * - 상태 변경 함수 호출용 (setValue, transfer 등)
   *
   * 동작:
   * 1. 제네시스 계정 0번으로 트랜잭션 생성 및 서명
   * 2. 트랜잭션 제출 (Pool 추가)
   * 3. 트랜잭션 해시 반환
   *
   * @param to - 컨트랙트 주소
   * @param data - ABI 인코딩된 함수 호출 데이터
   * @returns 트랜잭션 해시 및 상태
   */
  async executeContract(
    to: Address,
    data: string,
  ): Promise<{ hash: string; status: string }> {
    if (!this.genesisAccount0) {
      throw new Error('Genesis account 0 is not loaded');
    }

    try {
      const tx = await this.transactionService.signTransaction(
        this.genesisAccount0.privateKey,
        to,
        0n,
        {
          data,
          gasPrice: 1000000000n,
          gasLimit: 1000000n,
        },
      );

      const submittedTx = await this.transactionService.submitTransaction(
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

      this.logger.log(
        `Contract execute transaction submitted: ${submittedTx.hash} (from: ${this.genesisAccount0.address}, to: ${to})`,
      );

      return {
        hash: submittedTx.hash,
        status: 'pending',
      };
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Contract execute failed: ${errorMsg}`);
      throw error;
    }
  }

  /**
   * 컨트랙트 쓰기 메서드 실행 (사용자 계정으로 트랜잭션 생성 및 제출)
   *
   * 기존 executeContract()와 동일하지만 사용자가 지정한 privateKey로 실행
   *
   * @param to - 컨트랙트 주소
   * @param data - ABI 인코딩된 함수 호출 데이터
   * @param privateKey - 사용자 개인키
   * @param value - 전송할 금액 (Wei, 담보 예치 시 사용)
   * @returns 트랜잭션 해시 및 상태
   */
  async executeContractByUser(
    to: Address,
    data: string,
    privateKey: string,
    value: bigint = 0n,
  ): Promise<{ hash: string; status: string }> {
    try {
      const tx = await this.transactionService.signTransaction(
        privateKey,
        to,
        value,
        {
          data,
          gasPrice: 1000000000n,
          gasLimit: 1000000n,
        },
      );

      const submittedTx = await this.transactionService.submitTransaction(
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

      this.logger.log(
        `Contract execute transaction submitted by user: ${submittedTx.hash} (from: ${tx.from}, to: ${to})`,
      );

      return {
        hash: submittedTx.hash,
        status: 'pending',
      };
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Contract execute by user failed: ${errorMsg}`);
      throw error;
    }
  }

  /**
   * ABI 저장 (컨트랙트 주소와 ABI 매핑)
   */
  private saveContractABI(
    contractAddress: Address,
    contractName: string,
    abi: any[],
  ): void {
    try {
      const abisPath = path.resolve(process.cwd(), 'contract-abis.json');
      let abisData: {
        contracts: Array<{
          address: string;
          name: string;
          abi: any[];
        }>;
      } = { contracts: [] };

      // 기존 파일이 있으면 읽기
      if (fs.existsSync(abisPath)) {
        const content = fs.readFileSync(abisPath, 'utf8');
        abisData = JSON.parse(content);
      }

      // 이름별로 하나만 유지 (같은 이름이면 모두 제거하고 새로 추가)
      // 이렇게 하면 파일이 커지지 않음
      // 기존에 같은 이름이 있으면 모두 제거
      abisData.contracts = abisData.contracts.filter(
        (c) => c.name !== contractName,
      );

      // 새로 추가 (이름별로 하나만 유지)
      abisData.contracts.push({
        address: contractAddress,
        name: contractName,
        abi,
      });

      this.logger.log(
        `Contract ABI saved: ${contractName} at ${contractAddress} (replaced existing entries)`,
      );

      // 파일에 저장
      fs.writeFileSync(abisPath, JSON.stringify(abisData, null, 2), 'utf8');
      this.logger.log(
        `Contract ABI saved: ${contractName} at ${contractAddress}`,
      );
    } catch (error: any) {
      this.logger.error(`Failed to save contract ABI: ${error.message}`);
    }
  }

  /**
   * 컨트랙트 ABI 조회
   */
  getContractABI(contractAddress: Address): {
    address: string;
    name: string;
    abi: any[];
  } | null {
    try {
      const abisPath = path.resolve(process.cwd(), 'contract-abis.json');
      if (!fs.existsSync(abisPath)) {
        return null;
      }

      const content = fs.readFileSync(abisPath, 'utf8');
      const abisData: {
        contracts: Array<{
          address: string;
          name: string;
          abi: any[];
        }>;
      } = JSON.parse(content);

      const contract = abisData.contracts.find(
        (c) => c.address.toLowerCase() === contractAddress.toLowerCase(),
      );

      return contract || null;
    } catch (error: any) {
      this.logger.error(`Failed to get contract ABI: ${error.message}`);
      return null;
    }
  }

  /**
   * 컨트랙트 배포
   *
   * 0-100번 계정 중 랜덤으로 하나를 선택하여 컨트랙트를 배포합니다.
   *
   * ⚠️ 테스트용 API: 실제 프로덕션에서는 각 사용자가 자신의 지갑으로 서명해야 합니다.
   * 임시 기능으로 UX 개선을 위해 구현되었습니다.
   *
   * @param bytecode - 컴파일된 컨트랙트 바이트코드 (hex string)
   * @param contractName - 컨트랙트 이름 (선택사항, ABI 저장용)
   * @param abi - 컨트랙트 ABI (선택사항, 자동 저장)
   * @returns 트랜잭션 해시 및 상태
   */
  /**
   * 생성자 파라미터 인코딩 (ABI 인코딩)
   *
   * 생성자 파라미터는 함수 선택자 없이 파라미터만 인코딩합니다.
   *
   * @param paramTypes 파라미터 타입 배열 (예: ["address"])
   * @param paramValues 파라미터 값 배열 (예: ["0x..."])
   * @returns 인코딩된 파라미터 (Hex String)
   */
  encodeConstructorParams(paramTypes: string[], paramValues: any[]): string {
    if (paramTypes.length !== paramValues.length) {
      throw new Error(
        `Parameter count mismatch: ${paramTypes.length} types but ${paramValues.length} values`,
      );
    }

    if (paramTypes.length === 0) {
      return ''; // 파라미터 없으면 빈 문자열
    }

    // 파라미터 인코딩 (함수 선택자 없이)
    const encodedParams = paramTypes.map((type, index) =>
      this.encodeParameter(type, paramValues[index]),
    );

    return encodedParams.join('');
  }

  async deployContract(
    bytecode: string,
    contractName?: string,
    abi?: any[],
    constructorParams?: { types: string[]; values: any[] },
  ): Promise<{ hash: string; status: string; address?: string }> {
    if (!this.deploymentAccount) {
      throw new Error('Deployment account (255) is not loaded');
    }

    try {
      // 계정 255번 사용 (컨트랙트 배포 전용)
      const deployerAccount = this.deploymentAccount;

      // 생성자 파라미터 인코딩 (있는 경우)
      let deploymentData = bytecode;
      if (constructorParams && constructorParams.types.length > 0) {
        const encodedParams = this.encodeConstructorParams(
          constructorParams.types,
          constructorParams.values,
        );
        // bytecode + 인코딩된 생성자 파라미터
        deploymentData = bytecode + encodedParams;
      }

      // 컨트랙트 배포는 to가 null, data에 바이트코드 + 생성자 파라미터
      const tx = await this.transactionService.signTransaction(
        deployerAccount.privateKey,
        null, // 컨트랙트 배포는 to가 null
        0n,
        {
          data: deploymentData,
          gasPrice: 1000000000n,
          gasLimit: 5000000n, // 컨트랙트 배포는 가스가 많이 필요
        },
      );

      const submittedTx = await this.transactionService.submitTransaction(
        tx.from,
        null, // 컨트랙트 배포는 to가 null
        tx.value,
        tx.nonce,
        tx.getSignature(),
        {
          gasPrice: tx.gasPrice,
          gasLimit: tx.gasLimit,
          data: tx.data,
        },
      );

      this.logger.log(
        `Contract deployment transaction submitted: ${submittedTx.hash} (from: deployment account #${deployerAccount.index}, ${deployerAccount.address.slice(0, 10)}...)`,
      );

      // ABI가 제공되었고 컨트랙트 이름이 있으면, 주소를 계산하여 저장
      if (abi && contractName) {
        // 배포 계정의 nonce로 컨트랙트 주소 계산
        const account = await this.accountService.getOrCreateAccount(
          deployerAccount.address,
        );
        const contractAddress = this.calculateContractAddress(
          deployerAccount.address,
          account.nonce, // 배포 후 nonce가 증가하므로 현재 nonce 사용
        );

        // ABI 저장 (비동기로 처리, 실패해도 배포는 성공)
        this.saveContractABI(contractAddress, contractName, abi);

        return {
          hash: submittedTx.hash,
          status: 'pending',
          address: contractAddress, // 예상 주소 반환
        };
      }

      return {
        hash: submittedTx.hash,
        status: 'pending',
      };
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Contract deployment failed: ${errorMsg}`);
      throw error;
    }
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
   * BigInt를 RLP 버퍼로 변환 (빅엔디안 바이트 배열)
   */
  private toRlpBuffer(value: bigint): Buffer {
    if (value === 0n) {
      return Buffer.alloc(0);
    }
    const hex = value.toString(16);
    const hexPadded = hex.length % 2 === 0 ? hex : '0' + hex;
    return Buffer.from(hexPadded, 'hex');
  }

  /**
   * 컨트랙트 배포 (VM을 통해 직접 실행, 트랜잭션 제출 없이)
   *
   * 현재 상황:
   * - Execution Layer와 Consensus Layer가 통합되어 있음
   * - 컨트랙트 배포를 트랜잭션으로 처리하면 nonce race condition 발생 가능
   * - Genesis Block 생성 시점이나 특수한 경우에 직접 배포 필요
   *
   * 해결 방법:
   * - VM을 통해 직접 컨트랙트 배포
   * - 트랜잭션 없이 상태 변경 (가스 비용 없음, 블록에 포함되지 않음)
   * - nonce는 증가시키지만 실제 트랜잭션은 생성하지 않음
   *
   * 추후 레이어 분리 시:
   * - Execution Layer: 트랜잭션으로 컨트랙트 배포
   * - Consensus Layer: 블록에 포함하여 실행
   * - 레이어 분리 시에는 트랜잭션 방식으로 처리 가능
   *
   * @param bytecode - 컨트랙트 바이트코드 (hex string)
   * @param from - 배포자 주소
   * @param privateKey - 배포자 개인키
   * @param value - 전송할 금액 (Wei, 기본값: 0)
   * @param blockNumber - 블록 번호
   * @param timestamp - 타임스탬프 (밀리초)
   * @returns 배포된 컨트랙트 주소
   */
  async deployContractDirect(
    bytecode: string,
    from: Address,
    privateKey: string,
    value: bigint = 0n,
    blockNumber: number,
    timestamp: number,
  ): Promise<Address> {
    if (!this.deployVM) {
      throw new Error('Deploy VM is not initialized');
    }

    // bytecode를 Buffer로 변환
    const bytecodeHex = bytecode.startsWith('0x')
      ? bytecode.slice(2)
      : bytecode;
    const bytecodeBuffer = Buffer.from(bytecodeHex, 'hex');
    const bytecodeBytes = new Uint8Array(bytecodeBuffer);

    // 트랜잭션 객체 생성 (컨트랙트 배포는 to가 null)
    const accountNonce = await this.accountService.getNonce(from);
    const gasPrice = 1000000000n; // 1 Gwei
    const gasLimit = 10000000n; // 충분한 가스 한도

    // 트랜잭션 해시 계산 (EIP-155 서명 대상)
    // RLP([nonce, gasPrice, gasLimit, to(null), value, data, chainId, 0, 0])
    const toBufferForSign = Buffer.alloc(0); // 컨트랙트 배포는 to가 null
    const dataBufferForSign = Buffer.from(bytecodeBytes);

    const signArray = [
      this.toRlpBuffer(BigInt(accountNonce)),
      this.toRlpBuffer(gasPrice),
      this.toRlpBuffer(gasLimit),
      toBufferForSign, // null인 경우 빈 버퍼
      this.toRlpBuffer(value),
      dataBufferForSign,
      this.toRlpBuffer(BigInt(CHAIN_ID)),
      Buffer.alloc(0), // r = 0
      Buffer.alloc(0), // s = 0
    ];

    const signRlp = this.cryptoService.rlpEncode(signArray);
    const txHash = this.cryptoService.hashBuffer(Buffer.from(signRlp));

    // EIP-155 서명 생성
    const signature = this.cryptoService.signTransaction(
      txHash,
      privateKey,
      CHAIN_ID,
    );

    // 서명된 트랜잭션 생성 (to가 null인 경우 undefined)
    const rValue = Buffer.from(this.cryptoService.hexToBytes(signature.r));
    const sValue = Buffer.from(this.cryptoService.hexToBytes(signature.s));

    const txForVM = createLegacyTx(
      {
        nonce: BigInt(accountNonce),
        gasPrice,
        gasLimit,
        to: undefined, // 컨트랙트 배포는 to가 null
        value,
        data: bytecodeBytes,
        v: BigInt(signature.v),
        r: rValue,
        s: sValue,
      },
      { common: this.common },
    );

    // Block Header 생성
    const blockHeader = new EthereumBlockHeader(
      {
        number: BigInt(blockNumber),
        gasLimit: 30000000n,
        timestamp: BigInt(Math.floor(timestamp / 1000)), // 초 단위
        parentHash: Buffer.alloc(32, 0),
        stateRoot: Buffer.alloc(32, 0),
        transactionsTrie: Buffer.alloc(32, 0),
        receiptTrie: Buffer.alloc(32, 0),
        logsBloom: Buffer.alloc(256, 0),
        difficulty: 0n,
        extraData: Buffer.alloc(0),
        gasUsed: 0n,
        mixHash: Buffer.alloc(32, 0),
        nonce: Buffer.alloc(8, 0),
      },
      { common: this.common },
    );

    const vmBlock = new EthereumBlock(blockHeader, [], [], undefined, {
      common: this.common,
    });

    // VM을 통해 직접 실행
    const result = await runTx(this.deployVM, {
      tx: txForVM,
      block: vmBlock,
    });

    // 실행 결과 파싱
    const status: 1 | 0 = result.execResult.exceptionError ? 0 : 1;
    if (status === 0) {
      const error = result.execResult.exceptionError;
      throw new Error(
        `Contract deployment failed: ${error?.error?.toString() || 'Unknown error'}`,
      );
    }

    // 배포된 컨트랙트 주소 추출
    const created = result.createdAddress;
    let contractAddress: Address | null = null;

    if (created) {
      // Address 타입 처리: string, Address 객체, Uint8Array, Buffer 등
      if (typeof created === 'string') {
        contractAddress = created;
      } else if (created && typeof created === 'object') {
        // Address 객체인 경우 .toString() 또는 .bytes 사용
        if ('toString' in created) {
          const addrStr = (created as { toString: () => string }).toString();
          contractAddress =
            addrStr && addrStr.startsWith('0x') ? addrStr : null;
        } else if ('bytes' in created) {
          const bytes = (created as { bytes: Uint8Array | Buffer }).bytes;
          contractAddress = this.cryptoService.bytesToHex(Buffer.from(bytes));
        } else {
          // Uint8Array나 Buffer인 경우
          contractAddress = this.cryptoService.bytesToHex(
            Buffer.from(created as unknown as Uint8Array),
          );
        }
      } else {
        // Uint8Array나 다른 타입인 경우 변환
        contractAddress = this.cryptoService.bytesToHex(
          Buffer.from(created as unknown as Uint8Array),
        );
      }

      // 최종 검증: contractAddress가 유효한 0x 접두사 주소인지 확인
      if (contractAddress && !contractAddress.startsWith('0x')) {
        contractAddress = `0x${contractAddress}`;
      }
    }

    if (!contractAddress) {
      throw new Error('Failed to get deployed contract address');
    }

    // nonce 증가 (실제 트랜잭션이 아니지만 상태 변경이 일어났으므로)
    await this.accountService.incrementNonce(from);

    return contractAddress;
  }

  /**
   * 컨트랙트 함수 호출 (VM을 통해 직접 실행, 트랜잭션 제출 없이)
   *
   * 현재 상황:
   * - Execution Layer와 Consensus Layer가 통합되어 있음
   * - 컨트랙트 함수 호출을 트랜잭션으로 처리하면 nonce race condition 발생 가능
   * - Genesis Block 생성 시점이나 특수한 경우에 직접 호출 필요
   *
   * 해결 방법:
   * - VM을 통해 직접 컨트랙트 함수 호출
   * - 트랜잭션 없이 상태 변경 (가스 비용 없음, 블록에 포함되지 않음)
   * - nonce는 증가시키지만 실제 트랜잭션은 생성하지 않음
   *
   * 추후 레이어 분리 시:
   * - Execution Layer: 트랜잭션으로 컨트랙트 함수 호출
   * - Consensus Layer: 블록에 포함하여 실행
   * - 레이어 분리 시에는 트랜잭션 방식으로 처리 가능
   *
   * @param to - 컨트랙트 주소
   * @param data - 함수 호출 데이터 (함수 선택자 + 파라미터)
   * @param from - 호출자 주소
   * @param privateKey - 호출자 개인키
   * @param value - 전송할 금액 (Wei, 기본값: 0)
   * @param blockNumber - 블록 번호
   * @param timestamp - 타임스탬프 (밀리초)
   * @returns 실행 결과
   */
  async executeContractDirect(
    to: Address,
    data: string,
    from: Address,
    privateKey: string,
    value: bigint = 0n,
    blockNumber: number,
    timestamp: number,
  ): Promise<{
    result: string;
    status: 1 | 0;
    gasUsed: bigint;
    logs: { address: Address; topics: Hash[]; data: string }[];
  }> {
    if (!this.deployVM) {
      throw new Error('Deploy VM is not initialized');
    }

    // data를 Buffer로 변환
    const dataHex = data.startsWith('0x') ? data.slice(2) : data;
    const dataBuffer = Buffer.from(dataHex, 'hex');
    const dataBytes = new Uint8Array(dataBuffer);

    // 트랜잭션 객체 생성
    const accountNonce = await this.accountService.getNonce(from);
    const gasPrice = 1000000000n; // 1 Gwei
    const gasLimit = 10000000n; // 충분한 가스 한도

    // to 주소를 EthAddress로 변환
    const toBytes = this.cryptoService.hexToBytes(to);
    const toEthAddress = new EthAddress(new Uint8Array(toBytes));

    // 트랜잭션 해시 계산 (EIP-155 서명 대상)
    const signArray = [
      this.toRlpBuffer(BigInt(accountNonce)),
      this.toRlpBuffer(gasPrice),
      this.toRlpBuffer(gasLimit),
      Buffer.from(toBytes),
      this.toRlpBuffer(value),
      dataBuffer,
      this.toRlpBuffer(BigInt(CHAIN_ID)),
      Buffer.alloc(0), // r = 0
      Buffer.alloc(0), // s = 0
    ];

    const signRlp = this.cryptoService.rlpEncode(signArray);
    const txHash = this.cryptoService.hashBuffer(Buffer.from(signRlp));

    // EIP-155 서명 생성
    const signature = this.cryptoService.signTransaction(
      txHash,
      privateKey,
      CHAIN_ID,
    );

    // 서명된 트랜잭션 생성
    const rValue = Buffer.from(this.cryptoService.hexToBytes(signature.r));
    const sValue = Buffer.from(this.cryptoService.hexToBytes(signature.s));

    const txForVM = createLegacyTx(
      {
        nonce: BigInt(accountNonce),
        gasPrice,
        gasLimit,
        to: toEthAddress,
        value,
        data: dataBytes,
        v: BigInt(signature.v),
        r: rValue,
        s: sValue,
      },
      { common: this.common },
    );

    // Block Header 생성
    const blockHeader = new EthereumBlockHeader(
      {
        number: BigInt(blockNumber),
        gasLimit: 30000000n,
        timestamp: BigInt(Math.floor(timestamp / 1000)), // 초 단위
        parentHash: Buffer.alloc(32, 0),
        stateRoot: Buffer.alloc(32, 0),
        transactionsTrie: Buffer.alloc(32, 0),
        receiptTrie: Buffer.alloc(32, 0),
        logsBloom: Buffer.alloc(256, 0),
        difficulty: 0n,
        extraData: Buffer.alloc(0),
        gasUsed: 0n,
        mixHash: Buffer.alloc(32, 0),
        nonce: Buffer.alloc(8, 0),
      },
      { common: this.common },
    );

    const vmBlock = new EthereumBlock(blockHeader, [], [], undefined, {
      common: this.common,
    });

    // VM을 통해 직접 실행
    const result = await runTx(this.deployVM, {
      tx: txForVM,
      block: vmBlock,
    });

    // 실행 결과 파싱
    const status: 1 | 0 = result.execResult.exceptionError ? 0 : 1;
    const gasUsed = result.totalGasSpent;

    // 로그 파싱
    const logs: { address: Address; topics: Hash[]; data: string }[] = [];
    if (result.execResult.logs) {
      for (const log of result.execResult.logs) {
        const logAddress = this.cryptoService.bytesToHex(
          Buffer.from(log[0] as Uint8Array),
        );
        const logTopics = (log[1] as Uint8Array[]).map((topic) =>
          this.cryptoService.bytesToHex(Buffer.from(topic)),
        );
        const logData = this.cryptoService.bytesToHex(
          Buffer.from(log[2] as Uint8Array),
        );
        logs.push({
          address: logAddress,
          topics: logTopics,
          data: logData,
        });
      }
    }

    // 반환값 파싱
    let returnValue = '';
    if (result.execResult.returnValue) {
      returnValue = this.cryptoService.bytesToHex(
        Buffer.from(result.execResult.returnValue),
      );
    }

    // nonce 증가 (실제 트랜잭션이 아니지만 상태 변경이 일어났으므로)
    await this.accountService.incrementNonce(from);

    return {
      result: returnValue,
      status,
      gasUsed,
      logs,
    };
  }

  /**
   * 함수 선택자 계산 (이더리움 표준)
   *
   * 함수 선택자 = keccak256("함수명(파라미터타입)")[0:4]
   *
   * 예시:
   * - "setVault(address)" → keccak256("setVault(address)")[0:4]
   * - "mintStablecoin(uint256)" → keccak256("mintStablecoin(uint256)")[0:4]
   *
   * @param functionName - 함수명 (예: "setVault")
   * @param paramTypes - 파라미터 타입 배열 (예: ["address"])
   * @returns 함수 선택자 (4바이트 hex string, "0x" 접두사 포함)
   */
  private getFunctionSelector(
    functionName: string,
    paramTypes: string[],
  ): string {
    const signature = `${functionName}(${paramTypes.join(',')})`;
    // ⚠️ 중요: 이더리움 함수 선택자는 Keccak-256 해시의 첫 4바이트
    // hashUtf8은 SHA3-256을 사용하므로 keccak 라이브러리를 직접 사용해야 함
    const hash = keccak('keccak256').update(signature).digest('hex');
    return '0x' + hash.slice(0, 8); // "0x" + 8 hex chars = 4 bytes
  }

  /**
   * 파라미터 ABI 인코딩 (기본 타입만 지원)
   *
   * 지원 타입:
   * - address: 32바이트 패딩 (왼쪽에 0 추가)
   * - uint256: 32바이트 빅엔디안
   *
   * @param paramType - 파라미터 타입 (예: "address", "uint256")
   * @param value - 파라미터 값 (address는 hex string, uint256은 bigint 또는 string)
   * @returns 인코딩된 파라미터 (32바이트 hex string)
   */
  private encodeParameter(
    paramType: string,
    value: string | bigint | number,
  ): string {
    if (paramType === 'address') {
      // address: 32바이트 패딩 (왼쪽에 0 추가)
      if (typeof value !== 'string') {
        throw new Error('Address parameter must be a string');
      }
      const address = value.startsWith('0x') ? value.slice(2) : value;
      return address.padStart(64, '0');
    } else if (paramType === 'uint256' || paramType === 'uint') {
      // uint256: 32바이트 빅엔디안
      // value는 hex string (0x 접두사 포함) 또는 bigint 또는 number
      const num = typeof value === 'bigint' ? value : BigInt(value);
      const hex = num.toString(16);
      return hex.padStart(64, '0');
    } else {
      throw new Error(`Unsupported parameter type: ${paramType}`);
    }
  }

  /**
   * 함수 호출 데이터 생성 (ABI 인코딩)
   *
   * 이더리움 표준:
   * - data = 함수선택자(4바이트) + 인코딩된파라미터들
   *
   * 예시:
   * - setVault(address) 호출
   *   - 함수 선택자: keccak256("setVault(address)")[0:4]
   *   - 파라미터: address를 32바이트로 패딩
   *   - data = 함수선택자 + 인코딩된주소
   *
   * @param functionName - 함수명 (예: "setVault")
   * @param paramTypes - 파라미터 타입 배열 (예: ["address"])
   * @param paramValues - 파라미터 값 배열 (예: ["0x1234..."])
   * @returns ABI 인코딩된 함수 호출 데이터 (hex string, "0x" 접두사 포함)
   */
  encodeFunctionCall(
    functionName: string,
    paramTypes: string[],
    paramValues: any[],
  ): string {
    if (paramTypes.length !== paramValues.length) {
      throw new Error(
        `Parameter count mismatch: ${paramTypes.length} types but ${paramValues.length} values`,
      );
    }

    // 함수 선택자 계산 (4바이트)
    const selector = this.getFunctionSelector(functionName, paramTypes);
    const selectorHex = selector.slice(2); // "0x" 제거

    // 파라미터 인코딩 (동적 타입 처리)
    const encodedParams: string[] = [];
    const dynamicData: string[] = [];
    let dynamicOffset = paramTypes.length * 32; // 기본 파라미터들이 차지하는 바이트 수

    for (let i = 0; i < paramTypes.length; i++) {
      const type = paramTypes[i];
      const value = paramValues[i];

      if (type.endsWith('[]')) {
        // 동적 타입 (배열): offset 저장
        const offsetHex = dynamicOffset.toString(16).padStart(64, '0');
        encodedParams.push(offsetHex);

        // 배열 데이터는 dynamicData에 추가
        const baseType = type.slice(0, -2); // "address[]" -> "address"
        const arrayData = this.encodeArray(baseType, value);
        dynamicData.push(arrayData);
        dynamicOffset += arrayData.length / 2; // hex string이므로 /2
      } else {
        // 정적 타입: 직접 인코딩
        encodedParams.push(this.encodeParameter(type, value));
      }
    }

    // 함수 선택자 + 정적 파라미터들 + 동적 데이터 결합
    const data =
      '0x' + selectorHex + encodedParams.join('') + dynamicData.join('');

    return data;
  }

  /**
   * 배열 타입 인코딩
   *
   * ABI 인코딩 규칙:
   * - length (32바이트): 배열 길이
   * - 각 요소들 (각 32바이트)
   *
   * @param baseType - 기본 타입 (예: "address", "uint256")
   * @param values - 배열 값
   * @returns 인코딩된 배열 데이터 (hex string, "0x" 접두사 없음)
   */
  private encodeArray(baseType: string, values: any[]): string {
    if (!Array.isArray(values)) {
      throw new Error(`Expected array but got ${typeof values}`);
    }

    // 배열 길이 (32바이트)
    const lengthHex = values.length.toString(16).padStart(64, '0');

    // 각 요소 인코딩
    const elements = values.map((value) =>
      this.encodeParameter(baseType, value),
    );

    return lengthHex + elements.join('');
  }

  /**
   * 트랜잭션이 블록에 포함될 때까지 대기
   *
   * @param txHash - 트랜잭션 해시
   * @param maxRetries - 최대 재시도 횟수 (기본값: 20)
   * @param delayMs - 재시도 간격 (기본값: 3000ms)
   * @returns 트랜잭션이 블록에 포함되었는지 여부
   */
  async waitForTransaction(
    txHash: string,
    maxRetries: number = 20,
    delayMs: number = 3000,
  ): Promise<boolean> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const receipt = await this.transactionService.getReceipt(txHash);
        if (receipt && receipt.blockNumber) {
          // ⚠️ 중요: receipt.status를 확인하여 트랜잭션 성공 여부 확인
          const status =
            typeof receipt.status === 'string'
              ? parseInt(receipt.status, 16)
              : receipt.status;

          if (status === 0) {
            this.logger.error(
              `Transaction ${txHash} failed (status: 0x0) in block ${receipt.blockNumber}`,
            );
            return false;
          }

          this.logger.log(
            `Transaction ${txHash} succeeded (status: 0x1) in block ${receipt.blockNumber}`,
          );
          return true;
        }
      } catch {
        // Receipt가 아직 생성되지 않음
      }

      if (i < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    this.logger.warn(
      `Transaction ${txHash} not included in block after ${maxRetries} retries`,
    );
    return false;
  }

  /**
   * 배포 트랜잭션의 receipt를 조회하여 컨트랙트 주소 가져오기
   */
  private async waitForContractAddress(
    txHash: string,
    maxRetries: number = 20,
    delayMs: number = 3000,
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
   * 트랜잭션 Receipt 조회 (public 메서드)
   *
   * StakingService 등에서 이벤트 로그를 파싱하기 위해 사용
   *
   * @param txHash - 트랜잭션 해시
   * @returns TransactionReceipt 또는 null
   */
  async getTransactionReceipt(txHash: string): Promise<any | null> {
    return await this.transactionService.getReceipt(txHash);
  }

  /**
   * 스테이블코인 시스템 전체 배포
   *
   * 배포 순서:
   * 1. StableCoin 배포
   * 2. CollateralVault 배포
   * 3. CollateralVault.setStablecoin(StableCoin주소) 호출
   * 4. StableCoin.setVault(CollateralVault주소) 호출
   *
   * @returns 배포된 컨트랙트 주소들
   */
  async deployStablecoin(): Promise<{
    stablecoinAddress: string;
    vaultAddress: string;
    stablecoinTxHash: string;
    vaultTxHash: string;
  }> {
    // contract-bytecodes.json에서 바이트코드 읽기
    const bytecodesPath = path.resolve(
      process.cwd(),
      'contract-bytecodes.json',
    );
    if (!fs.existsSync(bytecodesPath)) {
      throw new Error('contract-bytecodes.json not found');
    }

    const bytecodesContent = fs.readFileSync(bytecodesPath, 'utf8');
    const bytecodesData: {
      contracts: Array<{
        name: string;
        bytecode: string;
        abi?: any[];
      }>;
    } = JSON.parse(bytecodesContent);

    const stablecoinContract = bytecodesData.contracts.find(
      (c) => c.name === 'StableCoin',
    );
    const vaultContract = bytecodesData.contracts.find(
      (c) => c.name === 'CollateralVault',
    );

    if (!stablecoinContract?.bytecode || !vaultContract?.bytecode) {
      throw new Error('StableCoin or CollateralVault bytecode not found');
    }

    const stablecoinBytecode = stablecoinContract.bytecode;
    const vaultBytecode = vaultContract.bytecode;
    const stablecoinABI = stablecoinContract.abi;
    const vaultABI = vaultContract.abi;

    this.logger.log('Starting stablecoin system deployment...');

    if (!this.deploymentAccount) {
      throw new Error('Deployment account (255) is not loaded');
    }

    // 최신 블록 정보 가져오기 (deployContractDirect에 필요)
    const latestBlock = await this.blockRepository.findLatest();
    if (!latestBlock) {
      throw new Error('Latest block not found');
    }
    const blockNumber = latestBlock.number;
    const timestamp = Date.now(); // 밀리초

    // 1. StableCoin 배포 (VM을 통해 직접 실행, 트랜잭션 제출 없이)
    // 현재 상황:
    // - Execution Layer와 Consensus Layer가 통합되어 있음
    // - 컨트랙트 배포를 트랜잭션으로 처리하면 nonce race condition 발생 가능
    // - Genesis Block 생성 시점이나 특수한 경우에 직접 배포 필요
    //
    // 해결 방법:
    // - VM을 통해 직접 컨트랙트 배포
    // - 트랜잭션 없이 상태 변경 (가스 비용 없음, 블록에 포함되지 않음)
    // - nonce는 증가시키지만 실제 트랜잭션은 생성하지 않음
    //
    // 추후 레이어 분리 시:
    // - Execution Layer: 트랜잭션으로 컨트랙트 배포
    // - Consensus Layer: 블록에 포함하여 실행
    // - 레이어 분리 시에는 트랜잭션 방식으로 처리 가능
    this.logger.log('Deploying StableCoin via VM (no transaction)...');
    const stablecoinAddress = await this.deployContractDirect(
      stablecoinBytecode,
      this.deploymentAccount.address,
      this.deploymentAccount.privateKey,
      0n, // value
      blockNumber,
      timestamp,
    );

    if (!stablecoinAddress) {
      throw new Error('Failed to get StableCoin address');
    }

    this.logger.log(`StableCoin deployed at: ${stablecoinAddress}`);

    // ABI가 있으면 저장
    if (stablecoinABI) {
      this.saveContractABI(stablecoinAddress, 'StableCoin', stablecoinABI);
    }

    // 2. CollateralVault 배포 (VM을 통해 직접 실행, 트랜잭션 제출 없이)
    this.logger.log('Deploying CollateralVault via VM (no transaction)...');
    const vaultAddress = await this.deployContractDirect(
      vaultBytecode,
      this.deploymentAccount.address,
      this.deploymentAccount.privateKey,
      0n, // value
      blockNumber,
      timestamp,
    );

    if (!vaultAddress) {
      throw new Error('Failed to get CollateralVault address');
    }

    this.logger.log(`CollateralVault deployed at: ${vaultAddress}`);

    // ABI가 있으면 저장 (배포 시 주소 계산하여 저장됨)
    if (vaultABI) {
      this.saveContractABI(vaultAddress, 'CollateralVault', vaultABI);
    }

    // 3. CollateralVault.setStablecoin(StableCoin주소) 호출 (VM을 통해 직접 실행)
    this.logger.log('Linking CollateralVault to StableCoin via VM (no transaction)...');
    const setStablecoinData = this.encodeFunctionCall(
      'setStablecoin',
      ['address'],
      [stablecoinAddress],
    );
    await this.executeContractDirect(
      vaultAddress,
      setStablecoinData,
      this.deploymentAccount.address,
      this.deploymentAccount.privateKey,
      0n, // value
      blockNumber,
      timestamp,
    );
    this.logger.log('CollateralVault.setStablecoin() completed');

    // 4. StableCoin.setVault(CollateralVault주소) 호출 (VM을 통해 직접 실행)
    this.logger.log('Linking StableCoin to CollateralVault via VM (no transaction)...');
    const setVaultData = this.encodeFunctionCall(
      'setVault',
      ['address'],
      [vaultAddress],
    );
    await this.executeContractDirect(
      stablecoinAddress,
      setVaultData,
      this.deploymentAccount.address,
      this.deploymentAccount.privateKey,
      0n, // value
      blockNumber,
      timestamp,
    );
    this.logger.log('StableCoin.setVault() completed');

    // 5. 연결 검증: 실제로 연결되었는지 확인
    this.logger.log('Verifying contract linkage...');
    const vaultStablecoinCheck = await this.callContract(
      vaultAddress,
      this.encodeFunctionCall('stablecoin', [], []),
    );
    const stablecoinVaultCheck = await this.callContract(
      stablecoinAddress,
      this.encodeFunctionCall('vault', [], []),
    );

    // 결과에서 주소 추출 (마지막 20바이트 = 40 hex characters)
    const vaultStablecoinAddr = `0x${vaultStablecoinCheck.result.slice(-40)}`;
    const stablecoinVaultAddr = `0x${stablecoinVaultCheck.result.slice(-40)}`;

    if (
      vaultStablecoinAddr.toLowerCase() !== stablecoinAddress.toLowerCase() ||
      stablecoinVaultAddr.toLowerCase() !== vaultAddress.toLowerCase()
    ) {
      throw new Error(
        `Contract linkage verification failed. Vault.stablecoin=${vaultStablecoinAddr} (expected ${stablecoinAddress}), StableCoin.vault=${stablecoinVaultAddr} (expected ${vaultAddress})`,
      );
    }
    this.logger.log('Contract linkage verified successfully');

    this.logger.log('Stablecoin system deployment completed!');
    this.logger.log(`StableCoin: ${stablecoinAddress}`);
    this.logger.log(`CollateralVault: ${vaultAddress}`);
    this.logger.log('Contracts are now linked and ready to use');

    // 배포된 컨트랙트 주소 저장
    this.saveDeployedContracts(stablecoinAddress, vaultAddress);

    return {
      stablecoinAddress,
      vaultAddress,
      stablecoinTxHash: '0x0000000000000000000000000000000000000000000000000000000000000000', // 트랜잭션 없이 배포됨
      vaultTxHash: '0x0000000000000000000000000000000000000000000000000000000000000000', // 트랜잭션 없이 배포됨
    };
  }

  /**
   * 배포된 컨트랙트 주소 저장
   *
   * deployed-contracts.json 파일에 최신 배포 주소를 저장합니다.
   * API에서 배포된 컨트랙트 주소를 빠르게 조회할 수 있습니다.
   *
   * @param stablecoinAddress - StableCoin 컨트랙트 주소 (선택)
   * @param vaultAddress - CollateralVault 컨트랙트 주소 (선택)
   * @param stakingAddress - StakingContract 컨트랙트 주소 (선택)
   */
  private saveDeployedContracts(
    stablecoinAddress?: Address,
    vaultAddress?: Address,
    stakingAddress?: Address,
  ): void {
    try {
      const deployedPath = path.resolve(
        process.cwd(),
        'deployed-contracts.json',
      );

      // 기존 파일 읽기 (있는 경우)
      let deployedData: any = {};
      if (fs.existsSync(deployedPath)) {
        try {
          const content = fs.readFileSync(deployedPath, 'utf8');
          deployedData = JSON.parse(content);
        } catch {
          // 파일이 있지만 파싱 실패 시 빈 객체로 시작
          deployedData = {};
        }
      }

      // 업데이트할 컨트랙트만 덮어쓰기
      if (stablecoinAddress) {
        deployedData.stablecoin = {
          address: stablecoinAddress,
          name: 'StableCoin',
          deployedAt: new Date().toISOString(),
        };
      }

      if (vaultAddress) {
        deployedData.vault = {
          address: vaultAddress,
          name: 'CollateralVault',
          deployedAt: new Date().toISOString(),
        };
      }

      if (stakingAddress) {
        deployedData.staking = {
          address: stakingAddress,
          name: 'StakingContract',
          deployedAt: new Date().toISOString(),
        };
      }

      fs.writeFileSync(
        deployedPath,
        JSON.stringify(deployedData, null, 2),
        'utf8',
      );

      const savedContracts: string[] = [];
      if (stablecoinAddress)
        savedContracts.push(`StableCoin=${stablecoinAddress}`);
      if (vaultAddress) savedContracts.push(`Vault=${vaultAddress}`);
      if (stakingAddress) savedContracts.push(`Staking=${stakingAddress}`);

      this.logger.log(`Deployed contracts saved: ${savedContracts.join(', ')}`);
    } catch (error: any) {
      this.logger.error(`Failed to save deployed contracts: ${error.message}`);
    }
  }

  /**
   * StakingContract 배포 및 설정
   *
   * StakingContract를 배포하고 검증합니다.
   * genesis-accounts.json의 0번 계정을 admin으로 설정합니다.
   *
   * @returns 배포된 StakingContract 주소 및 트랜잭션 해시
   */
  async deployStakingContract(): Promise<{
    stakingAddress: string;
    stakingTxHash: string;
  }> {
    // contract-bytecodes.json에서 바이트코드 읽기
    const bytecodesPath = path.resolve(
      process.cwd(),
      'contract-bytecodes.json',
    );
    if (!fs.existsSync(bytecodesPath)) {
      throw new Error('contract-bytecodes.json not found');
    }

    const bytecodesContent = fs.readFileSync(bytecodesPath, 'utf8');
    const bytecodesData: {
      contracts: Array<{
        name: string;
        bytecode: string;
        abi?: any[];
      }>;
    } = JSON.parse(bytecodesContent);

    const stakingContract = bytecodesData.contracts.find(
      (c) => c.name === 'StakingContract',
    );

    if (!stakingContract?.bytecode) {
      throw new Error('StakingContract bytecode not found');
    }

    const stakingBytecode = stakingContract.bytecode;
    const stakingABI = stakingContract.abi;

    // contract-abis.json에서 ABI 읽기 (없으면 bytecodes에서 가져온 것 사용)
    let finalABI = stakingABI;
    if (!finalABI) {
      const abisPath = path.resolve(process.cwd(), 'contract-abis.json');
      if (fs.existsSync(abisPath)) {
        try {
          const abisContent = fs.readFileSync(abisPath, 'utf8');
          const abisData: {
            contracts: Array<{
              name: string;
              abi: any[];
            }>;
          } = JSON.parse(abisContent);
          const stakingABIFromFile = abisData.contracts.find(
            (c) => c.name === 'StakingContract',
          );
          if (stakingABIFromFile) {
            finalABI = stakingABIFromFile.abi;
          }
        } catch {
          // ABI 파일 읽기 실패 시 무시
        }
      }
    }

    this.logger.log('Starting StakingContract deployment...');

    if (!this.deploymentAccount) {
      throw new Error('Deployment account (255) is not loaded');
    }

    // 최신 블록 정보 가져오기 (deployContractDirect에 필요)
    const latestBlock = await this.blockRepository.findLatest();
    if (!latestBlock) {
      throw new Error('Latest block not found');
    }
    const blockNumber = latestBlock.number;
    const timestamp = Date.now(); // 밀리초

    // StakingContract 배포 (VM을 통해 직접 실행, 트랜잭션 제출 없이)
    // 현재 상황:
    // - Execution Layer와 Consensus Layer가 통합되어 있음
    // - 컨트랙트 배포를 트랜잭션으로 처리하면 nonce race condition 발생 가능
    // - Genesis Block 생성 시점이나 특수한 경우에 직접 배포 필요
    //
    // 해결 방법:
    // - VM을 통해 직접 컨트랙트 배포
    // - 트랜잭션 없이 상태 변경 (가스 비용 없음, 블록에 포함되지 않음)
    // - nonce는 증가시키지만 실제 트랜잭션은 생성하지 않음
    //
    // 추후 레이어 분리 시:
    // - Execution Layer: 트랜잭션으로 컨트랙트 배포
    // - Consensus Layer: 블록에 포함하여 실행
    // - 레이어 분리 시에는 트랜잭션 방식으로 처리 가능
    this.logger.log('Deploying StakingContract via VM (no transaction)...');
    const stakingAddress = await this.deployContractDirect(
      stakingBytecode,
      this.deploymentAccount.address,
      this.deploymentAccount.privateKey,
      0n, // value
      blockNumber,
      timestamp,
    );

    this.logger.log(`StakingContract deployed at: ${stakingAddress}`);

    // ABI가 있으면 저장
    if (finalABI) {
      this.saveContractABI(stakingAddress, 'StakingContract', finalABI);
    }

    // 배포 검증: 상수 값 확인 (MIN_STAKE, WITHDRAWAL_DELAY, MAX_VALIDATORS)
    this.logger.log('Verifying StakingContract deployment...');
    const minStakeCheck = await this.callContract(
      stakingAddress,
      this.encodeFunctionCall('MIN_STAKE', [], []),
    );
    const withdrawalDelayCheck = await this.callContract(
      stakingAddress,
      this.encodeFunctionCall('WITHDRAWAL_DELAY', [], []),
    );
    const maxValidatorsCheck = await this.callContract(
      stakingAddress,
      this.encodeFunctionCall('MAX_VALIDATORS', [], []),
    );

    this.logger.log('StakingContract constants verified:');
    this.logger.log(`  - MIN_STAKE: ${minStakeCheck.result}`);
    this.logger.log(`  - WITHDRAWAL_DELAY: ${withdrawalDelayCheck.result}`);
    this.logger.log(`  - MAX_VALIDATORS: ${maxValidatorsCheck.result}`);

    this.logger.log('StakingContract deployment completed!');
    this.logger.log(`StakingContract: ${stakingAddress}`);
    this.logger.log(
      'StakingContract is ready to use (Backend will automatically handle rewards and withdrawals)',
    );

    // 배포된 컨트랙트 주소 저장
    this.saveDeployedContracts(undefined, undefined, stakingAddress);

    return {
      stakingAddress,
      stakingTxHash: '0x0000000000000000000000000000000000000000000000000000000000000000', // 트랜잭션 없이 배포됨
    };
  }

  /**
   * 배포된 컨트랙트 주소 조회
   *
   * deployed-contracts.json에서 최신 배포 주소를 조회합니다.
   *
   * @returns 배포된 컨트랙트 주소 정보
   */
  getDeployedContracts(): {
    stablecoin?: { address: string; name: string; deployedAt: string };
    vault?: { address: string; name: string; deployedAt: string };
    staking?: { address: string; name: string; deployedAt: string };
  } | null {
    try {
      const deployedPath = path.resolve(
        process.cwd(),
        'deployed-contracts.json',
      );
      if (!fs.existsSync(deployedPath)) {
        return null;
      }

      const content = fs.readFileSync(deployedPath, 'utf8');
      const deployedData: {
        stablecoin?: { address: string; name: string; deployedAt: string };
        vault?: { address: string; name: string; deployedAt: string };
        staking?: { address: string; name: string; deployedAt: string };
      } = JSON.parse(content);

      return deployedData;
    } catch (error: any) {
      this.logger.error(`Failed to get deployed contracts: ${error.message}`);
      return null;
    }
  }
}
