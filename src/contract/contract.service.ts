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
      // data를 Buffer로 변환 (0x 접두사 제거)
      const dataBuffer = Buffer.from(
        data.startsWith('0x') ? data.slice(2) : data,
        'hex',
      );

      // 호출자 주소 설정 (없으면 빈 주소)
      const callerAddress =
        from || '0x0000000000000000000000000000000000000000';

      // VM에서 runCall 실행
      const result = await vm.evm.runCall({
        to: to as any,
        data: dataBuffer,
        caller: callerAddress as any,
      });

      // Checkpoint 복구 (상태 변경 취소)
      await this.evmState.revert();

      // VM 10.x runCall 반환값: execResult 구조
      const returnValue = (result as any).execResult?.returnValue || new Uint8Array();
      const gasUsed = (result as any).execResult?.gasUsed || 0n;

      return {
        result: this.cryptoService.bytesToHex(returnValue),
        gasUsed: '0x' + gasUsed.toString(16),
      };
    } catch (error: unknown) {
      // 에러 발생 시에도 checkpoint 복구
      await this.evmState.revert();
      const errorMsg =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Contract call failed: ${errorMsg}`);
      throw new Error(`Contract call failed: ${errorMsg}`);
    }
  }
}

