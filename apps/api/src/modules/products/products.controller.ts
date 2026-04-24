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
import { ProductsService } from './products.service';
import {
  AddWaitlistEntryDto,
  CreateCommunicationTemplateDto,
  CreateProductDto,
  UpdateCommunicationTemplateDto,
  UpdateProductDto,
} from './dto/product.dto';

@UseGuards(AdminSessionGuard)
@Controller()
export class ProductsController {
  constructor(private readonly svc: ProductsService) {}

  @Get('products')
  findAll(@Query('active') active?: string) {
    return this.svc.findAll({ activeOnly: active === 'true' });
  }

  @Get('products/:id')
  findById(@Param('id') id: string) {
    return this.svc.findById(id);
  }

  @Post('products')
  create(@Body() dto: CreateProductDto) {
    return this.svc.create(dto);
  }

  @Patch('products/:id')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.svc.update(id, dto);
  }

  // Soft-delete.
  @Delete('products/:id')
  @HttpCode(204)
  deactivate(@Param('id') id: string) {
    return this.svc.deactivate(id);
  }

  // ── Waitlist ────────────────────────────────────────────────────────────

  @Get('products/:id/waitlist')
  listWaitlist(@Param('id') id: string) {
    return this.svc.listWaitlist(id);
  }

  @Post('products/:id/waitlist')
  addWaitlist(@Param('id') id: string, @Body() dto: AddWaitlistEntryDto) {
    return this.svc.addWaitlist(id, dto);
  }

  @Delete('products/:id/waitlist/:participantId')
  @HttpCode(204)
  removeWaitlist(
    @Param('id') id: string,
    @Param('participantId') participantId: string,
  ) {
    return this.svc.removeWaitlist(id, participantId);
  }

  // ── Communication templates ────────────────────────────────────────────

  @Get('products/:id/templates')
  listTemplates(
    @Param('id') id: string,
    @Query('channel') channel?: string,
  ) {
    return this.svc.listTemplates(id, channel);
  }

  @Post('products/:id/templates')
  createTemplate(
    @Param('id') id: string,
    @Body() dto: CreateCommunicationTemplateDto,
  ) {
    return this.svc.createTemplate(id, dto);
  }

  @Patch('communication-templates/:id')
  updateTemplate(
    @Param('id') id: string,
    @Body() dto: UpdateCommunicationTemplateDto,
  ) {
    return this.svc.updateTemplate(id, dto);
  }

  @Delete('communication-templates/:id')
  @HttpCode(204)
  deactivateTemplate(@Param('id') id: string) {
    return this.svc.deactivateTemplate(id);
  }
}
