import type { Logger } from 'homebridge';

import type { HttpTransportConfig, LightCommand, LightState } from '../types';

import type { AmaranTransport } from './transport';

export class HttpTransport implements AmaranTransport {
  private readonly baseUrl: URL;
  private readonly token?: string;
  private readonly timeoutMs: number;

  constructor(
    config: HttpTransportConfig,
    private readonly log: Logger,
  ) {
    this.baseUrl = new URL(config.baseUrl);
    this.token = config.token;
    this.timeoutMs = config.timeoutMs ?? 5000;
  }

  async getState(id: string): Promise<LightState> {
    return this.request('GET', id);
  }

  async setState(id: string, command: LightCommand): Promise<LightState> {
    return this.request('POST', id, command);
  }

  private async request(method: 'GET' | 'POST', id: string, body?: LightCommand): Promise<LightState> {
    const url = new URL(`lights/${encodeURIComponent(id)}`, ensureTrailingSlash(this.baseUrl));
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    let response: Response;

    try {
      response = await fetch(url, {
        body: body ? JSON.stringify(body) : undefined,
        headers,
        method,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      this.log.debug('HTTP transport request failed for %s: %s', id, error instanceof Error ? error.message : String(error));
      throw error;
    }

    if (!response.ok) {
      throw new Error(`amaran bridge responded ${response.status} ${response.statusText}`);
    }

    return await response.json() as LightState;
  }
}

function ensureTrailingSlash(url: URL): URL {
  const next = new URL(url);

  if (!next.pathname.endsWith('/')) {
    next.pathname = `${next.pathname}/`;
  }

  return next;
}
