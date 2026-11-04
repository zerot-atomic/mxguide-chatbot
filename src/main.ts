import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureHttp } from './common/configure-http';
import { AppModule } from './app.module';
import { APP_CONFIG, AppConfig } from './config/env';

async function bootstrap() {
  // En local se usa el archivo .env; en Render las variables vienen del panel.
  if (existsSync('.env')) process.loadEnvFile('.env');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const config = app.get<AppConfig>(APP_CONFIG);

  configureHttp(app, config);
  app.enableShutdownHooks();

  await app.listen(config.port, '0.0.0.0');
  const providers = [config.gemini.apiKey && 'gemini', config.groq.apiKey && 'groq'].filter(Boolean).join(', ');
  new Logger('Bootstrap').log(
    `Mitlan escuchando en el puerto ${config.port} · agentes: ${providers} · estrategia: ${config.strategy}`,
  );
}

bootstrap();