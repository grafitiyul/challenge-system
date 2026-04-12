import { IsEmail, IsString, MinLength, Length } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  password: string;
}

export class RequestCodeDto {
  @IsEmail()
  email: string;
}

export class VerifyCodeDto {
  @IsEmail()
  email: string;

  @IsString()
  @Length(6, 6)
  code: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(1)
  token: string;

  @IsString()
  @MinLength(8)
  password: string;
}
