import { Global, Module } from '@nestjs/common';
import { StateManager } from './state-manager';
import { CustomStateManager } from './custom-state-manager';

/**
 * StateModule
 *
 * 전역 모듈로 선언하여 모든 모듈에서 StateManager 자동 사용 가능
 *
 * 이더리움 2.0에서의 패턴:
 * - StateManager는 모든 모듈에서 필요 (Account, Transaction, Block, Consensus 등)
 * - 상태 관리는 블록체인의 핵심이므로 전역으로 제공하는 것이 효율적
 *
 * 왜 @Global() 사용:
 * - StateManager는 거의 모든 모듈에서 사용
 * - 매번 import 하는 것보다 전역으로 제공하는 것이 효율적
 * - CryptoService는 이미 CommonModule에서 글로벌로 제공되므로 중복 제거
 *
 * 포함된 서비스:
 * - StateManager: 상태 관리, 캐시, 저널링, LevelDB
 *
 * 의존성:
 * - CryptoService: CommonModule에서 글로벌로 제공
 */
@Global()
@Module({
  providers: [StateManager, CustomStateManager],
  exports: [StateManager, CustomStateManager],
})
export class StateModule {}
