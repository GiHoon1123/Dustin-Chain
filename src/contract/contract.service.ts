import {
  Common,
  createCustomCommon,
  Hardfork,
  Mainnet,
  StateManagerInterface,
} from '@ethereumjs/common';
import { Address as EthAddress } from '@ethereumjs/util';
import { createVM, VM } from '@ethereumjs/vm';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import * as fs from 'fs';
import * as keccak from 'keccak';
import * as path from 'path';
import { AccountService } from '../account/account.service';
import { BlockService } from '../block/block.service';
import { CHAIN_ID } from '../common/constants/blockchain.constants';
import { CryptoService } from '../common/crypto/crypto.service';
import { Address } from '../common/types/common.types';
import { CustomStateManager } from '../state/custom-state-manager';
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
  private callVM: VM | null = null;
  private readonly common: Common;

  private genesisAccount0: GenesisAccount | null = null;
  private deploymentAccounts: GenesisAccount[] = []; // 0-100번 계정 (컨트랙트 배포용)

  constructor(
    private readonly evmState: CustomStateManager,
    private readonly accountService: AccountService,
    private readonly cryptoService: CryptoService,
    private readonly blockService: BlockService,
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

    // 제네시스 계정 0번 로드 (쓰기 작업용)
    this.loadGenesisAccount0();
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
      const latestBlock = await this.blockService.getLatestBlock();
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
    if (!this.genesisAccount0) {
      throw new Error('Genesis account 0 is not loaded');
    }

    try {
      // 계정 0번으로 고정 (컨트랙트 쓰기 호출 시 동일 계정 사용)
      const deployerAccount = this.genesisAccount0;

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
        `Contract deployment transaction submitted: ${submittedTx.hash} (from: account #${deployerAccount.index}, ${deployerAccount.address.slice(0, 10)}...)`,
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

    // 파라미터 인코딩
    const encodedParams = paramTypes.map((type, index) =>
      this.encodeParameter(type, paramValues[index]),
    );

    // 함수 선택자 + 인코딩된 파라미터들 결합
    const data = '0x' + selectorHex + encodedParams.join('');

    return data;
  }

  /**
   * 트랜잭션이 블록에 포함될 때까지 대기
   *
   * @param txHash - 트랜잭션 해시
   * @param maxRetries - 최대 재시도 횟수 (기본값: 20)
   * @param delayMs - 재시도 간격 (기본값: 3000ms)
   * @returns 트랜잭션이 블록에 포함되었는지 여부
   */
  private async waitForTransaction(
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
  async deployStablecoinSystem(): Promise<{
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

    // 1. StableCoin 배포
    this.logger.log('Deploying StableCoin...');
    const stablecoinDeployResult = await this.deployContract(
      stablecoinBytecode,
      'StableCoin',
      stablecoinABI,
    );
    const stablecoinAddress = await this.waitForContractAddress(
      stablecoinDeployResult.hash,
    );

    if (!stablecoinAddress) {
      throw new Error('Failed to get StableCoin address');
    }

    this.logger.log(`StableCoin deployed at: ${stablecoinAddress}`);

    // ABI가 있으면 저장 (배포 시 주소 계산하여 저장됨)
    if (stablecoinABI) {
      this.saveContractABI(stablecoinAddress, 'StableCoin', stablecoinABI);
    }

    // 2. CollateralVault 배포
    this.logger.log('Deploying CollateralVault...');
    const vaultDeployResult = await this.deployContract(
      vaultBytecode,
      'CollateralVault',
      vaultABI,
    );
    const vaultAddress = await this.waitForContractAddress(
      vaultDeployResult.hash,
    );

    if (!vaultAddress) {
      throw new Error('Failed to get CollateralVault address');
    }

    this.logger.log(`CollateralVault deployed at: ${vaultAddress}`);

    // ABI가 있으면 저장 (배포 시 주소 계산하여 저장됨)
    if (vaultABI) {
      this.saveContractABI(vaultAddress, 'CollateralVault', vaultABI);
    }

    // 3. CollateralVault.setStablecoin(StableCoin주소) 호출
    this.logger.log('Linking CollateralVault to StableCoin...');
    const setStablecoinData = this.encodeFunctionCall(
      'setStablecoin',
      ['address'],
      [stablecoinAddress],
    );
    const setStablecoinResult = await this.executeContract(
      vaultAddress,
      setStablecoinData,
    );
    // 트랜잭션이 블록에 포함될 때까지 대기 및 성공 여부 확인
    const setStablecoinSuccess = await this.waitForTransaction(
      setStablecoinResult.hash,
    );
    if (!setStablecoinSuccess) {
      throw new Error(
        `Failed to link CollateralVault to StableCoin. Transaction hash: ${setStablecoinResult.hash}`,
      );
    }
    this.logger.log('CollateralVault.setStablecoin() completed');

    // 4. StableCoin.setVault(CollateralVault주소) 호출
    this.logger.log('Linking StableCoin to CollateralVault...');
    const setVaultData = this.encodeFunctionCall(
      'setVault',
      ['address'],
      [vaultAddress],
    );
    const setVaultResult = await this.executeContract(
      stablecoinAddress,
      setVaultData,
    );
    // 트랜잭션이 블록에 포함될 때까지 대기 및 성공 여부 확인
    const setVaultSuccess = await this.waitForTransaction(setVaultResult.hash);
    if (!setVaultSuccess) {
      throw new Error(
        `Failed to link StableCoin to CollateralVault. Transaction hash: ${setVaultResult.hash}`,
      );
    }
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
      stablecoinTxHash: stablecoinDeployResult.hash,
      vaultTxHash: vaultDeployResult.hash,
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
    adminAddress: string;
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

    // genesis-accounts.json에서 0번 계정 주소 읽기
    if (!this.genesisAccount0) {
      throw new Error('Genesis account 0 is not loaded');
    }

    const adminAddress = this.genesisAccount0.address;

    this.logger.log('Starting StakingContract deployment...');
    this.logger.log(`Admin address: ${adminAddress}`);

    // StakingContract 배포 (생성자에 admin 주소 전달)
    this.logger.log('Deploying StakingContract...');
    const stakingDeployResult = await this.deployContract(
      stakingBytecode,
      'StakingContract',
      finalABI,
      {
        types: ['address'],
        values: [adminAddress],
      },
    );

    const stakingAddress = await this.waitForContractAddress(
      stakingDeployResult.hash,
    );

    if (!stakingAddress) {
      throw new Error('Failed to get StakingContract address');
    }

    this.logger.log(`StakingContract deployed at: ${stakingAddress}`);

    // ABI가 있으면 저장
    if (finalABI) {
      this.saveContractABI(stakingAddress, 'StakingContract', finalABI);
    }

    // 배포 검증: admin 주소 확인
    this.logger.log('Verifying StakingContract deployment...');
    const adminCheck = await this.callContract(
      stakingAddress,
      this.encodeFunctionCall('admin', [], []),
    );

    // 결과에서 주소 추출 (마지막 20바이트 = 40 hex characters)
    const deployedAdminAddr = `0x${adminCheck.result.slice(-40)}`;

    if (deployedAdminAddr.toLowerCase() !== adminAddress.toLowerCase()) {
      throw new Error(
        `Admin address verification failed. Deployed admin=${deployedAdminAddr} (expected ${adminAddress})`,
      );
    }

    // 상수 값 확인 (MIN_STAKE, WITHDRAWAL_DELAY, MAX_VALIDATORS)
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
    this.logger.log(`Admin: ${adminAddress}`);
    this.logger.log('StakingContract is ready to use');

    // 배포된 컨트랙트 주소 저장
    this.saveDeployedContracts(undefined, undefined, stakingAddress);

    return {
      stakingAddress,
      stakingTxHash: stakingDeployResult.hash,
      adminAddress,
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
