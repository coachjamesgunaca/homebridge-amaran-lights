"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTransport = createTransport;
const desktopApiTransport_1 = require("./desktopApiTransport");
const httpTransport_1 = require("./httpTransport");
const mockTransport_1 = require("./mockTransport");
function createTransport(config, log) {
    if (!config || config.type === 'mock') {
        log.warn('Using mock transport. HomeKit state will update, but no physical amaran light will be controlled.');
        return new mockTransport_1.MockTransport();
    }
    if (config.type === 'http') {
        return new httpTransport_1.HttpTransport(config, log);
    }
    if (config.type === 'amaran-desktop') {
        return new desktopApiTransport_1.DesktopApiTransport(config, log);
    }
    const unreachable = config;
    throw new Error(`Unsupported transport config: ${JSON.stringify(unreachable)}`);
}
