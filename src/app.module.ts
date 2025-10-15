import { Module } from '@nestjs/common';
import { AccountModule } from './account/account.module';
import { BlockModule } from './block/block.module';
import { CommonModule } from './common/common.module';
import { ConsensusModule } from './consensus/consensus.module';
import { StateModule } from './state/state.module';
import { TransactionModule } from './transaction/transaction.module';
import { ValidatorModule } from './validator/validator.module';

/**
 * AppModule
 *
 * 애플리케이션의 루트 모듈
 *
 * Global Modules:
 * - CommonModule: 전역 유틸리티 (CryptoService 등)
 * - StateModule: 전역 상태 관리 (StateManager)
 *
 * Feature Modules:
 * - AccountModule: 계정 상태 관리
 * - TransactionModule: 트랜잭션 관리
 * - ValidatorModule: Validator 관리 (Proposer/Committee 선택)
 * - ConsensusModule: POS 합의 (Attestation, Epoch)
 * - BlockModule: 블록 생성 및 관리 (자동 생성)
 */
@Module({
  imports: [
    CommonModule, // @Global() - CryptoService 전역 제공
    StateModule, // @Global() - StateManager 전역 제공
    AccountModule,
    TransactionModule,
    ValidatorModule,
    ConsensusModule,
    BlockModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
