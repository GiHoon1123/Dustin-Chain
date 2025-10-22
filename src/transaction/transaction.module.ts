import { Module } from '@nestjs/common';
import { AccountModule } from '../account/account.module';
import { TransactionPool } from './pool/transaction.pool';
import { TransactionController } from './transaction.controller';
import { TransactionService } from './transaction.service';

/**
 * Transaction Module
 *
 * 트랜잭션 생명주기 관리:
 * 1. 서명 생성 (테스트용)
 * 2. 검증 (서명, nonce, 잔액)
 * 3. Mempool 추가
 * 4. 조회 (Transaction + Receipt)
 *
 * 구성:
 * - TransactionController: API 엔드포인트
 * - TransactionService: 비즈니스 로직
 * - TransactionPool: Mempool (In-Memory)
 *
 * 의존성:
 * - AccountModule: 계정 상태 조회 (nonce, 잔액)
 * - StorageModule (Global): Receipt 조회 (자동 주입)
 */
@Module({
  imports: [AccountModule],
  controllers: [TransactionController],
  providers: [TransactionService, TransactionPool],
  exports: [TransactionService, TransactionPool],
})
export class TransactionModule {}
