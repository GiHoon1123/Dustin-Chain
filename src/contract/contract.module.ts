import { Module } from '@nestjs/common';
import { AccountModule } from '../account/account.module';
import { TransactionModule } from '../transaction/transaction.module';
import { ContractController } from './contract.controller';
import { ContractService } from './contract.service';
import { StablecoinController } from './stablecoin.controller';
import { StablecoinService } from './stablecoin.service';

/**
 * Contract Module
 *
 * 컨트랙트 관련 기능 제공
 *
 * 역할:
 * - 컨트랙트 바이트코드 조회
 * - 컨트랙트 읽기 메서드 호출 (eth_call)
 * - 컨트랙트 배포 (VM 직접 실행)
 *
 * 구성:
 * - ContractController: API 엔드포인트
 * - ContractService: 비즈니스 로직
 *
 * 의존성:
 * - AccountModule: 계정 정보 조회 (codeHash 등)
 * - TransactionModule: 트랜잭션 생성 및 제출 (쓰기 작업용)
 * - IBlockRepository: 최신 블록 조회
 */
@Module({
  imports: [
    AccountModule,
    TransactionModule,
  ],
  controllers: [ContractController, StablecoinController],
  providers: [ContractService, StablecoinService],
  exports: [ContractService, StablecoinService],
})
export class ContractModule {}
