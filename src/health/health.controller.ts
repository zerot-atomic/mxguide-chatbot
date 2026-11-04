import { Controller, Get, Inject } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { APP_CONFIG, AppConfig } from '../config/env';

/** Render usa esta ruta para saber si el servicio está vivo. */
@Controller()
@SkipThrottle()
export class HealthController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  @Get()
  root() {
    return { name: 'mxguide-chatbot', status: 'ok' };
  }

  @Get('health')
  health() {
    return {
      status: 'ok',
      strategy: this.config.strategy,
      primary: this.config.primaryProvider,
      providers: {
        gemini: Boolean(this.config.gemini.apiKey),
        groq: Boolean(this.config.groq.apiKey),
      },
    };
  }
}