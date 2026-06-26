import type { Logger } from 'homebridge';

import type { TransportConfig } from '../types';

import { DesktopApiTransport } from './desktopApiTransport';
import { HttpTransport } from './httpTransport';
import { MockTransport } from './mockTransport';
import type { AmaranTransport } from './transport';

export function createTransport(config: TransportConfig | undefined, log: Logger): AmaranTransport {
  if (!config || config.type === 'mock') {
    log.warn('Using mock transport. HomeKit state will update, but no physical amaran light will be controlled.');
    return new MockTransport();
  }

  if (config.type === 'http') {
    return new HttpTransport(config, log);
  }

  if (config.type === 'amaran-desktop') {
    return new DesktopApiTransport(config, log);
  }

  const unreachable: never = config;
  throw new Error(`Unsupported transport config: ${JSON.stringify(unreachable)}`);
}
