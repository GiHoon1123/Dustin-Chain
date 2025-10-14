import { Module } from '@nestjs/common';
import { ConsensusController } from './consensus.controller';
import { ConsensusService } from './consensus.service';

/**
 * Consensus Module
 *
 * POS 합의 메커니즘
 *
 * 구성:
 * - ConsensusService: Attestation, Epoch 관리
 * - ConsensusController: Consensus 통계 API
 *
 * 역할:
 * - Attestation 수집
 * - Supermajority 확인 (2/3)
 * - Epoch/Slot 계산
 * - Finality (나중에)
 */
@Module({
  controllers: [ConsensusController],
  providers: [ConsensusService],
  exports: [ConsensusService],
})
export class ConsensusModule {}
