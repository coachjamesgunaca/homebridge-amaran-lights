export type AmaranModel = 'ray-120c' | 'verge-max';

export interface ModelCapabilities {
  readonly model: AmaranModel;
  readonly displayName: string;
  readonly manufacturer: string;
  readonly minKelvin: number;
  readonly maxKelvin: number;
  readonly supportsColor: boolean;
}

export interface LightConfig {
  readonly id: string;
  readonly name: string;
  readonly model: AmaranModel;
  readonly serialNumber?: string;
}

export interface HttpTransportConfig {
  readonly type: 'http';
  readonly baseUrl: string;
  readonly token?: string;
  readonly timeoutMs?: number;
}

export interface AmaranDesktopTransportConfig {
  readonly type: 'amaran-desktop';
  readonly webSocketUrl?: string;
  readonly apiSecretKey?: string;
  readonly apiSecretKeyEnv?: string;
  readonly clientId?: number;
  readonly requestTimeoutMs?: number;
  readonly debounceMs?: number;
  readonly debug?: boolean;
  readonly diagnostics?: boolean;
}

export interface MockTransportConfig {
  readonly type: 'mock';
}

export type TransportConfig = AmaranDesktopTransportConfig | HttpTransportConfig | MockTransportConfig;

export interface HttpControlServerConfig {
  readonly enabled?: boolean;
  readonly port?: number;
  readonly host?: string;
  readonly token?: string;
}

export interface AmaranPlatformConfig {
  readonly platform: string;
  readonly name?: string;
  readonly transport?: TransportConfig;
  readonly http?: HttpControlServerConfig;
  readonly lights?: readonly LightConfig[];
}

export interface LightState {
  readonly on?: boolean;
  readonly brightness?: number;
  readonly colorTemperatureKelvin?: number;
  readonly hue?: number;
  readonly saturation?: number;
}

export interface LightCommand {
  readonly on?: boolean;
  readonly brightness?: number;
  readonly colorTemperatureKelvin?: number;
  readonly hue?: number;
  readonly saturation?: number;
}
