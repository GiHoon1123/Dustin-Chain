import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto/crypto.service';

/**
 * CommonModule
 *
 * 전역 모듈로 선언하여 모든 모듈에서 자동으로 사용 가능
 *
 * 이더리움에서의 패턴:
 * - 암호화, 해싱 등 기본 유틸리티는 모든 곳에서 필요
 * - 매번 import 하는 것보다 전역으로 제공하는 것이 효율적
 *
 * 왜 @Global() 사용:
 * - CryptoService는 거의 모든 모듈에서 사용 (Wallet, Transaction, Block, Consensus 등)
 * - 타입과 상수도 전역적으로 필요
 * - 한 번만 import하면 전체 애플리케이션에서 사용 가능
 *
 * 포함된 서비스:
 * - CryptoService: 암호화, 키 생성, 서명 등
 *
 * 향후 추가될 서비스:
 * - ValidationService: 주소, 해시 검증
 * - LoggerService: 로깅
 * - ConfigService: 설정 관리
 */
@Global()
@Module({
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CommonModule {}
