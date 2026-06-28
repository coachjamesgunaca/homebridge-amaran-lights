"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpControlServer = void 0;
const http = __importStar(require("node:http"));
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
class HttpControlServer {
    config;
    lights;
    log;
    server;
    constructor(config, lights, log) {
        this.config = config;
        this.lights = lights;
        this.log = log;
    }
    start() {
        const port = this.config.port ?? DEFAULT_PORT;
        const host = this.config.host ?? DEFAULT_HOST;
        this.server = http.createServer((req, res) => {
            void this.handle(req, res);
        });
        this.server.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                this.log.error('amaran HTTP control server port %s is already in use — set http.port to a free port.', port);
            }
            else {
                this.log.error('amaran HTTP control server error: %s', error.message);
            }
        });
        this.server.listen(port, host, () => {
            const shown = host === '0.0.0.0' ? 'localhost' : host;
            this.log.info('amaran HTTP control server → http://%s:%s (Stream Deck ↔ HomeKit sync)', shown, port);
        });
    }
    stop() {
        this.server?.close();
        this.server = undefined;
    }
    async handle(req, res) {
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
        }
        catch (error) {
            this.json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
    }
    async runAll(command) {
        const results = [];
        for (const light of this.lights.values()) {
            results.push(await light.applyExternalCommand(command));
        }
        return results;
    }
    readBody(req) {
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
                    resolve(JSON.parse(raw));
                }
                catch {
                    reject(new Error('Invalid JSON body'));
                }
            });
            req.on('error', reject);
        });
    }
    json(res, status, body) {
        res.writeHead(status, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        });
        res.end(JSON.stringify(body));
    }
}
exports.HttpControlServer = HttpControlServer;
function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
}
/** Translate a daemon-style command + body into a Homebridge LightCommand. */
function toCommand(cmd, body) {
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
