import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminSessionGuard } from '../auth/admin-session.guard';
import { OffersService } from './offers.service';
import { CreateOfferDto, UpdateOfferDto } from './dto/offer.dto';

@UseGuards(AdminSessionGuard)
@Controller('offers')
export class OffersController {
  constructor(private readonly svc: OffersService) {}

  @Get()
  findAll(@Query('active') active?: string) {
    return this.svc.findAll({ activeOnly: active === 'true' });
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.svc.findById(id);
  }

  @Post()
  create(@Body() dto: CreateOfferDto) {
    return this.svc.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateOfferDto) {
    return this.svc.update(id, dto);
  }

  // Soft delete — marks isActive=false so historical payments remain joinable.
  @Delete(':id')
  @HttpCode(204)
  deactivate(@Param('id') id: string) {
    return this.svc.deactivate(id);
  }
}
