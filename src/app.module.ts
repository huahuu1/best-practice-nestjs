import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { KafkaModule } from './kafka/kafka.module';
import { ChatModule } from './chat/chat.module';

@Module({
  imports: [KafkaModule, ChatModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
