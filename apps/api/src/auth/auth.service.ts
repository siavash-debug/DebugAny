import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { hashPassword, verifyPassword } from "./password";
import { SESSION_TTL_MS, generateSessionToken, sha256 } from "./tokens";
import type { LoginDto, RegisterDto } from "./dto/auth.dto";

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async register(dto: RegisterDto): Promise<{ token: string; user: AuthenticatedUser }> {
    const passwordHash = await hashPassword(dto.password);
    let user;
    try {
      user = await this.prisma.user.create({
        data: { email: dto.email.toLowerCase(), name: dto.name, passwordHash },
        select: { id: true, email: true, name: true }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("An account with this email already exists.");
      }
      throw error;
    }
    return { token: await this.createSession(user.id), user };
  }

  async login(dto: LoginDto): Promise<{ token: string; user: AuthenticatedUser }> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      select: { id: true, email: true, name: true, passwordHash: true }
    });
    // Same error and comparable timing whether or not the account exists.
    const passwordHash = user?.passwordHash ?? (await hashPassword("timing-equalizer"));
    const valid = await verifyPassword(passwordHash, dto.password);
    if (!user || !valid) {
      throw new UnauthorizedException("Invalid email or password.");
    }
    return {
      token: await this.createSession(user.id),
      user: { id: user.id, email: user.email, name: user.name }
    };
  }

  private async createSession(userId: string): Promise<string> {
    const token = generateSessionToken();
    await this.prisma.session.create({
      data: { tokenHash: sha256(token), userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) }
    });
    return token;
  }

  async resolveSession(token: string | undefined): Promise<AuthenticatedUser | null> {
    if (!token || token.length > 512) return null;
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
      select: { expiresAt: true, user: { select: { id: true, email: true, name: true } } }
    });
    if (!session || session.expiresAt.getTime() < Date.now()) return null;
    return session.user;
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
  }
}
