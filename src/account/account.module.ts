import { Module } from '@nestjs/common';
import { StateManager } from '../state/state-manager';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { AccountMemoryRepository } from './repositories/account-memory.repository';
import { IAccountRepository } from './repositories/account.repository.interface';

/**
 * Account Module
 *
 * 역할:
 * - Account 관련 기능 제공
 * - Repository와 Service를 DI 컨테이너에 등록
 *
 * 구조:
 * - Controller (HTTP API)
 * - Repository (데이터 접근)
 * - Service (비즈니스 로직)
 *
 * Export:
 * - AccountService: 다른 모듈에서 사용
 */
@Module({
  controllers: [AccountController],
  providers: [
    // Repository를 인터페이스로 제공
    // 나중에 LevelDB로 교체 시 여기만 변경
    {
      provide: 'IAccountRepository',
      useClass: AccountMemoryRepository,
    },
    // Service에 Repository와 StateManager 주입
    {
      provide: AccountService,
      useFactory: (
        repository: IAccountRepository,
        stateManager: StateManager,
      ) => {
        return new AccountService(repository, stateManager);
      },
      inject: ['IAccountRepository', StateManager],
    },
  ],
  exports: [AccountService], // 다른 모듈에서 사용 가능
})
export class AccountModule {}
