"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MODEL_CAPABILITIES = void 0;
exports.kelvinToMired = kelvinToMired;
exports.miredToKelvin = miredToKelvin;
exports.clamp = clamp;
exports.getCapabilities = getCapabilities;
exports.MODEL_CAPABILITIES = {
    'ray-120c': {
        model: 'ray-120c',
        displayName: 'amaran Ray 120c',
        manufacturer: 'amaran',
        minKelvin: 1800,
        maxKelvin: 20000,
        supportsColor: true,
    },
    'verge-max': {
        model: 'verge-max',
        displayName: 'amaran Verge Max',
        manufacturer: 'amaran',
        minKelvin: 2700,
        maxKelvin: 6500,
        supportsColor: false,
    },
};
function kelvinToMired(kelvin) {
    return Math.round(1000000 / kelvin);
}
function miredToKelvin(mired) {
    return Math.round(1000000 / mired);
}
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
function getCapabilities(model) {
    return exports.MODEL_CAPABILITIES[model];
}
