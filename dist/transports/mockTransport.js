"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockTransport = void 0;
class MockTransport {
    states = new Map();
    async getState(id) {
        return this.getOrCreateState(id);
    }
    async setState(id, command) {
        const current = this.getOrCreateState(id);
        const next = {
            ...current,
            ...command,
        };
        this.states.set(id, next);
        return next;
    }
    getOrCreateState(id) {
        const existing = this.states.get(id);
        if (existing) {
            return existing;
        }
        const initial = {
            on: false,
            brightness: 100,
            colorTemperatureKelvin: 5600,
            hue: 0,
            saturation: 0,
        };
        this.states.set(id, initial);
        return initial;
    }
}
exports.MockTransport = MockTransport;
