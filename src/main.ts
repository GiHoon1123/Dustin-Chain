import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Swagger 설정
  const config = new DocumentBuilder()
    .setTitle('Dustin-Chain API')
    .setDescription('이더리움 POS 기반 블록체인 API 문서')
    .setVersion('1.0')
    .addTag('account', '계정 관리 API')
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
