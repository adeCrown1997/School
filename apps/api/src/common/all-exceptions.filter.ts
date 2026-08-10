import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { ApiErrorBody } from './api-response';

/**
 * Translates every thrown error into the canonical error envelope. Guarantees:
 *  - no stack traces or DB internals leak to clients;
 *  - known Prisma errors map to sensible HTTP codes + safe messages;
 *  - the DB identity-guard / append-only triggers surface as 403, not 500.
 * Full detail is logged server-side with a requestId for correlation.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const requestId = (req.id as string) || (req.headers['x-request-id'] as string) || undefined;

    const { status, code, message, details } = this.normalize(exception);

    if (status >= 500) {
      this.logger.error(
        `[${requestId ?? '-'}] ${req.method} ${req.url} → ${status} ${code}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(
        `[${requestId ?? '-'}] ${req.method} ${req.url} → ${status} ${code}: ${message}`,
      );
    }

    const body: ApiErrorBody = {
      ok: false,
      error: { code, message, ...(details ? { details } : {}), requestId },
    };
    res.status(status).json(body);
  }

  private normalize(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details?: unknown;
  } {
    // Nest/HTTP exceptions — respect their status; normalize the body.
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const resp = exception.getResponse();
      let message = exception.message;
      let details: unknown;
      let code = this.codeForStatus(status);
      if (typeof resp === 'object' && resp !== null) {
        const r = resp as Record<string, unknown>;
        if (typeof r.message === 'string') message = r.message;
        else if (Array.isArray(r.message)) {
          message = 'Validation failed';
          details = r.message;
        }
        if (typeof r.code === 'string') code = r.code;
        if (r.details) details = r.details;
      }
      return { status, code, message, details };
    }

    // Known Prisma errors — map without exposing SQL.
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.mapPrisma(exception);
    }

    // Errors raised by our DB triggers arrive as raw messages containing INV-3
    // etc. Detect and surface as 403 without echoing SQL.
    if (exception instanceof Error && /INV-3|append-only/i.test(exception.message)) {
      return {
        status: HttpStatus.FORBIDDEN,
        code: 'IDENTITY_PROTECTED',
        message:
          'This operation is blocked: protected data can only change through an approved workflow.',
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
    };
  }

  private mapPrisma(e: Prisma.PrismaClientKnownRequestError): {
    status: number;
    code: string;
    message: string;
    details?: unknown;
  } {
    switch (e.code) {
      case 'P2002': // unique constraint
        return {
          status: HttpStatus.CONFLICT,
          code: 'DUPLICATE',
          message: 'A record with the same unique value already exists.',
          details: { target: (e.meta as { target?: unknown } | undefined)?.target },
        };
      case 'P2003': // FK constraint
        return {
          status: HttpStatus.BAD_REQUEST,
          code: 'INVALID_REFERENCE',
          message: 'A referenced record does not exist.',
        };
      case 'P2025': // record not found
        return {
          status: HttpStatus.NOT_FOUND,
          code: 'NOT_FOUND',
          message: 'The requested record was not found.',
        };
      default:
        return {
          status: HttpStatus.BAD_REQUEST,
          code: 'DB_ERROR',
          message: 'The database rejected this request.',
        };
    }
  }

  private codeForStatus(status: number): string {
    const map: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHENTICATED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE',
      429: 'RATE_LIMITED',
    };
    return map[status] ?? 'ERROR';
  }
}
