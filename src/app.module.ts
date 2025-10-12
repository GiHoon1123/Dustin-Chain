import { Module } from '@nestjs/common';
import { AccountModule } from './account/account.module';
import { CommonModule } from './common/common.module';

/**
 * AppModule
 *
 * 애플리케이션의 루트 모듈
 *
 * Modules:
 * - CommonModule: 전역 유틸리티 (CryptoService 등)
 * - AccountModule: 계정 상태 관리
 */
@Module({
  imports: [CommonModule, AccountModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
