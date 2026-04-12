import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';

@Injectable()
export class AdminSessionGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { admin?: unknown }>();
    const token = (req.cookies as Record<string, string> | undefined)?.['admin_session'];
    if (!token) throw new UnauthorizedException('Not authenticated');

    const admin = await this.authService.validateSession(token);
    if (!admin) throw new UnauthorizedException('Session expired or invalid');

    req.admin = admin;
    return true;
  }
}
