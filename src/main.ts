import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  
  // Configure CORS
  app.enableCors({
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true,
  });
  
  const port = process.env.PORT ?? 3001;
  const host = process.env.HOST ?? 'localhost';
  
  await app.listen(port, host);
  logger.log(`Restaurant Chat Service is running on http://${host}:${port}`);
}
bootstrap();
