import type { LightCommand, LightState } from '../types';

import type { AmaranTransport } from './transport';

export class MockTransport implements AmaranTransport {
  private readonly states = new Map<string, Required<LightState>>();

  async getState(id: string): Promise<LightState> {
    return this.getOrCreateState(id);
  }

  async setState(id: string, command: LightCommand): Promise<LightState> {
    const current = this.getOrCreateState(id);
    const next = {
      ...current,
      ...command,
    };

    this.states.set(id, next);
    return next;
  }

  private getOrCreateState(id: string): Required<LightState> {
    const existing = this.states.get(id);

    if (existing) {
      return existing;
    }

    const initial = {
      on: false,
      brightness: 100,
      colorTemperatureKelvin: 5600,
      hue: 0,
      saturation: 0,
    };

    this.states.set(id, initial);
    return initial;
  }
}
