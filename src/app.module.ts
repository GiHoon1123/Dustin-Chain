import { Module } from '@nestjs/common';
import { AccountModule } from './account/account.module';
import { BlockModule } from './block/block.module';
import { CommonModule } from './common/common.module';
import { TransactionModule } from './transaction/transaction.module';

/**
 * AppModule
 *
 * 애플리케이션의 루트 모듈
 *
 * Modules:
 * - CommonModule: 전역 유틸리티 (CryptoService 등)
 * - AccountModule: 계정 상태 관리
 * - TransactionModule: 트랜잭션 관리
 * - BlockModule: 블록 생성 및 관리 (자동 생성)
 */
@Module({
  imports: [CommonModule, AccountModule, TransactionModule, BlockModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
