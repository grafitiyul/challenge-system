import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminSessionGuard } from '../auth/admin-session.guard';
import { GendersService } from './genders.service';

@UseGuards(AdminSessionGuard)
@Controller('genders')
export class GendersController {
  constructor(private readonly gendersService: GendersService) {}

  @Get()
  findAll() {
    return this.gendersService.findAll();
  }
}
