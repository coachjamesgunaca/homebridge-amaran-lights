"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpTransport = void 0;
class HttpTransport {
    log;
    baseUrl;
    token;
    timeoutMs;
    constructor(config, log) {
        this.log = log;
        this.baseUrl = new URL(config.baseUrl);
        this.token = config.token;
        this.timeoutMs = config.timeoutMs ?? 5000;
    }
    async getState(id) {
        return this.request('GET', id);
    }
    async setState(id, command) {
        return this.request('POST', id, command);
    }
    async request(method, id, body) {
        const url = new URL(`lights/${encodeURIComponent(id)}`, ensureTrailingSlash(this.baseUrl));
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
            this.log.debug('HTTP transport request failed for %s: %s', id, error instanceof Error ? error.message : String(error));
            throw error;
        }
        if (!response.ok) {
            throw new Error(`amaran bridge responded ${response.status} ${response.statusText}`);
        }
        return await response.json();
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
