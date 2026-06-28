import type { Logger } from 'homebridge';
import type { AmaranLightAccessory } from './platformAccessory';
import type { HttpControlServerConfig } from './types';
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
export declare class HttpControlServer {
    private readonly config;
    private readonly lights;
    private readonly log;
    private server?;
    constructor(config: HttpControlServerConfig, lights: Map<string, AmaranLightAccessory>, log: Logger);
    start(): void;
    stop(): void;
    private handle;
    private runAll;
    private readBody;
    private json;
}
