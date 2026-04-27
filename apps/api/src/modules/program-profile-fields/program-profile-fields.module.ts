import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProgramProfileFieldsController } from './program-profile-fields.controller';
import { ProgramProfileFieldsService } from './program-profile-fields.service';

// AuthModule provides AdminSessionGuard which is consumed by the
// controller. Sibling admin modules pull it in the same way.
@Module({
  imports: [AuthModule],
  controllers: [ProgramProfileFieldsController],
  providers: [ProgramProfileFieldsService],
})
export class ProgramProfileFieldsModule {}
