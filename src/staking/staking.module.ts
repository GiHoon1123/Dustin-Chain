import { Module } from '@nestjs/common';
import { ContractModule } from '../contract/contract.module';
import { StakingController } from './staking.controller';
import { StakingService } from './staking.service';

/**
 * Staking Module
 *
 * 스테이킹 시스템 관리
 */
@Module({
  imports: [ContractModule],
  controllers: [StakingController],
  providers: [StakingService],
  exports: [StakingService],
})
export class StakingModule {}

