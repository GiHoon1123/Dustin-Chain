import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AccountModule } from '../account/account.module';
import { TransactionModule } from '../transaction/transaction.module';
import { BotController } from './bot.controller';
import { TransactionBotService } from './transaction-bot.service';

/**
 * Bot Module
 *
 * 역할:
 * - 트랜잭션 자동 생성
 * - 네트워크 활성화
 * - 봇 제어 API
 *
 * 의존성:
 * - TransactionModule (트랜잭션 제출)
 * - AccountModule (잔액/Nonce 조회)
 * - ScheduleModule (스케줄링)
 */
@Module({
  imports: [ScheduleModule.forRoot(), TransactionModule, AccountModule],
  controllers: [BotController],
  providers: [TransactionBotService],
  exports: [TransactionBotService],
})
export class BotModule {}
