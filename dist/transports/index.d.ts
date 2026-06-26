import type { Logger } from 'homebridge';
import type { TransportConfig } from '../types';
import type { AmaranTransport } from './transport';
export declare function createTransport(config: TransportConfig | undefined, log: Logger): AmaranTransport;
