"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpTransport = void 0;
class HttpTransport {
    log;
    baseUrl;
    token;
    timeoutMs;
    stateCache = {};
    constructor(config, log) {
        this.log = log;
        this.baseUrl = new URL(config.baseUrl);
        this.token = config.token;
        this.timeoutMs = config.timeoutMs ?? 5000;
    }
    async getState(id) {
        return this.stateCache[id] ?? {};
    }
    async setState(id, command) {
        const previous = this.stateCache[id] ?? {};
        const next = { ...previous };
        const endpoint = (action) => `lights/${encodeURIComponent(id)}/${action}`;
        if (command.on !== undefined) {
            await this.request('POST', endpoint(command.on ? 'on' : 'off'));
            next.on = command.on;
        }
        if (command.brightness !== undefined &&
            command.colorTemperatureKelvin === undefined &&
            command.hue === undefined &&
            command.saturation === undefined) {
            await this.request('POST', endpoint('brightness'), {
                value: command.brightness,
            });
            next.brightness = command.brightness;
        }
        if (command.colorTemperatureKelvin !== undefined) {
            const brightness = command.brightness ?? next.brightness ?? 100;
            await this.request('POST', endpoint('cct'), {
                brightness,
                kelvin: command.colorTemperatureKelvin,
                gm: 0,
            });
            next.brightness = brightness;
            next.colorTemperatureKelvin = command.colorTemperatureKelvin;
        }
        if (command.hue !== undefined || command.saturation !== undefined) {
            const brightness = command.brightness ?? next.brightness ?? 100;
            const hue = command.hue ?? next.hue ?? 0;
            const saturation = command.saturation ?? next.saturation ?? 0;
            await this.request('POST', endpoint('hsi'), {
                brightness,
                hue,
                saturation,
            });
            next.brightness = brightness;
            next.hue = hue;
            next.saturation = saturation;
        }
        this.stateCache[id] = next;
        return next;
    }
    async request(method, path, body) {
        const url = new URL(path, ensureTrailingSlash(this.baseUrl));
        const headers = {
            Accept: 'application/json',
        };
        if (body) {
            headers['Content-Type'] = 'application/json';
        }
        if (this.token) {
            headers.Authorization = `Bearer ${this.token}`;
        }
        let response;
        try {
            response = await fetch(url, {
                body: body ? JSON.stringify(body) : undefined,
                headers,
                method,
                signal: AbortSignal.timeout(this.timeoutMs),
            });
        }
        catch (error) {
            this.log.debug('HTTP transport request failed for %s: %s', path, error instanceof Error ? error.message : String(error));
            throw error;
        }
        if (!response.ok) {
            throw new Error(`amaran BLE daemon responded ${response.status} ${response.statusText}`);
        }
        const text = await response.text();
        if (!text) {
            return {};
        }
        return JSON.parse(text);
    }
}
exports.HttpTransport = HttpTransport;
function ensureTrailingSlash(url) {
    const next = new URL(url);
    if (!next.pathname.endsWith('/')) {
        next.pathname = `${next.pathname}/`;
    }
    return next;
}
