import { Module } from '@nestjs/common';
import { StateManager } from './state-manager';

@Module({
  providers: [StateManager],
  exports: [StateManager],
})
export class StateModule {}
