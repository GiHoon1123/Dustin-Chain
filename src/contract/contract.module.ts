import { Module } from '@nestjs/common';
import { AccountModule } from '../account/account.module';
import { BlockModule } from '../block/block.module';
import { TransactionModule } from '../transaction/transaction.module';
import { ContractController } from './contract.controller';
import { ContractService } from './contract.service';

/**
 * Contract Module
 *
 * 컨트랙트 관련 기능 제공
 *
 * 역할:
 * - 컨트랙트 바이트코드 조회
 * - 컨트랙트 읽기 메서드 호출 (eth_call)
 *
 * 구성:
 * - ContractController: API 엔드포인트
 * - ContractService: 비즈니스 로직
 *
 * 의존성:
 * - AccountModule: 계정 정보 조회 (codeHash 등)
 * - BlockModule: VM 접근 (BlockService.getVM())
 * - TransactionModule: 트랜잭션 생성 및 제출 (쓰기 작업용)
 */
@Module({
  imports: [AccountModule, BlockModule, TransactionModule],
  controllers: [ContractController],
  providers: [ContractService],
  exports: [ContractService],
})
export class ContractModule {}
