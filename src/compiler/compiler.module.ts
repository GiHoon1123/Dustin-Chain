import { Module } from '@nestjs/common';
import { CompilerController } from './compiler.controller';
import { CompilerService } from './compiler.service';

/**
 * Compiler Module
 *
 * Solidity 컨트랙트 컴파일 모듈
 *
 * 역할:
 * - Solidity 컨트랙트 컴파일 (.sol → bytecode, ABI)
 * - 컴파일 결과 저장 (contract-bytecodes.json, contract-abis.json)
 * - 컴파일 에러 처리
 */
@Module({
  controllers: [CompilerController],
  providers: [CompilerService],
  exports: [CompilerService],
})
export class CompilerModule {}

