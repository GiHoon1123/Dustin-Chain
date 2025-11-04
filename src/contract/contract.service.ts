import { Message } from '@ethereumjs/evm';
import { Address as EthAddress } from '@ethereumjs/util';
import { Injectable, Logger } from '@nestjs/common';
import { AccountService } from '../account/account.service';
import { BlockService } from '../block/block.service';
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
export class ContractService {
  private readonly logger = new Logger(ContractService.name);

  constructor(
    private readonly evmState: CustomStateManager,
    private readonly accountService: AccountService,
    private readonly cryptoService: CryptoService,
    private readonly blockService: BlockService,
  ) {}

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
    const vm = this.blockService.getVM();
    if (!vm) {
      throw new Error('VM is not initialized');
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

      // Message 객체 생성
      const message = new Message({
        to: toEthAddress,
        caller: callerEthAddress,
        data: dataBytes,
        gasLimit: 16777215n,
        value: 0n,
      });

      // 최신 블록 가져오기 (블록 컨텍스트용)
      const latestBlock = await this.blockService.getLatestBlock();
      if (!latestBlock) {
        throw new Error('No blocks found');
      }

      // VM에서 runCall 실행
      // 중요: message를 직접 전달하지 않고 개별 옵션으로 전달해야 this._tx가 설정됨
      // runCall 내부: if (!message) { this._tx = { gasPrice: opts.gasPrice ?? 0, origin: opts.origin ?? caller } }
      // 추가 문제: interpreter.ts에서 내부적으로 runCall({ message })를 호출할 때도 this._tx가 필요
      // 따라서 depth=0일 때만 this._tx를 설정하고, depth>0일 때는 이미 설정된 this._tx를 사용
      // StateManager.getCode는 이미 CustomStateManager에서 Uint8Array를 보장하므로 추가 검증 불필요
      const result = await vm.evm.runCall({
        caller: callerEthAddress,
        to: toEthAddress,
        data: dataBytes,
        gasLimit: 16777215n,
        value: 0n,
        gasPrice: 1000000000n, // 1 Gwei (EVM.runInterpreter가 this._tx.gasPrice를 읽으므로 필요)
        origin: callerEthAddress, // this._tx.origin도 필요
        depth: 0, // 최상위 호출이므로 depth=0
        block: {
          header: {
            number: BigInt(latestBlock.number),
            gasLimit: 30000000n,
          } as any,
        },
      });

      // Checkpoint 복구 (상태 변경 취소)
      await this.evmState.revert();

      // VM 10.x runCall 반환값: execResult 구조
      const returnValue =
        (result as any).execResult?.returnValue || new Uint8Array();
      const gasUsed = (result as any).execResult?.gasUsed || 0n;

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
