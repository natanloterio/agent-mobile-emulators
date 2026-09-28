/// <reference types="vite/client" />
import type { TapflockBridge } from './live/types';

declare global {
  interface Window { readonly tapflock?: Partial<TapflockBridge> & { readonly platform?: string; readonly version?: string } }
}
export {};
