"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DesktopApiTransport = void 0;
const node_crypto_1 = require("node:crypto");
const ws_1 = __importDefault(require("ws"));
const DEFAULT_WEB_SOCKET_URL = 'ws://127.0.0.1:12345';
const DEFAULT_API_SECRET_KEY_ENV = 'AMARAN_API_SECRET_KEY';
const DEFAULT_CLIENT_ID = 1;
const DEFAULT_REQUEST_TIMEOUT_MS = 5000;
const DEFAULT_DEBOUNCE_MS = 220;
const DEFAULT_DIAGNOSTICS = true;
class DesktopApiTransport {
    log;
    apiSecretKey;
    clientId;
    debug;
    debounceMs;
    diagnostics;
    pendingRequests = new Map();
    requestTimeoutMs;
    stateCache = new Map();
    updateQueue = new Map();
    webSocketUrl;
    connecting;
    diagnosticsStarted = false;
    requestId = 1;
    socket;
    constructor(config, log) {
        this.log = log;
        this.webSocketUrl = config.webSocketUrl ?? DEFAULT_WEB_SOCKET_URL;
        this.apiSecretKey = resolveApiSecretKey(config, this.log);
        this.clientId = config.clientId ?? DEFAULT_CLIENT_ID;
        this.requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
        this.debounceMs = config.debounceMs ?? DEFAULT_DEBOUNCE_MS;
        this.debug = config.debug ?? false;
        this.diagnostics = config.diagnostics ?? DEFAULT_DIAGNOSTICS;
        this.log.info('amaran Desktop API transport configured for %s with client_id=%s, timeout=%sms, diagnostics=%s, debug=%s.', this.webSocketUrl, this.clientId, this.requestTimeoutMs, this.diagnostics, this.debug);
        this.startDiagnostics();
    }
    async getState(id) {
        this.debugLog('amaran Desktop API reading state for node_id=%s.', id);
        const [sleep, intensity, cct, hsi] = await Promise.allSettled([
            this.sendRequest('get_sleep', id),
            this.sendRequest('get_intensity', id),
            this.sendRequest('get_cct', id),
            this.sendRequest('get_hsi', id),
        ]);
        const state = {
            ...readSettledState(sleep, normalizeSleepState),
            ...readSettledState(intensity, normalizeIntensityState),
            ...readSettledState(cct, normalizeCctState),
        };
        if (hsi.status === 'fulfilled') {
            Object.assign(state, normalizeHsiState(hsi.value));
        }
        else {
            this.log.debug('amaran Desktop API get_hsi failed for %s: %s', id, formatError(hsi.reason));
        }
        if (Object.keys(state).length === 0) {
            const firstFailure = [sleep, intensity, cct, hsi].find((result) => result.status === 'rejected');
            throw new Error(`amaran Desktop API state read failed for ${id}: ${firstFailure ? formatError(firstFailure.reason) : 'empty response'}`);
        }
        return this.mergeState(id, state);
    }
    async setState(id, command) {
        return await new Promise((resolve, reject) => {
            const existing = this.updateQueue.get(id);
            if (existing) {
                existing.command = {
                    ...existing.command,
                    ...command,
                };
                existing.resolvers.push({ reject, resolve });
                clearTimeout(existing.timer);
                existing.timer = setTimeout(() => {
                    void this.flushQueuedCommand(id);
                }, this.debounceMs);
                return;
            }
            const queued = {
                command: { ...command },
                resolvers: [{ reject, resolve }],
                timer: setTimeout(() => {
                    void this.flushQueuedCommand(id);
                }, this.debounceMs),
            };
            this.updateQueue.set(id, queued);
        });
    }
    async flushQueuedCommand(id) {
        const queued = this.updateQueue.get(id);
        if (!queued) {
            return;
        }
        this.updateQueue.delete(id);
        try {
            const state = await this.applyState(id, queued.command);
            for (const resolver of queued.resolvers) {
                resolver.resolve(state);
            }
        }
        catch (error) {
            const normalizedError = error instanceof Error ? error : new Error(String(error));
            for (const resolver of queued.resolvers) {
                resolver.reject(normalizedError);
            }
        }
    }
    async applyState(id, command) {
        const cached = this.stateCache.get(id) ?? {};
        const state = {};
        if (command.on === true) {
            await this.sendRequest('set_sleep', id, { sleep: false });
            state.on = true;
        }
        if (command.hue !== undefined || command.saturation !== undefined) {
            const hue = command.hue ?? cached.hue ?? 0;
            const saturation = command.saturation ?? cached.saturation ?? 0;
            const brightness = command.brightness ?? cached.brightness ?? 100;
            const response = await this.sendRequest('set_hsi', id, {
                hue: Math.round(clamp(hue, 0, 360)),
                intensity: brightnessToIntensity(brightness),
                sat: Math.round(clamp(saturation, 0, 100)),
            });
            Object.assign(state, normalizeHsiState(response));
        }
        else if (command.colorTemperatureKelvin !== undefined) {
            const args = {
                cct: Math.round(command.colorTemperatureKelvin),
            };
            if (command.brightness !== undefined) {
                args.intensity = brightnessToIntensity(command.brightness);
            }
            const response = await this.sendRequest('set_cct', id, args);
            Object.assign(state, normalizeCctState(response));
        }
        else if (command.brightness !== undefined) {
            const response = await this.sendRequest('set_intensity', id, {
                intensity: brightnessToIntensity(command.brightness),
            });
            Object.assign(state, normalizeIntensityState(response));
        }
        if (command.on === false) {
            await this.sendRequest('set_sleep', id, { sleep: true });
            state.on = false;
        }
        return this.mergeState(id, {
            ...command,
            ...state,
        });
    }
    async sendRequest(action, nodeId, args) {
        const socket = await this.getSocket();
        const requestId = this.nextRequestId();
        const payload = {
            action,
            client_id: this.clientId,
            request_id: requestId,
            token: this.createToken(),
            type: 'request',
            version: 2,
        };
        if (nodeId) {
            payload.node_id = nodeId;
        }
        if (args) {
            payload.args = args;
        }
        this.debugLog('amaran Desktop API send request_id=%s action=%s node_id=%s args=%s socket=%s.', requestId, action, nodeId ?? '(none)', compactJson(args ?? {}), describeReadyState(socket.readyState));
        return await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                const message = `amaran Desktop API ${action} timed out after ${this.requestTimeoutMs}ms`
                    + ` (request_id=${requestId}, node_id=${nodeId ?? '(none)'}, socket=${describeReadyState(socket.readyState)}, pending=${this.describePendingRequests()})`;
                this.log.warn(message);
                reject(new Error(message));
            }, this.requestTimeoutMs);
            this.pendingRequests.set(requestId, {
                action,
                nodeId,
                reject,
                resolve,
                timeout,
            });
            const rejectSend = (error) => {
                clearTimeout(timeout);
                this.pendingRequests.delete(requestId);
                reject(error);
            };
            try {
                socket.send(JSON.stringify(payload), (error) => {
                    if (!error) {
                        return;
                    }
                    rejectSend(error);
                });
            }
            catch (error) {
                rejectSend(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }
    async getSocket() {
        if (this.socket?.readyState === ws_1.default.OPEN) {
            return this.socket;
        }
        if (this.connecting) {
            return await this.connecting;
        }
        this.connecting = this.openSocket();
        try {
            return await this.connecting;
        }
        finally {
            this.connecting = undefined;
        }
    }
    async openSocket() {
        return await new Promise((resolve, reject) => {
            this.log.info('Connecting to amaran Desktop API WebSocket at %s.', this.webSocketUrl);
            const socket = new ws_1.default(this.webSocketUrl);
            let timeout;
            const cleanup = () => {
                clearTimeout(timeout);
                socket.off('error', onOpenError);
                socket.off('open', onOpen);
            };
            const onOpen = () => {
                cleanup();
                this.socket = socket;
                socket.on('close', (code, reason) => this.handleClose(socket, code, reason));
                socket.on('error', (error) => this.log.warn('amaran Desktop API WebSocket error: %s', formatError(error)));
                socket.on('message', (data) => this.handleMessage(data));
                this.log.info('Connected to amaran Desktop API WebSocket at %s.', this.webSocketUrl);
                this.startDiagnostics();
                resolve(socket);
            };
            const onOpenError = (error) => {
                cleanup();
                reject(error);
            };
            socket.once('error', onOpenError);
            socket.once('open', onOpen);
            timeout = setTimeout(() => {
                cleanup();
                socket.terminate();
                reject(new Error(`amaran Desktop API WebSocket connection timed out after ${this.requestTimeoutMs}ms`));
            }, this.requestTimeoutMs);
        });
    }
    handleClose(socket, code, reason) {
        if (this.socket === socket) {
            this.socket = undefined;
        }
        const message = reason.length > 0 ? reason.toString('utf8') : `code ${code}`;
        this.log.warn('amaran Desktop API WebSocket closed: %s.', message);
        this.rejectPendingRequests(new Error(`amaran Desktop API WebSocket closed: ${message}`));
    }
    handleMessage(data) {
        const raw = rawDataToString(data);
        this.debugLog('amaran Desktop API received message: %s', redactToken(raw));
        let message;
        try {
            message = JSON.parse(raw);
        }
        catch (error) {
            this.log.debug('Ignoring non-JSON amaran Desktop API message: %s', formatError(error));
            return;
        }
        if (!isObject(message) || typeof message.type !== 'string') {
            this.log.debug('Ignoring malformed amaran Desktop API message: %j', message);
            return;
        }
        if (message.type === 'response') {
            this.handleResponse(message);
            return;
        }
        if (message.type === 'event') {
            this.handleEvent(message);
        }
    }
    handleResponse(response) {
        if (typeof response.request_id !== 'number') {
            this.log.debug('Ignoring amaran Desktop API response without request_id: %j', response);
            return;
        }
        const pending = this.pendingRequests.get(response.request_id);
        if (!pending) {
            this.log.debug('Ignoring unmatched amaran Desktop API response: %j', response);
            return;
        }
        this.pendingRequests.delete(response.request_id);
        clearTimeout(pending.timeout);
        const code = typeof response.code === 'number' ? response.code : 0;
        this.debugLog('amaran Desktop API response request_id=%s action=%s code=%s message=%s data=%s.', response.request_id, pending.action, code, readMessage(response.message), compactJson(response.data));
        if (code !== 0) {
            pending.reject(new Error(`amaran Desktop API ${pending.action} failed with code ${code}: ${readMessage(response.message)}`));
            return;
        }
        pending.resolve(response.data);
    }
    handleEvent(event) {
        if (typeof event.event !== 'string' || typeof event.node_id !== 'string') {
            return;
        }
        const state = normalizeEventState(event.event, event.data);
        if (Object.keys(state).length > 0) {
            this.debugLog('amaran Desktop API event=%s node_id=%s data=%s normalized=%s.', event.event, event.node_id, compactJson(event.data), compactJson(state));
            this.mergeState(event.node_id, state);
        }
    }
    startDiagnostics() {
        if (!this.diagnostics || this.diagnosticsStarted) {
            return;
        }
        this.diagnosticsStarted = true;
        setTimeout(() => {
            void this.runDiagnostics();
        }, 250);
    }
    async runDiagnostics() {
        for (const action of ['get_fixture_list', 'get_device_list']) {
            try {
                const data = await this.sendRequest(action);
                this.log.info('amaran Desktop API diagnostic %s returned: %s', action, compactJson(data, 2000));
            }
            catch (error) {
                this.log.warn('amaran Desktop API diagnostic %s failed: %s', action, formatError(error));
            }
        }
    }
    rejectPendingRequests(error) {
        for (const pending of this.pendingRequests.values()) {
            clearTimeout(pending.timeout);
            pending.reject(error);
        }
        this.pendingRequests.clear();
    }
    createToken() {
        if (!this.apiSecretKey) {
            throw new Error(`amaran Desktop API secret key is not configured. Set apiSecretKey or ${DEFAULT_API_SECRET_KEY_ENV}.`);
        }
        const key = Buffer.from(this.apiSecretKey, 'base64');
        if (key.length !== 32) {
            throw new Error('amaran Desktop API secret key must be a base64-encoded 32-byte AES-256 key.');
        }
        const iv = (0, node_crypto_1.randomBytes)(12);
        const cipher = (0, node_crypto_1.createCipheriv)('aes-256-gcm', key, iv);
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const encrypted = Buffer.concat([cipher.update(timestamp, 'utf8'), cipher.final()]);
        const authTag = cipher.getAuthTag();
        return Buffer.concat([iv, authTag, encrypted]).toString('base64');
    }
    nextRequestId() {
        const requestId = this.requestId;
        this.requestId = this.requestId >= Number.MAX_SAFE_INTEGER ? 1 : this.requestId + 1;
        return requestId;
    }
    mergeState(id, state) {
        const nextState = removeUndefined({
            ...this.stateCache.get(id),
            ...state,
        });
        this.stateCache.set(id, nextState);
        return nextState;
    }
    describePendingRequests() {
        if (this.pendingRequests.size === 0) {
            return 'none';
        }
        return [...this.pendingRequests.entries()]
            .map(([requestId, pending]) => `${requestId}:${pending.action}:${pending.nodeId ?? '(none)'}`)
            .join(',');
    }
    debugLog(message, ...parameters) {
        if (this.debug) {
            this.log.info(message, ...parameters);
            return;
        }
        this.log.debug(message, ...parameters);
    }
}
exports.DesktopApiTransport = DesktopApiTransport;
function resolveApiSecretKey(config, log) {
    if (config.apiSecretKey) {
        return config.apiSecretKey;
    }
    const envName = config.apiSecretKeyEnv ?? DEFAULT_API_SECRET_KEY_ENV;
    const value = process.env[envName];
    if (!value) {
        log.warn('amaran Desktop API secret key environment variable %s is not set.', envName);
        return undefined;
    }
    return value;
}
function normalizeEventState(event, data) {
    switch (event) {
        case 'sleep_changed':
            return normalizeSleepState(data);
        case 'intensity_changed':
            return normalizeIntensityState(data);
        case 'cct_changed':
            return normalizeCctState(data);
        case 'hsi_changed':
            return normalizeHsiState(data);
        default:
            return {};
    }
}
function normalizeSleepState(payload) {
    const sleep = readBoolean(payload, ['sleep']);
    return sleep === undefined ? {} : { on: !sleep };
}
function normalizeIntensityState(payload) {
    const intensity = readNumber(payload, ['intensity']);
    return intensity === undefined ? {} : { brightness: intensityToBrightness(intensity) };
}
function normalizeCctState(payload) {
    const cct = readNumber(payload, ['cct']);
    const intensity = readNumber(payload, ['intensity']);
    const state = {};
    if (cct !== undefined) {
        state.colorTemperatureKelvin = cct;
    }
    if (intensity !== undefined) {
        state.brightness = intensityToBrightness(intensity);
    }
    return state;
}
function normalizeHsiState(payload) {
    const hue = readNumber(payload, ['hue']);
    const saturation = readNumber(payload, ['sat', 'saturation']);
    const intensity = readNumber(payload, ['intensity']);
    const state = {};
    if (hue !== undefined) {
        state.hue = clamp(hue, 0, 360);
    }
    if (saturation !== undefined) {
        state.saturation = clamp(saturation, 0, 100);
    }
    if (intensity !== undefined) {
        state.brightness = intensityToBrightness(intensity);
    }
    return state;
}
function readSettledState(result, normalize) {
    return result.status === 'fulfilled' ? normalize(result.value) : {};
}
function readBoolean(payload, keys) {
    if (typeof payload === 'boolean') {
        return payload;
    }
    if (typeof payload === 'number') {
        return payload > 0;
    }
    const object = unwrapObject(payload);
    if (!object) {
        return undefined;
    }
    for (const key of keys) {
        const value = object[key];
        if (typeof value === 'boolean') {
            return value;
        }
        if (typeof value === 'number') {
            return value > 0;
        }
    }
    return undefined;
}
function readNumber(payload, keys) {
    if (typeof payload === 'number' && Number.isFinite(payload)) {
        return payload;
    }
    const object = unwrapObject(payload);
    if (!object) {
        return undefined;
    }
    for (const key of keys) {
        const value = object[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
    }
    return undefined;
}
function unwrapObject(payload) {
    if (!isObject(payload)) {
        return undefined;
    }
    for (const key of ['data', 'state', 'light']) {
        const value = payload[key];
        if (isObject(value)) {
            return value;
        }
    }
    return payload;
}
function brightnessToIntensity(brightness) {
    return Math.round(clamp(brightness, 1, 100) * 10);
}
function intensityToBrightness(intensity) {
    return Math.round(clamp(intensity / 10, 1, 100));
}
function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}
function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function rawDataToString(data) {
    if (typeof data === 'string') {
        return data;
    }
    if (Buffer.isBuffer(data)) {
        return data.toString('utf8');
    }
    if (data instanceof ArrayBuffer) {
        return Buffer.from(data).toString('utf8');
    }
    return Buffer.concat(data).toString('utf8');
}
function describeReadyState(readyState) {
    switch (readyState) {
        case ws_1.default.CONNECTING:
            return 'CONNECTING';
        case ws_1.default.OPEN:
            return 'OPEN';
        case ws_1.default.CLOSING:
            return 'CLOSING';
        case ws_1.default.CLOSED:
            return 'CLOSED';
        default:
            return `UNKNOWN(${readyState})`;
    }
}
function compactJson(value, maxLength = 800) {
    const json = JSON.stringify(value);
    const text = json === undefined ? String(value) : json;
    if (text.length <= maxLength) {
        return text;
    }
    return `${text.slice(0, maxLength)}...`;
}
function redactToken(text) {
    return text.replace(/"token"\s*:\s*"[^"]+"/g, '"token":"[redacted]"');
}
function readMessage(message) {
    return typeof message === 'string' && message.length > 0 ? message : 'unknown error';
}
function removeUndefined(state) {
    return Object.fromEntries(Object.entries(state).filter(([, value]) => value !== undefined));
}
function formatError(error) {
    return error instanceof Error ? error.message : String(error);
}
