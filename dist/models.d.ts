import type { AmaranModel, ModelCapabilities } from './types';
export declare const MODEL_CAPABILITIES: Record<AmaranModel, ModelCapabilities>;
export declare function kelvinToMired(kelvin: number): number;
export declare function miredToKelvin(mired: number): number;
export declare function clamp(value: number, min: number, max: number): number;
export declare function getCapabilities(model: AmaranModel): ModelCapabilities;
