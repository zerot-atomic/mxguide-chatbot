import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { APP_CONFIG, AppConfig } from './config/env';

async function bootstrap() {
  // En local se usa el archivo .env; en Render las variables vienen del panel.
  if (existsSync('.env')) process.loadEnvFile('.env');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: true });
  const config = app.get<AppConfig>(APP_CONFIG);

  // Render pone un proxy enfrente: así el límite por IP usa la IP real del usuario.
  app.set('trust proxy', 1);
  app.use(helmet());
  app.useBodyParser('json', { limit: '64kb' });
  app.enableCors({ origin: config.corsOrigins.length ? config.corsOrigins : true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();

  await app.listen(config.port, '0.0.0.0');
  const providers = [config.gemini.apiKey && 'gemini', config.grok.apiKey && 'grok'].filter(Boolean).join(', ');
  new Logger('Bootstrap').log(
    `Balam escuchando en el puerto ${config.port} · agentes: ${providers} · estrategia: ${config.strategy}`,
  );
}

bootstrap();
