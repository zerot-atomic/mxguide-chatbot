import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ChatModule } from './chat/chat.module';
import { AppConfigModule } from './config/config.module';
import { APP_CONFIG, AppConfig } from './config/env';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    AppConfigModule,
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => [{ ttl: 60_000, limit: config.rateLimitPerMinute }],
    }),
    ChatModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
