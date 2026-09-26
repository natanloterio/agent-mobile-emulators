/// <reference types="vite/client" />
import type { EnxameBridge } from './live/types';

declare global {
  interface Window { readonly enxame?: Partial<EnxameBridge> & { readonly platform?: string; readonly version?: string } }
}
export {};
