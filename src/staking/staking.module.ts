import { Module, forwardRef } from '@nestjs/common';
import { AccountModule } from '../account/account.module';
import { ContractModule } from '../contract/contract.module';
import { StakingController } from './staking.controller';
import { StakingService } from './staking.service';

/**
 * Staking Module
 *
 * 스테이킹 시스템 관리
 */
@Module({
  imports: [forwardRef(() => ContractModule), AccountModule], // 순환 의존성 방지
  controllers: [StakingController],
  providers: [StakingService],
  exports: [StakingService],
})
export class StakingModule {}

