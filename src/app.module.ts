import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module';

/**
 * AppModule
 *
 * 애플리케이션의 루트 모듈
 *
 * CommonModule을 전역 모듈로 import하여
 * CryptoService 등 기본 유틸리티를 모든 모듈에서 사용 가능하게 함
 */
@Module({
  imports: [CommonModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
