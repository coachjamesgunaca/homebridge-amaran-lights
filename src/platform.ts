import type {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
} from 'homebridge';

import { AmaranLightAccessory } from './platformAccessory';
import { getCapabilities } from './models';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { createTransport } from './transports';
import type { AmaranPlatformConfig, LightConfig } from './types';

export class AmaranLightsPlatform implements DynamicPlatformPlugin {
  private readonly accessories = new Map<string, PlatformAccessory>();
  private readonly config: AmaranPlatformConfig;
  private readonly transport;

  constructor(
    public readonly log: Logger,
    config: PlatformConfig,
    public readonly api: API,
  ) {
    this.config = config as AmaranPlatformConfig;
    this.transport = createTransport(this.config.transport, this.log);

    this.api.on('didFinishLaunching', () => {
      this.discoverDevices();
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.accessories.set(accessory.UUID, accessory);
  }

  private discoverDevices(): void {
    const configuredLights = this.config.lights ?? [];
    const configuredUuids = new Set<string>();

    if (configuredLights.length === 0) {
      this.log.warn('No amaran lights are configured. Add entries under the "lights" array.');
    }

    for (const lightConfig of configuredLights) {
      if (!this.isValidLightConfig(lightConfig)) {
        continue;
      }

      const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${lightConfig.id}`);
      configuredUuids.add(uuid);

      const existingAccessory = this.accessories.get(uuid);

      if (existingAccessory) {
        existingAccessory.context.device = lightConfig;
        this.api.updatePlatformAccessories([existingAccessory]);
        new AmaranLightAccessory(this, existingAccessory, lightConfig, this.transport);
        continue;
      }

      const accessory = new this.api.platformAccessory(lightConfig.name, uuid);
      accessory.context.device = lightConfig;
      new AmaranLightAccessory(this, accessory, lightConfig, this.transport);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }

    const staleAccessories = [...this.accessories.values()].filter((accessory) => !configuredUuids.has(accessory.UUID));

    if (staleAccessories.length > 0) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, staleAccessories);
      for (const staleAccessory of staleAccessories) {
        this.accessories.delete(staleAccessory.UUID);
      }
    }
  }

  private isValidLightConfig(lightConfig: LightConfig): boolean {
    if (!lightConfig.id || !lightConfig.name || !lightConfig.model) {
      this.log.warn('Skipping light with missing id, name, or model: %j', lightConfig);
      return false;
    }

    const capabilities = getCapabilities(lightConfig.model);

    if (!capabilities) {
      this.log.warn('Skipping %s because model "%s" is not supported.', lightConfig.name, lightConfig.model);
      return false;
    }

    return true;
  }
}
