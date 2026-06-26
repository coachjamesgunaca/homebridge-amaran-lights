import type { LightCommand, LightState } from '../types';

export interface AmaranTransport {
  getState(id: string): Promise<LightState>;
  setState(id: string, command: LightCommand): Promise<LightState>;
}
