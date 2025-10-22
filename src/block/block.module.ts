import { Module } from '@nestjs/common';
import { AccountModule } from '../account/account.module';
import { ConsensusModule } from '../consensus/consensus.module';
import { TransactionModule } from '../transaction/transaction.module';
import { ValidatorModule } from '../validator/validator.module';
import { BlockController } from './block.controller';
import { BlockService } from './block.service';
import { BlockProducer } from './producer/block.producer';
import { BlockLevelDBRepository } from './repositories/block-leveldb.repository';
import { IBlockRepository } from './repositories/block.repository.interface';

/**
 * Block Module
 *
 * 블록 생성 및 관리
 *
 * 구성:
 * - BlockService: 블록 생성 및 조회 로직
 * - BlockProducer: 12초마다 자동 블록 생성
 * - BlockController: 블록 조회 API
 * - BlockLevelDBRepository: LevelDB 블록 저장소 (Ethereum Geth 방식)
 *
 * 의존성:
 * - AccountModule: 계정 상태 관리 (잔액, nonce)
 * - TransactionModule: 트랜잭션 실행
 * - CommonModule: Crypto 서비스 (해시 계산)
 *
 * 자동 실행:
 * - BlockProducer가 OnModuleInit로 자동 시작
 * - Genesis Block 생성 후 12초마다 블록 생성
 */
@Module({
  imports: [AccountModule, TransactionModule, ValidatorModule, ConsensusModule],
  controllers: [BlockController],
  providers: [
    BlockService,
    BlockProducer,
    {
      provide: IBlockRepository,
      useClass: BlockLevelDBRepository, // ✅ BlockMemoryRepository → BlockLevelDBRepository
    },
  ],
  exports: [BlockService, BlockProducer],
})
export class BlockModule {}
