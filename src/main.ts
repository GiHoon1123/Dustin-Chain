import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // DTO 검증 파이프 전역 설정
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // DTO에 없는 속성 제거
      forbidNonWhitelisted: true, // DTO에 없는 속성 있으면 에러
      transform: true, // 자동 타입 변환
    }),
  );

  // Swagger 설정
  const config = new DocumentBuilder()
    .setTitle('Dustin-Chain API')
    .setDescription('이더리움 POS 기반 블록체인 API 문서')
    .setVersion('1.0')
    .addTag('account', '계정 관리 API')
    .addTag('transaction', '트랜잭션 관리 API')
    .addTag('validator', 'Validator 관리 API')
    .addTag('consensus', 'Consensus 정보 API')
    .addTag('block', '블록 조회 API')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  await app.listen(process.env.PORT ?? 3000);
  console.log(
    `Application is running on: http://localhost:${process.env.PORT ?? 3000}`,
  );
  console.log(`Swagger UI: http://localhost:${process.env.PORT ?? 3000}/api`);
}
bootstrap();
