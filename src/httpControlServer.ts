import * as http from 'node:http';

import type { Logger } from 'homebridge';

import type { AmaranLightAccessory } from './platformAccessory';
import type { HttpControlServerConfig, LightCommand } from './types';

const DEFAULT_PORT = 2709;
const DEFAULT_HOST = '127.0.0.1';

/**
 * Small HTTP server that lets external controllers (the Stream Deck plugin)
 * drive the lights *through* Homebridge instead of hitting the amaran daemon
 * directly. Every command is forwarded to the same transport HomeKit uses and
 * then mirrored into HomeKit, so the Home app stays in sync — the way the
 * Neewer setup behaves.
 *
 * The route shape matches the amaran daemon / the Stream Deck client:
 *   GET  /lights
 *   POST /lights/on            POST /lights/off
 *   POST /lights/:id/on        POST /lights/:id/off
 *   POST /lights/:id/brightness   { value }
 *   POST /lights/:id/cct          { brightness, kelvin, gm }
 *   POST /lights/:id/hsi          { brightness, hue, saturation }
 * `:id` is a light id (= daemon key) or "all".
 */
export class HttpControlServer {
  private server?: http.Server;

  constructor(
    private readonly config: HttpControlServerConfig,
    private readonly lights: Map<string, AmaranLightAccessory>,
    private readonly log: Logger,
  ) {}

  start(): void {
    const port = this.config.port ?? DEFAULT_PORT;
    const host = this.config.host ?? DEFAULT_HOST;

    this.server = http.createServer((req, res) => {
      void this.handle(req, res);
    });

    this.server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        this.log.error('amaran HTTP control server port %s is already in use — set http.port to a free port.', port);
      } else {
        this.log.error('amaran HTTP control server error: %s', error.message);
      }
    });

    this.server.listen(port, host, () => {
      const shown = host === '0.0.0.0' ? 'localhost' : host;
      this.log.info('amaran HTTP control server → http://%s:%s (Stream Deck ↔ HomeKit sync)', shown, port);
    });
  }

  stop(): void {
    this.server?.close();
    this.server = undefined;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method === 'OPTIONS') {
      this.json(res, 204, {});
      return;
    }

    if (this.config.token) {
      const auth = req.headers['authorization'] ?? '';
      if (auth !== `Bearer ${this.config.token}`) {
        this.json(res, 401, { ok: false, error: 'Unauthorized' });
        return;
      }
    }

    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    try {
      if (method === 'GET' && (url === '/' || url === '/lights')) {
        const lights = [...this.lights.values()].map((light) => ({
          key: light.id,
          name: light.displayName,
        }));
        this.json(res, 200, { ok: true, lights });
        return;
      }

      const allMatch = url.match(/^\/lights\/(on|off)$/);
      if (method === 'POST' && allMatch) {
        const lights = await this.runAll({ on: allMatch[1] === 'on' });
        this.json(res, 200, { ok: true, lights });
        return;
      }

      const lightMatch = url.match(/^\/lights\/([^/]+)\/([^/]+)$/);
      if (method === 'POST' && lightMatch) {
        const id = decodeURIComponent(lightMatch[1]);
        const cmd = lightMatch[2];
        const body = await this.readBody(req);
        const command = toCommand(cmd, body);

        if (!command) {
          this.json(res, 400, { ok: false, error: `Unknown command: ${cmd}` });
          return;
        }

        if (id === 'all') {
          const lights = await this.runAll(command);
          this.json(res, 200, { ok: true, lights });
          return;
        }

        const light = this.lights.get(id);
        if (!light) {
          const known = [...this.lights.keys()].join(', ');
          this.json(res, 404, { ok: false, error: `Unknown light "${id}". Known: ${known}` });
          return;
        }

        const state = await light.applyExternalCommand(command);
        this.json(res, 200, { ok: true, state });
        return;
      }

      this.json(res, 404, { ok: false, error: `No route for ${method} ${url}` });
    } catch (error) {
      this.json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async runAll(command: LightCommand): Promise<unknown[]> {
    const results: unknown[] = [];
    for (const light of this.lights.values()) {
      results.push(await light.applyExternalCommand(command));
    }
    return results;
  }

  private readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', () => {
        if (!raw) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(raw) as Record<string, unknown>);
        } catch {
          reject(new Error('Invalid JSON body'));
        }
      });
      req.on('error', reject);
    });
  }

  private json(res: http.ServerResponse, status: number, body: object): void {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end(JSON.stringify(body));
  }
}

function num(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Translate a daemon-style command + body into a Homebridge LightCommand. */
function toCommand(cmd: string, body: Record<string, unknown>): LightCommand | undefined {
  switch (cmd) {
    case 'on':
      return { on: true };
    case 'off':
      return { on: false };
    case 'brightness':
      return { brightness: num(body.value) };
    case 'cct':
      return { brightness: num(body.brightness), colorTemperatureKelvin: num(body.kelvin) };
    case 'hsi':
    case 'hsl':
      return { brightness: num(body.brightness), hue: num(body.hue), saturation: num(body.saturation) };
    default:
      return undefined;
  }
}
