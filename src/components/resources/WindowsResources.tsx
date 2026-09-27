import type { Meter } from '../../lib/resources';
import { Meters } from '../Meters';

/** Windows: RAM e CPU pelo `os` do Node; VRAM só aparece com GPU NVIDIA (o nvidia-smi vem com o driver). */
export function WindowsResources({ meters }: { readonly meters: readonly Meter[] }) {
  return <Meters meters={meters} />;
}
