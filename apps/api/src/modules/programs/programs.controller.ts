import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ProgramsService } from './programs.service';
import { CreateProgramDto } from './dto/create-program.dto';
import { UpdateProgramDto } from './dto/update-program.dto';
import { CreateProgramGroupDto } from './dto/create-program-group.dto';
import { ProgramType } from '@prisma/client';

@Controller('programs')
export class ProgramsController {
  constructor(private readonly svc: ProgramsService) {}

  @Get()
  listAll(@Query('type') type?: ProgramType) {
    return this.svc.listAll(type);
  }

  @Post()
  create(@Body() dto: CreateProgramDto) {
    return this.svc.create(dto);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.svc.findById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProgramDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  deactivate(@Param('id') id: string) {
    return this.svc.deactivate(id);
  }

  @Post(':id/groups')
  createGroup(@Param('id') id: string, @Body() dto: CreateProgramGroupDto) {
    return this.svc.createGroup(id, dto);
  }
}
