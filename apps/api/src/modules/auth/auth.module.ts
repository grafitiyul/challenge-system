import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AdminSessionGuard } from './admin-session.guard';
import { EmailService } from './email.service';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, AdminSessionGuard, EmailService],
  exports: [AuthService, AdminSessionGuard],
})
export class AuthModule {}
