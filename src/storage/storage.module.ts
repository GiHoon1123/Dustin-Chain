import { Global, Module } from '@nestjs/common';
import { BlockLevelDBRepository } from './repositories/block-leveldb.repository';
import { IBlockRepository } from './repositories/block.repository.interface';

/**
 * Storage Module (Global)
 *
 * 인프라 계층 - 데이터 저장소 관리
 *
 * Global 모듈:
 * - 애플리케이션 전체에서 저장소 접근 가능
 * - LevelDB 인스턴스 싱글톤 관리
 * - 다른 모듈에서 import 불필요
 *
 * 책임:
 * - LevelDB 연결 관리 (data/chaindata/)
 * - Block 저장/조회 (Header + Body 분리)
 * - Receipt 저장/조회 (트랜잭션 실행 결과)
 * - Canonical Chain 관리 (블록 번호 → 해시 매핑)
 * - 저장소 추상화 (IBlockRepository)
 *
 * 저장 구조 (Ethereum Geth 방식):
 * - "H" + blockNumber → blockHash (Canonical chain)
 * - "h" + blockNumber + blockHash → Block Header (RLP)
 * - "b" + blockNumber + blockHash → Block Body (RLP)
 * - "r" + txHash → Transaction Receipt (RLP)
 * - "n" + blockHash → blockNumber (역조회)
 * - "LastBlock" → latestBlockHash
 *
 * Export:
 * - IBlockRepository: 전역에서 주입 가능
 */
@Global()
@Module({
  providers: [
    {
      provide: IBlockRepository,
      useClass: BlockLevelDBRepository,
    },
  ],
  exports: [IBlockRepository],
})
export class StorageModule {}
