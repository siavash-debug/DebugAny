import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { AuthService, type AuthenticatedUser } from "./auth.service";

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthenticatedUser;
    sessionToken?: string;
  }
}

export const SESSION_COOKIE = "debugany_session";

/**
 * Authenticates dashboard requests with a bearer session token. Raw tokens
 * are only ever hashed for lookup; they are never logged or stored.
 */
@Injectable()
export class UserGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    const user = await this.auth.resolveSession(token);
    if (!user) {
      throw new UnauthorizedException("A valid session is required.");
    }
    request.user = user;
    request.sessionToken = token;
    return true;
  }
}
