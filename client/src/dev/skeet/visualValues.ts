import * as THREE from 'three';
export type NativeValues = Readonly<Record<string, number>>;
export const nativeValue = (v: NativeValues | null, path: string, fallback = 0): number => v?.[path.replaceAll('.','_')] ?? fallback;
export const nativeOn = (v: NativeValues | null, path: string): boolean => nativeValue(v,path) > 0.5;
export function nativeColor(v: NativeValues, path: string): string {
  const [r,g,b]=[0,1,2].map(i=>Math.max(0,Math.min(1,nativeValue(v,`${path}_${i}`,1))));
  return new THREE.Color().setRGB(r,g,b,THREE.SRGBColorSpace).getStyle();
}
