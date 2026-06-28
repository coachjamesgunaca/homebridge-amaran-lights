"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AmaranLightAccessory = void 0;
const models_1 = require("./models");
class AmaranLightAccessory {
    platform;
    accessory;
    config;
    transport;
    capabilities;
    service;
    state;
    constructor(platform, accessory, config, transport) {
        this.platform = platform;
        this.accessory = accessory;
        this.config = config;
        this.transport = transport;
        this.capabilities = (0, models_1.getCapabilities)(config.model);
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
    configureCharacteristics() {
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
            minValue: (0, models_1.kelvinToMired)(this.capabilities.maxKelvin),
            maxValue: (0, models_1.kelvinToMired)(this.capabilities.minKelvin),
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
        }
        else {
            this.service.removeCharacteristic(this.service.getCharacteristic(this.platform.api.hap.Characteristic.Hue));
            this.service.removeCharacteristic(this.service.getCharacteristic(this.platform.api.hap.Characteristic.Saturation));
        }
    }
    getOn(callback) {
        callback(null, this.state.on);
    }
    setOn(value, callback) {
        void this.applyState({ on: Boolean(value) }, callback);
    }
    getBrightness(callback) {
        callback(null, this.state.brightness);
    }
    setBrightness(value, callback) {
        void this.applyState({ brightness: (0, models_1.clamp)(Number(value), 1, 100) }, callback);
    }
    getColorTemperature(callback) {
        callback(null, (0, models_1.kelvinToMired)(this.state.colorTemperatureKelvin));
    }
    setColorTemperature(value, callback) {
        const minMired = (0, models_1.kelvinToMired)(this.capabilities.maxKelvin);
        const maxMired = (0, models_1.kelvinToMired)(this.capabilities.minKelvin);
        const mired = (0, models_1.clamp)(Number(value), minMired, maxMired);
        const colorTemperatureKelvin = (0, models_1.clamp)((0, models_1.miredToKelvin)(mired), this.capabilities.minKelvin, this.capabilities.maxKelvin);
        void this.applyState({ colorTemperatureKelvin }, callback);
    }
    getHue(callback) {
        callback(null, this.state.hue);
    }
    setHue(value, callback) {
        void this.applyState({ hue: (0, models_1.clamp)(Number(value), 0, 360) }, callback);
    }
    getSaturation(callback) {
        callback(null, this.state.saturation);
    }
    setSaturation(value, callback) {
        void this.applyState({ saturation: (0, models_1.clamp)(Number(value), 0, 100) }, callback);
    }
    /** Light id (must equal the daemon key used by the http transport). */
    get id() {
        return this.config.id;
    }
    /** Human-friendly name for listings. */
    get displayName() {
        return this.config.name;
    }
    /**
     * Apply a command that originated outside HomeKit (e.g. the Stream Deck
     * plugin via the HTTP control server). Forwards to the transport exactly like
     * a HomeKit-initiated change, then pushes the result into HomeKit so the tile
     * stays in sync. Brightness/CCT/HSI implicitly turn the fixture on (the daemon
     * does this), which we reflect without an extra round-trip.
     */
    async applyExternalCommand(command) {
        const state = await this.transport.setState(this.config.id, command);
        this.updateState(state);
        if (command.on !== undefined) {
            this.state = { ...this.state, on: command.on };
        }
        else if (command.brightness !== undefined ||
            command.colorTemperatureKelvin !== undefined ||
            command.hue !== undefined ||
            command.saturation !== undefined) {
            this.state = { ...this.state, on: true };
        }
        this.updateHomeKitCharacteristics();
        return this.state;
    }
    async refreshState() {
        try {
            const state = await this.transport.getState(this.config.id);
            this.updateState(state);
            this.updateHomeKitCharacteristics();
        }
        catch (error) {
            this.platform.log.warn('Failed to read initial state for %s: %s', this.config.name, formatError(error));
        }
    }
    async applyState(command, callback) {
        try {
            const state = await this.transport.setState(this.config.id, command);
            this.updateState(state);
            this.updateHomeKitCharacteristics();
            callback(null);
        }
        catch (error) {
            this.platform.log.error('Failed to update %s: %s', this.config.name, formatError(error));
            callback(error instanceof Error ? error : new Error(String(error)));
        }
    }
    updateState(state) {
        this.state = {
            ...this.state,
            ...state,
        };
    }
    updateHomeKitCharacteristics() {
        this.service.updateCharacteristic(this.platform.api.hap.Characteristic.On, this.state.on);
        this.service.updateCharacteristic(this.platform.api.hap.Characteristic.Brightness, this.state.brightness);
        this.service.updateCharacteristic(this.platform.api.hap.Characteristic.ColorTemperature, (0, models_1.kelvinToMired)(this.state.colorTemperatureKelvin));
        if (this.capabilities.supportsColor) {
            this.service.updateCharacteristic(this.platform.api.hap.Characteristic.Hue, this.state.hue);
            this.service.updateCharacteristic(this.platform.api.hap.Characteristic.Saturation, this.state.saturation);
        }
    }
    initialState() {
        return {
            on: false,
            brightness: 100,
            colorTemperatureKelvin: (0, models_1.clamp)(5600, this.capabilities.minKelvin, this.capabilities.maxKelvin),
            hue: 0,
            saturation: 0,
        };
    }
}
exports.AmaranLightAccessory = AmaranLightAccessory;
function formatError(error) {
    return error instanceof Error ? error.message : String(error);
}
