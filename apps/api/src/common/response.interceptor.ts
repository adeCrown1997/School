import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiSuccess } from './api-response';

/**
 * Wraps every successful controller return value in the { ok: true, data }
 * envelope — UNLESS the controller already returned an object carrying an `ok`
 * flag (e.g. paginated responses that set their own meta). This keeps
 * controllers terse while guaranteeing a uniform contract.
 */
@Injectable()
export class ResponseEnvelopeInterceptor<T> implements NestInterceptor<T, ApiSuccess<T> | T> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<ApiSuccess<T> | T> {
    return next.handle().pipe(
      map((payload) => {
        if (
          payload !== null &&
          typeof payload === 'object' &&
          'ok' in (payload as Record<string, unknown>)
        ) {
          return payload;
        }
        return { ok: true, data: payload } as ApiSuccess<T>;
      }),
    );
  }
}
