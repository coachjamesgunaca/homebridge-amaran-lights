import type { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';
export declare class AmaranLightsPlatform implements DynamicPlatformPlugin {
    readonly log: Logger;
    readonly api: API;
    private readonly accessories;
    private readonly lightHandlers;
    private controlServer?;
    private readonly config;
    private readonly transport;
    constructor(log: Logger, config: PlatformConfig, api: API);
    configureAccessory(accessory: PlatformAccessory): void;
    private discoverDevices;
    private startControlServer;
    private isValidLightConfig;
}
