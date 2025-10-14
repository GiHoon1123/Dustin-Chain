import { Module } from '@nestjs/common';
import { ValidatorController } from './validator.controller';
import { ValidatorService } from './validator.service';

/**
 * Validator Module
 *
 * Validator 관리
 *
 * 구성:
 * - ValidatorService: Proposer/Committee 선택
 * - ValidatorController: Validator 조회 API
 *
 * 현재:
 * - 256개 Genesis Validator (하드코딩)
 * - 스테이킹 없음
 *
 * 나중에:
 * - Staking 시스템
 * - 동적 Validator 등록/해제
 */
@Module({
  controllers: [ValidatorController],
  providers: [ValidatorService],
  exports: [ValidatorService],
})
export class ValidatorModule {}
