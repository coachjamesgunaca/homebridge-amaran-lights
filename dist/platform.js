"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AmaranLightsPlatform = void 0;
const platformAccessory_1 = require("./platformAccessory");
const httpControlServer_1 = require("./httpControlServer");
const models_1 = require("./models");
const settings_1 = require("./settings");
const transports_1 = require("./transports");
class AmaranLightsPlatform {
    log;
    api;
    accessories = new Map();
    lightHandlers = new Map();
    controlServer;
    config;
    transport;
    constructor(log, config, api) {
        this.log = log;
        this.api = api;
        this.config = config;
        this.transport = (0, transports_1.createTransport)(this.config.transport, this.log);
        this.api.on('didFinishLaunching', () => {
            this.discoverDevices();
        });
        this.api.on('shutdown', () => {
            this.controlServer?.stop();
        });
    }
    configureAccessory(accessory) {
        this.accessories.set(accessory.UUID, accessory);
    }
    discoverDevices() {
        const configuredLights = this.config.lights ?? [];
        const configuredUuids = new Set();
        if (configuredLights.length === 0) {
            this.log.warn('No amaran lights are configured. Add entries under the "lights" array.');
        }
        for (const lightConfig of configuredLights) {
            if (!this.isValidLightConfig(lightConfig)) {
                continue;
            }
            const uuid = this.api.hap.uuid.generate(`${settings_1.PLUGIN_NAME}:${lightConfig.id}`);
            configuredUuids.add(uuid);
            const existingAccessory = this.accessories.get(uuid);
            if (existingAccessory) {
                existingAccessory.context.device = lightConfig;
                this.api.updatePlatformAccessories([existingAccessory]);
                this.lightHandlers.set(lightConfig.id, new platformAccessory_1.AmaranLightAccessory(this, existingAccessory, lightConfig, this.transport));
                continue;
            }
            const accessory = new this.api.platformAccessory(lightConfig.name, uuid);
            accessory.context.device = lightConfig;
            this.lightHandlers.set(lightConfig.id, new platformAccessory_1.AmaranLightAccessory(this, accessory, lightConfig, this.transport));
            this.api.registerPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, [accessory]);
        }
        const staleAccessories = [...this.accessories.values()].filter((accessory) => !configuredUuids.has(accessory.UUID));
        if (staleAccessories.length > 0) {
            this.api.unregisterPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, staleAccessories);
            for (const staleAccessory of staleAccessories) {
                this.accessories.delete(staleAccessory.UUID);
            }
        }
        this.startControlServer();
    }
    startControlServer() {
        const httpConfig = this.config.http;
        if (httpConfig?.enabled === false) {
            this.log.info('amaran HTTP control server disabled (http.enabled = false).');
            return;
        }
        if (this.lightHandlers.size === 0) {
            return;
        }
        this.controlServer = new httpControlServer_1.HttpControlServer(httpConfig ?? {}, this.lightHandlers, this.log);
        this.controlServer.start();
    }
    isValidLightConfig(lightConfig) {
        if (!lightConfig.id || !lightConfig.name || !lightConfig.model) {
            this.log.warn('Skipping light with missing id, name, or model: %j', lightConfig);
            return false;
        }
        const capabilities = (0, models_1.getCapabilities)(lightConfig.model);
        if (!capabilities) {
            this.log.warn('Skipping %s because model "%s" is not supported.', lightConfig.name, lightConfig.model);
            return false;
        }
        return true;
    }
}
exports.AmaranLightsPlatform = AmaranLightsPlatform;
