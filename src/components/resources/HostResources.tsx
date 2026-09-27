import type { HostOs } from '../../lib/platformMeters';
import type { Meter } from '../../lib/resources';
import { LinuxResources } from './LinuxResources';
import { MacResources } from './MacResources';
import { WindowsResources } from './WindowsResources';

interface HostResourcesProps {
  readonly meters: readonly Meter[];
  readonly host: { readonly os: HostOs; readonly appleSilicon: boolean };
}

/** Recursos do host na sidebar: um componente por sistema operacional. */
export function HostResources({ meters, host }: HostResourcesProps) {
  switch (host.os) {
    case 'mac': return <MacResources meters={meters} appleSilicon={host.appleSilicon} />;
    case 'windows': return <WindowsResources meters={meters} />;
    case 'linux': return <LinuxResources meters={meters} />;
  }
}
