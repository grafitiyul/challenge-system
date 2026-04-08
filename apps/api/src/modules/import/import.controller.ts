import { Body, Controller, Post } from '@nestjs/common';
import { ImportService, RunImportDto } from './import.service';

interface DetectBody {
  headers: string[];
  sampleRows: string[][];
}

interface PreviewBody {
  headers: string[];
  rows: string[][];
  mapping: Record<string, number | null>;
}

@Controller('import')
export class ImportController {
  constructor(private readonly importService: ImportService) {}

  @Post('participants/detect')
  detect(@Body() body: DetectBody) {
    return this.importService.detect(body.headers, body.sampleRows ?? []);
  }

  @Post('participants/preview')
  preview(@Body() body: PreviewBody) {
    return this.importService.preview(body.headers, body.rows, body.mapping as any);
  }

  @Post('participants/run')
  run(@Body() body: RunImportDto) {
    return this.importService.run(body);
  }
}
