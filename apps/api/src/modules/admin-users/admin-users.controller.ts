import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { AdminSessionGuard } from '../auth/admin-session.guard';
import { AdminUsersService } from './admin-users.service';
import { CreateAdminUserDto, UpdateAdminUserDto, SetPasswordDto } from './dto/admin-user.dto';

@Controller('admin-users')
@UseGuards(AdminSessionGuard)
export class AdminUsersController {
  constructor(private readonly svc: AdminUsersService) {}

  @Get()
  findAll() {
    return this.svc.findAll();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateAdminUserDto) {
    return this.svc.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAdminUserDto) {
    return this.svc.update(id, dto);
  }

  @Post(':id/set-password')
  @HttpCode(HttpStatus.OK)
  setPassword(@Param('id') id: string, @Body() dto: SetPasswordDto) {
    return this.svc.setPassword(id, dto.password);
  }
}
