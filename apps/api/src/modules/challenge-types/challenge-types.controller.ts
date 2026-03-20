import { Controller, Get, Post, Body } from '@nestjs/common';
import { ChallengeTypesService } from './challenge-types.service';
import { CreateChallengeTypeDto } from './dto/create-challenge-type.dto';

@Controller('challenge-types')
export class ChallengeTypesController {
  constructor(private readonly challengeTypesService: ChallengeTypesService) {}

  @Get()
  findAll() {
    return this.challengeTypesService.findAll();
  }

  @Post()
  create(@Body() dto: CreateChallengeTypeDto) {
    return this.challengeTypesService.create(dto);
  }
}
