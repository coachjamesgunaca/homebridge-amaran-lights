import type { AmaranModel, ModelCapabilities } from './types';

export const MODEL_CAPABILITIES: Record<AmaranModel, ModelCapabilities> = {
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

export function kelvinToMired(kelvin: number): number {
  return Math.round(1000000 / kelvin);
}

export function miredToKelvin(mired: number): number {
  return Math.round(1000000 / mired);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getCapabilities(model: AmaranModel): ModelCapabilities {
  return MODEL_CAPABILITIES[model];
}
