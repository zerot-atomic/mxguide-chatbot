import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppConfig } from '../config/env';
import { SafeExceptionFilter } from './safe-exception.filter';
export function configureHttp(app: NestExpressApplication, config: AppConfig): void {
  app.set('trust proxy', 1);
  app.use(helmet());
  app.useBodyParser('json', { limit: '64kb' });
  app.enableCors({ origin: config.corsOrigins.length ? config.corsOrigins : true });
  app.useGlobalPipes(new ValidationPipe({ whitelist:true,forbidNonWhitelisted:true,transform:true }));
  app.useGlobalFilters(new SafeExceptionFilter());
}
