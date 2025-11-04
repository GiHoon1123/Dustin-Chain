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
import { AccountService } from '../account/account.service';
import { BlockService } from '../block/block.service';
import { CHAIN_ID } from '../common/constants/blockchain.constants';
import { CryptoService } from '../common/crypto/crypto.service';
import { Address } from '../common/types/common.types';
import { CustomStateManager } from '../state/custom-state-manager';

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

  constructor(
    private readonly evmState: CustomStateManager,
    private readonly accountService: AccountService,
    private readonly cryptoService: CryptoService,
    private readonly blockService: BlockService,
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
}
