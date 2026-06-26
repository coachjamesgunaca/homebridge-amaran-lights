import type { LightCommand, LightState } from '../types';
import type { AmaranTransport } from './transport';
export declare class MockTransport implements AmaranTransport {
    private readonly states;
    getState(id: string): Promise<LightState>;
    setState(id: string, command: LightCommand): Promise<LightState>;
    private getOrCreateState;
}
