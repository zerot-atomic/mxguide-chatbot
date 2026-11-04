import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { APP_CONFIG, AppConfig } from '../config/env';

/**
 * Si CHAT_API_KEY está configurada, exige el header `x-api-key` con ese valor.
 * Ojo: una llave dentro de la app se puede extraer; esto frena el abuso casual,
 * el límite de peticiones por IP hace el resto.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.chatApiKey;
    if (!expected) return true;

    const received = context.switchToHttp().getRequest<Request>().header('x-api-key') ?? '';
    const a = Buffer.from(received);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('API key inválida');
    }
    return true;
  }
}
