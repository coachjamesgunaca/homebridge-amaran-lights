import type {
  CharacteristicGetCallback,
  CharacteristicSetCallback,
  CharacteristicValue,
  PlatformAccessory,
  Service,
} from 'homebridge';

import { clamp, getCapabilities, kelvinToMired, miredToKelvin } from './models';
import type { AmaranLightsPlatform } from './platform';
import type { AmaranTransport } from './transports/transport';
import type { LightCommand, LightConfig, LightState, ModelCapabilities } from './types';

export class AmaranLightAccessory {
  private readonly capabilities: ModelCapabilities;
  private readonly service: Service;
  private state: Required<LightState>;

  constructor(
    private readonly platform: AmaranLightsPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly config: LightConfig,
    private readonly transport: AmaranTransport,
  ) {
    this.capabilities = getCapabilities(config.model);
    this.state = this.initialState();

    this.accessory
      .getService(this.platform.api.hap.Service.AccessoryInformation)
      ?.setCharacteristic(this.platform.api.hap.Characteristic.Manufacturer, this.capabilities.manufacturer)
      .setCharacteristic(this.platform.api.hap.Characteristic.Model, this.capabilities.displayName)
      .setCharacteristic(this.platform.api.hap.Characteristic.SerialNumber, this.config.serialNumber ?? this.config.id);

    this.service = this.accessory.getService(this.platform.api.hap.Service.Lightbulb)
      ?? this.accessory.addService(this.platform.api.hap.Service.Lightbulb);

    this.service.setCharacteristic(this.platform.api.hap.Characteristic.Name, this.config.name);

    this.configureCharacteristics();
    void this.refreshState();
  }

  private configureCharacteristics(): void {
    this.service.getCharacteristic(this.platform.api.hap.Characteristic.On)
      .on('get', (callback) => this.getOn(callback))
      .on('set', (value, callback) => this.setOn(value, callback));

    this.service.getCharacteristic(this.platform.api.hap.Characteristic.Brightness)
      .setProps({
        minValue: 1,
        maxValue: 100,
        minStep: 1,
      })
      .on('get', (callback) => this.getBrightness(callback))
      .on('set', (value, callback) => this.setBrightness(value, callback));

    this.service.getCharacteristic(this.platform.api.hap.Characteristic.ColorTemperature)
      .setProps({
        minValue: kelvinToMired(this.capabilities.maxKelvin),
        maxValue: kelvinToMired(this.capabilities.minKelvin),
        minStep: 1,
      })
      .on('get', (callback) => this.getColorTemperature(callback))
      .on('set', (value, callback) => this.setColorTemperature(value, callback));

    if (this.capabilities.supportsColor) {
      this.service.getCharacteristic(this.platform.api.hap.Characteristic.Hue)
        .setProps({
          minValue: 0,
          maxValue: 360,
          minStep: 1,
        })
        .on('get', (callback) => this.getHue(callback))
        .on('set', (value, callback) => this.setHue(value, callback));

      this.service.getCharacteristic(this.platform.api.hap.Characteristic.Saturation)
        .setProps({
          minValue: 0,
          maxValue: 100,
          minStep: 1,
        })
        .on('get', (callback) => this.getSaturation(callback))
        .on('set', (value, callback) => this.setSaturation(value, callback));
    } else {
      this.service.removeCharacteristic(this.service.getCharacteristic(this.platform.api.hap.Characteristic.Hue));
      this.service.removeCharacteristic(this.service.getCharacteristic(this.platform.api.hap.Characteristic.Saturation));
    }
  }

  private getOn(callback: CharacteristicGetCallback): void {
    callback(null, this.state.on);
  }

  private setOn(value: CharacteristicValue, callback: CharacteristicSetCallback): void {
    void this.applyState({ on: Boolean(value) }, callback);
  }

  private getBrightness(callback: CharacteristicGetCallback): void {
    callback(null, this.state.brightness);
  }

  private setBrightness(value: CharacteristicValue, callback: CharacteristicSetCallback): void {
    void this.applyState({ brightness: clamp(Number(value), 1, 100) }, callback);
  }

  private getColorTemperature(callback: CharacteristicGetCallback): void {
    callback(null, kelvinToMired(this.state.colorTemperatureKelvin));
  }

  private setColorTemperature(value: CharacteristicValue, callback: CharacteristicSetCallback): void {
    const minMired = kelvinToMired(this.capabilities.maxKelvin);
    const maxMired = kelvinToMired(this.capabilities.minKelvin);
    const mired = clamp(Number(value), minMired, maxMired);
    const colorTemperatureKelvin = clamp(miredToKelvin(mired), this.capabilities.minKelvin, this.capabilities.maxKelvin);

    void this.applyState({ colorTemperatureKelvin }, callback);
  }

  private getHue(callback: CharacteristicGetCallback): void {
    callback(null, this.state.hue);
  }

  private setHue(value: CharacteristicValue, callback: CharacteristicSetCallback): void {
    void this.applyState({ hue: clamp(Number(value), 0, 360) }, callback);
  }

  private getSaturation(callback: CharacteristicGetCallback): void {
    callback(null, this.state.saturation);
  }

  private setSaturation(value: CharacteristicValue, callback: CharacteristicSetCallback): void {
    void this.applyState({ saturation: clamp(Number(value), 0, 100) }, callback);
  }

  private async refreshState(): Promise<void> {
    try {
      const state = await this.transport.getState(this.config.id);
      this.updateState(state);
      this.updateHomeKitCharacteristics();
    } catch (error) {
      this.platform.log.warn('Failed to read initial state for %s: %s', this.config.name, formatError(error));
    }
  }

  private async applyState(command: LightCommand, callback: CharacteristicSetCallback): Promise<void> {
    try {
      const state = await this.transport.setState(this.config.id, command);
      this.updateState(state);
      this.updateHomeKitCharacteristics();
      callback(null);
    } catch (error) {
      this.platform.log.error('Failed to update %s: %s', this.config.name, formatError(error));
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private updateState(state: LightState): void {
    this.state = {
      ...this.state,
      ...state,
    };
  }

  private updateHomeKitCharacteristics(): void {
    this.service.updateCharacteristic(this.platform.api.hap.Characteristic.On, this.state.on);
    this.service.updateCharacteristic(this.platform.api.hap.Characteristic.Brightness, this.state.brightness);
    this.service.updateCharacteristic(this.platform.api.hap.Characteristic.ColorTemperature, kelvinToMired(this.state.colorTemperatureKelvin));

    if (this.capabilities.supportsColor) {
      this.service.updateCharacteristic(this.platform.api.hap.Characteristic.Hue, this.state.hue);
      this.service.updateCharacteristic(this.platform.api.hap.Characteristic.Saturation, this.state.saturation);
    }
  }

  private initialState(): Required<LightState> {
    return {
      on: false,
      brightness: 100,
      colorTemperatureKelvin: clamp(5600, this.capabilities.minKelvin, this.capabilities.maxKelvin),
      hue: 0,
      saturation: 0,
    };
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
