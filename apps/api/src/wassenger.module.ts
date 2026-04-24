import { Module, Global } from '@nestjs/common';
import { WassengerController } from './wassenger.controller';
import { WassengerService } from './wassenger.service';

// Global so any module can inject WassengerService without having to
// import a module explicitly — the service is a stateful singleton that
// holds the Wassenger HTTP client + recent-message dedup cache.
@Global()
@Module({
  controllers: [WassengerController],
  providers: [WassengerService],
  exports: [WassengerService],
})
export class WassengerModule {}
