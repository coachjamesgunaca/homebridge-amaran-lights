import type { Logger } from 'homebridge';
import type { HttpTransportConfig, LightCommand, LightState } from '../types';
import type { AmaranTransport } from './transport';
export declare class HttpTransport implements AmaranTransport {
    private readonly log;
    private readonly baseUrl;
    private readonly token?;
    private readonly timeoutMs;
    private readonly stateCache;
    constructor(config: HttpTransportConfig, log: Logger);
    getState(id: string): Promise<LightState>;
    setState(id: string, command: LightCommand): Promise<LightState>;
    private request;
}
