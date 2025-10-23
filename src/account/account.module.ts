import { Module } from '@nestjs/common';
import { StateManager } from '../state/state-manager';
import { IStateRepository } from '../storage/repositories/state.repository.interface';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';

/**
 * Account Module
 *
 * 역할:
 * - Account 관련 기능 제공
 * - Repository와 Service를 DI 컨테이너에 등록
 *
 * 구조:
 * - Controller (HTTP API)
 * - Service (비즈니스 로직)
 *
 * Export:
 * - AccountService: 다른 모듈에서 사용
 *
 * 변경사항 (State Trie 도입):
 * - IAccountRepository 제거 (IStateRepository 사용)
 * - StorageModule이 Global이므로 IStateRepository는 자동 주입
 */
@Module({
  controllers: [AccountController],
  providers: [
    // Service에 IStateRepository와 StateManager 주입
    {
      provide: AccountService,
      useFactory: (
        stateRepository: IStateRepository,
        stateManager: StateManager,
      ) => {
        return new AccountService(stateRepository, stateManager);
      },
      inject: [IStateRepository, StateManager],
    },
  ],
  exports: [AccountService], // 다른 모듈에서 사용 가능
})
export class AccountModule {}
