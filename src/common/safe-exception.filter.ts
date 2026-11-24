import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';

/** Códigos estables de error para clientes (Flutter decide con code/retryable, nunca con message). */
export type ErrorCode = 'invalid_request' | 'unauthorized' | 'not_found' | 'payload_too_large' | 'rate_limited' | 'unavailable' | 'internal';

const ERRORS: Record<number, { code: ErrorCode; message: string; retryable: boolean }> = {
  400: { code: 'invalid_request', message: 'Solicitud inválida.', retryable: false },
  401: { code: 'unauthorized', message: 'API key inválida', retryable: false },
  404: { code: 'not_found', message: 'Recurso no encontrado.', retryable: false },
  413: { code: 'payload_too_large', message: 'La solicitud supera el tamaño permitido.', retryable: false },
  429: { code: 'rate_limited', message: 'Demasiadas solicitudes. Intenta de nuevo en un momento.', retryable: true },
  503: { code: 'unavailable', message: 'El asistente no está disponible en este momento.', retryable: true },
};
const INTERNAL = { code: 'internal' as ErrorCode, message: 'No se pudo procesar la solicitud.', retryable: true };

/**
 * Errores públicos: { statusCode, message, error: { code, message, retryable } }.
 * statusCode y message se conservan por compatibilidad con clientes v1.
 * Nunca incluye detalles internos, cuerpos de proveedores ni validaciones campo por campo.
 */
@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const type = error && typeof error === 'object' ? (error as { type?: string }).type : undefined;
    const status = error instanceof HttpException ? error.getStatus() : type === 'entity.too.large' ? 413 : type === 'entity.parse.failed' ? 400 : 500;
    const known = ERRORS[status] ?? (status >= 400 && status < 500 ? { ...ERRORS[400] } : INTERNAL);
    host.switchToHttp().getResponse().status(status).json({ statusCode: status, message: known.message, error: { ...known } });
  }
}
