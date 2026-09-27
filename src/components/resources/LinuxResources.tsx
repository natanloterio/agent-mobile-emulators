import type { Meter } from '../../lib/resources';
import { Meters } from '../Meters';

/** Linux: RAM e CPU do /proc; VRAM só aparece com GPU NVIDIA (nvidia-smi). */
export function LinuxResources({ meters }: { readonly meters: readonly Meter[] }) {
  return <Meters meters={meters} />;
}
