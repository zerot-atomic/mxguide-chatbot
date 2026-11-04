import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const type = error && typeof error === 'object' ? (error as {type?:string}).type : undefined;
    const status = error instanceof HttpException ? error.getStatus() : type === 'entity.too.large' ? 413 : type === 'entity.parse.failed' ? 400 : 500;
    const messages: Record<number, string> = {400:'Solicitud inválida.',401:'API key inválida',413:'La solicitud supera el tamaño permitido.',429:'Demasiadas solicitudes. Intenta de nuevo en un momento.',503:'El asistente no está disponible en este momento.'};
    host.switchToHttp().getResponse().status(status).json({statusCode:status,message:messages[status] ?? 'No se pudo procesar la solicitud.'});
  }
}
