import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  UnauthorizedException
} from "@nestjs/common";
import type { Request, Response } from "express";
import { CORRELATION_ID_HEADER } from "./correlation-id.middleware";

/**
 * Emits one structured JSON line per failed request (correlation id, method,
 * route, status) without ever logging the request body or auth headers, and
 * returns a consistent error envelope.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    // Body-parser and other middleware errors are not Nest HttpExceptions but
    // still carry a meaningful HTTP status (e.g. 413 entity.too.large).
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : middlewareStatus(exception) ?? HttpStatus.INTERNAL_SERVER_ERROR;

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      const stack = exception instanceof Error ? exception.stack : undefined;
      this.logger.error(
        {
          correlationId: request.correlationId,
          method: request.method,
          url: request.url,
          status,
          message: exception instanceof Error ? exception.message : String(exception)
        },
        stack
      );
    }

    const body = {
      statusCode: status,
      error: HttpStatus[status]?.replace(/_/g, " ") ?? "Error",
      message: extractMessage(exception),
      correlationId: request.correlationId,
      timestamp: new Date().toISOString()
    };

    response.status(status).json(body);
  }
}

function middlewareStatus(exception: unknown): number | undefined {
  if (typeof exception !== "object" || exception === null) return undefined;
  const candidate = (exception as { status?: unknown; statusCode?: unknown }).status
    ?? (exception as { statusCode?: unknown }).statusCode;
  return typeof candidate === "number" && candidate >= 400 && candidate < 600 ? candidate : undefined;
}

function extractMessage(exception: unknown): string {
  if (exception instanceof UnauthorizedException) {
    return exception.message;
  }
  if (exception instanceof HttpException) {
    const payload = exception.getResponse();
    if (typeof payload === "string") {
      return payload;
    }
    if (typeof payload === "object" && payload !== null && "message" in payload) {
      const messages = (payload as { message: string | string[] }).message;
      return Array.isArray(messages) ? messages.join("; ") : messages;
    }
    return exception.message;
  }
  const status = middlewareStatus(exception);
  // Middleware errors below 500 carry client-facing messages (e.g. "request
  // entity too large"); anything else must not leak internals.
  if (status !== undefined && status < 500 && exception instanceof Error) {
    return exception.message;
  }
  return "An unexpected error occurred.";
}
