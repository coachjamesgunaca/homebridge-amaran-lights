import { createCipheriv, randomBytes } from 'node:crypto';

import type { Logger } from 'homebridge';
import WebSocket, { type RawData } from 'ws';

import type { AmaranDesktopTransportConfig, LightCommand, LightState } from '../types';

import type { AmaranTransport } from './transport';

const DEFAULT_WEB_SOCKET_URL = 'ws://127.0.0.1:12345';
const DEFAULT_API_SECRET_KEY_ENV = 'AMARAN_API_SECRET_KEY';
const DEFAULT_CLIENT_ID = 1;
const DEFAULT_REQUEST_TIMEOUT_MS = 5000;
const DEFAULT_DEBOUNCE_MS = 220;

type JsonObject = Record<string, unknown>;
type MutableLightState = { -readonly [Key in keyof LightState]: LightState[Key] };

interface PendingRequest {
  readonly action: string;
  readonly reject: (error: Error) => void;
  readonly resolve: (data: unknown) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

interface QueuedCommand {
  command: LightCommand;
  resolvers: Array<{
    readonly reject: (error: Error) => void;
    readonly resolve: (state: LightState) => void;
  }>;
  timer: ReturnType<typeof setTimeout>;
}

interface ApiResponse {
  readonly action?: unknown;
  readonly code?: unknown;
  readonly data?: unknown;
  readonly message?: unknown;
  readonly request_id?: unknown;
  readonly type?: unknown;
}

interface ApiEvent {
  readonly data?: unknown;
  readonly event?: unknown;
  readonly node_id?: unknown;
  readonly type?: unknown;
}

export class DesktopApiTransport implements AmaranTransport {
  private readonly apiSecretKey?: string;
  private readonly clientId: number;
  private readonly debounceMs: number;
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private readonly requestTimeoutMs: number;
  private readonly stateCache = new Map<string, LightState>();
  private readonly updateQueue = new Map<string, QueuedCommand>();
  private readonly webSocketUrl: string;
  private connecting?: Promise<WebSocket>;
  private requestId = 1;
  private socket?: WebSocket;

  constructor(
    config: AmaranDesktopTransportConfig,
    private readonly log: Logger,
  ) {
    this.webSocketUrl = config.webSocketUrl ?? DEFAULT_WEB_SOCKET_URL;
    this.apiSecretKey = resolveApiSecretKey(config, this.log);
    this.clientId = config.clientId ?? DEFAULT_CLIENT_ID;
    this.requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.debounceMs = config.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  async getState(id: string): Promise<LightState> {
    const [sleep, intensity, cct, hsi] = await Promise.allSettled([
      this.sendRequest('get_sleep', id),
      this.sendRequest('get_intensity', id),
      this.sendRequest('get_cct', id),
      this.sendRequest('get_hsi', id),
    ]);

    const state: LightState = {
      ...readSettledState(sleep, normalizeSleepState),
      ...readSettledState(intensity, normalizeIntensityState),
      ...readSettledState(cct, normalizeCctState),
    };

    if (hsi.status === 'fulfilled') {
      Object.assign(state, normalizeHsiState(hsi.value));
    } else {
      this.log.debug('amaran Desktop API get_hsi failed for %s: %s', id, formatError(hsi.reason));
    }

    if (Object.keys(state).length === 0) {
      const firstFailure = [sleep, intensity, cct, hsi].find((result) => result.status === 'rejected');
      throw new Error(`amaran Desktop API state read failed for ${id}: ${firstFailure ? formatError(firstFailure.reason) : 'empty response'}`);
    }

    return this.mergeState(id, state);
  }

  async setState(id: string, command: LightCommand): Promise<LightState> {
    return await new Promise<LightState>((resolve, reject) => {
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

      const queued: QueuedCommand = {
        command: { ...command },
        resolvers: [{ reject, resolve }],
        timer: setTimeout(() => {
          void this.flushQueuedCommand(id);
        }, this.debounceMs),
      };

      this.updateQueue.set(id, queued);
    });
  }

  private async flushQueuedCommand(id: string): Promise<void> {
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
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));

      for (const resolver of queued.resolvers) {
        resolver.reject(normalizedError);
      }
    }
  }

  private async applyState(id: string, command: LightCommand): Promise<LightState> {
    const cached = this.stateCache.get(id) ?? {};
    const state: MutableLightState = {};

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
    } else if (command.colorTemperatureKelvin !== undefined) {
      const args: JsonObject = {
        cct: Math.round(command.colorTemperatureKelvin),
      };

      if (command.brightness !== undefined) {
        args.intensity = brightnessToIntensity(command.brightness);
      }

      const response = await this.sendRequest('set_cct', id, args);
      Object.assign(state, normalizeCctState(response));
    } else if (command.brightness !== undefined) {
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

  private async sendRequest(action: string, nodeId?: string, args?: JsonObject): Promise<unknown> {
    const socket = await this.getSocket();
    const requestId = this.nextRequestId();
    const payload: JsonObject = {
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

    return await new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`amaran Desktop API ${action} timed out after ${this.requestTimeoutMs}ms`));
      }, this.requestTimeoutMs);

      this.pendingRequests.set(requestId, {
        action,
        reject,
        resolve,
        timeout,
      });

      const rejectSend = (error: Error): void => {
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
      } catch (error) {
        rejectSend(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private async getSocket(): Promise<WebSocket> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return this.socket;
    }

    if (this.connecting) {
      return await this.connecting;
    }

    this.connecting = this.openSocket();

    try {
      return await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }

  private async openSocket(): Promise<WebSocket> {
    return await new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(this.webSocketUrl);
      let timeout: ReturnType<typeof setTimeout>;
      const cleanup = (): void => {
        clearTimeout(timeout);
        socket.off('error', onOpenError);
        socket.off('open', onOpen);
      };

      const onOpen = (): void => {
        cleanup();
        this.socket = socket;
        socket.on('close', (code, reason) => this.handleClose(socket, code, reason));
        socket.on('error', (error) => this.log.warn('amaran Desktop API WebSocket error: %s', formatError(error)));
        socket.on('message', (data) => this.handleMessage(data));
        resolve(socket);
      };

      const onOpenError = (error: Error): void => {
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

  private handleClose(socket: WebSocket, code: number, reason: Buffer): void {
    if (this.socket === socket) {
      this.socket = undefined;
    }

    const message = reason.length > 0 ? reason.toString('utf8') : `code ${code}`;
    this.rejectPendingRequests(new Error(`amaran Desktop API WebSocket closed: ${message}`));
  }

  private handleMessage(data: RawData): void {
    let message: unknown;

    try {
      message = JSON.parse(rawDataToString(data));
    } catch (error) {
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

  private handleResponse(response: ApiResponse): void {
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

    if (code !== 0) {
      pending.reject(new Error(`amaran Desktop API ${pending.action} failed with code ${code}: ${readMessage(response.message)}`));
      return;
    }

    pending.resolve(response.data);
  }

  private handleEvent(event: ApiEvent): void {
    if (typeof event.event !== 'string' || typeof event.node_id !== 'string') {
      return;
    }

    const state = normalizeEventState(event.event, event.data);

    if (Object.keys(state).length > 0) {
      this.mergeState(event.node_id, state);
    }
  }

  private rejectPendingRequests(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }

    this.pendingRequests.clear();
  }

  private createToken(): string {
    if (!this.apiSecretKey) {
      throw new Error(`amaran Desktop API secret key is not configured. Set apiSecretKey or ${DEFAULT_API_SECRET_KEY_ENV}.`);
    }

    const key = Buffer.from(this.apiSecretKey, 'base64');

    if (key.length !== 32) {
      throw new Error('amaran Desktop API secret key must be a base64-encoded 32-byte AES-256 key.');
    }

    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const encrypted = Buffer.concat([cipher.update(timestamp, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
  }

  private nextRequestId(): number {
    const requestId = this.requestId;
    this.requestId = this.requestId >= Number.MAX_SAFE_INTEGER ? 1 : this.requestId + 1;
    return requestId;
  }

  private mergeState(id: string, state: LightState): LightState {
    const nextState = removeUndefined({
      ...this.stateCache.get(id),
      ...state,
    });

    this.stateCache.set(id, nextState);
    return nextState;
  }
}

function resolveApiSecretKey(config: AmaranDesktopTransportConfig, log: Logger): string | undefined {
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

function normalizeEventState(event: string, data: unknown): LightState {
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

function normalizeSleepState(payload: unknown): LightState {
  const sleep = readBoolean(payload, ['sleep']);

  return sleep === undefined ? {} : { on: !sleep };
}

function normalizeIntensityState(payload: unknown): LightState {
  const intensity = readNumber(payload, ['intensity']);

  return intensity === undefined ? {} : { brightness: intensityToBrightness(intensity) };
}

function normalizeCctState(payload: unknown): LightState {
  const cct = readNumber(payload, ['cct']);
  const intensity = readNumber(payload, ['intensity']);
  const state: MutableLightState = {};

  if (cct !== undefined) {
    state.colorTemperatureKelvin = cct;
  }

  if (intensity !== undefined) {
    state.brightness = intensityToBrightness(intensity);
  }

  return state;
}

function normalizeHsiState(payload: unknown): LightState {
  const hue = readNumber(payload, ['hue']);
  const saturation = readNumber(payload, ['sat', 'saturation']);
  const intensity = readNumber(payload, ['intensity']);
  const state: MutableLightState = {};

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

function readSettledState(
  result: PromiseSettledResult<unknown>,
  normalize: (payload: unknown) => LightState,
): LightState {
  return result.status === 'fulfilled' ? normalize(result.value) : {};
}

function readBoolean(payload: unknown, keys: readonly string[]): boolean | undefined {
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

function readNumber(payload: unknown, keys: readonly string[]): number | undefined {
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

function unwrapObject(payload: unknown): JsonObject | undefined {
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

function brightnessToIntensity(brightness: number): number {
  return Math.round(clamp(brightness, 1, 100) * 10);
}

function intensityToBrightness(intensity: number): number {
  return Math.round(clamp(intensity / 10, 1, 100));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rawDataToString(data: RawData): string {
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

function readMessage(message: unknown): string {
  return typeof message === 'string' && message.length > 0 ? message : 'unknown error';
}

function removeUndefined(state: LightState): LightState {
  return Object.fromEntries(
    Object.entries(state).filter(([, value]) => value !== undefined),
  ) as LightState;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
