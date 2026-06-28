import type { PlatformAccessory } from 'homebridge';
import type { AmaranLightsPlatform } from './platform';
import type { AmaranTransport } from './transports/transport';
import type { LightCommand, LightConfig, LightState } from './types';
export declare class AmaranLightAccessory {
    private readonly platform;
    private readonly accessory;
    private readonly config;
    private readonly transport;
    private readonly capabilities;
    private readonly service;
    private state;
    constructor(platform: AmaranLightsPlatform, accessory: PlatformAccessory, config: LightConfig, transport: AmaranTransport);
    private configureCharacteristics;
    private getOn;
    private setOn;
    private getBrightness;
    private setBrightness;
    private getColorTemperature;
    private setColorTemperature;
    private getHue;
    private setHue;
    private getSaturation;
    private setSaturation;
    /** Light id (must equal the daemon key used by the http transport). */
    get id(): string;
    /** Human-friendly name for listings. */
    get displayName(): string;
    /**
     * Apply a command that originated outside HomeKit (e.g. the Stream Deck
     * plugin via the HTTP control server). Forwards to the transport exactly like
     * a HomeKit-initiated change, then pushes the result into HomeKit so the tile
     * stays in sync. Brightness/CCT/HSI implicitly turn the fixture on (the daemon
     * does this), which we reflect without an extra round-trip.
     */
    applyExternalCommand(command: LightCommand): Promise<Required<LightState>>;
    private refreshState;
    private applyState;
    private updateState;
    private updateHomeKitCharacteristics;
    private initialState;
}
