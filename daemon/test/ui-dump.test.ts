import { describe, expect, it } from 'vitest';
import { center, findNode, parseUiDump } from '../src/device/ui-dump.js';

// Trecho real do `uiautomator dump` (Configurações > Senhas e contas, Android 14).
const XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">
<node index="0" text="Accounts for Owner" resource-id="android:id/title" class="android.widget.TextView" package="com.android.settings" content-desc="" clickable="false" enabled="true" bounds="[63,1156][1038,1207]" />
<node index="1" text="eu@gmail.com" resource-id="android:id/title" class="android.widget.TextView" package="com.android.settings" content-desc="" clickable="false" enabled="true" bounds="[189,1270][700,1341]" />
<node index="2" text="Remove account" resource-id="android:id/button1" class="android.widget.Button" package="com.android.settings" content-desc="" clickable="true" enabled="true" bounds="[600,1800][1000,1900]" />
<node index="3" text="" resource-id="" class="android.widget.ImageView" package="x" content-desc="Navigate &amp; up" clickable="true" enabled="true" bounds="[0,0][100,100]" />
</hierarchy>`;

describe('parseUiDump', () => {
  it('lê texto, id, descrição e limites de cada nó (com entidades XML)', () => {
    const nodes = parseUiDump(XML);
    expect(nodes).toHaveLength(4);
    expect(nodes[1]).toMatchObject({ text: 'eu@gmail.com', resourceId: 'android:id/title', bounds: [189, 1270, 700, 1341] });
    expect(nodes[3].contentDesc).toBe('Navigate & up');
  });
  it('acha pelo predicado e calcula o centro para o toque', () => {
    const n = findNode(parseUiDump(XML), (x) => x.resourceId === 'android:id/button1');
    expect(n?.text).toBe('Remove account');
    expect(center(n!)).toEqual([800, 1850]);
    expect(findNode(parseUiDump(XML), (x) => x.text === 'nada')).toBeNull();
  });
});
