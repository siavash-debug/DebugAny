import { Injectable, NestMiddleware } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export const CORRELATION_ID_HEADER = "x-request-id";

declare module "express-serve-static-core" {
  interface Request {
    correlationId?: string;
  }
}

/**
 * Assigns every request a correlation id (honoring a reasonable inbound one) and
 * echoes it back so a client-reported failure can be matched to server logs.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const incoming = req.headers[CORRELATION_ID_HEADER];
    const correlationId = typeof incoming === "string" && incoming.length >= 8 && incoming.length <= 128
      ? incoming
      : randomUUID();

    req.correlationId = correlationId;
    res.setHeader(CORRELATION_ID_HEADER, correlationId);
    next();
  }
}
