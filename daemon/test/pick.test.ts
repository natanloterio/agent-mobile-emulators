import { describe, expect, it } from 'vitest';
import type { IdentityRow } from '../src/db/identities.js';
import { pickTestIdentity } from '../src/fleet/pick.js';

const base: IdentityRow = { id: 'conta1', name: 'conta1', handle: '@a', avdName: 'a', serial: 'emulator-5554', consolePort: 5554, mcpHostPort: 8080, mcpToken: 't', deviceSlug: 'conta1', appPackage: 'p', appVersionName: 'v', state: 'idle' };
const row = (id: string, over: Partial<IdentityRow>): IdentityRow => ({ ...base, id, name: id, ...over });

describe('pickTestIdentity', () => {
  it('prefere idle livre; pula pausada, controlada, rodando, bloqueada e descartada', () => {
    const ids = [
      row('a', { state: 'running' }), row('b', { state: 'idle', paused: true }), row('c', { state: 'idle', controlled: true }),
      row('d', { state: 'needs-human' }), row('e', { state: 'banned' }), row('f', { state: 'idle', discardedAt: 'x' }),
      row('g', { state: 'offline' }), row('h', { state: 'idle' }),
    ];
    expect(pickTestIdentity(ids)?.id).toBe('h');
  });
  it('sem idle, aceita offline/logged-in (a sonda decide); nada elegível → null', () => {
    expect(pickTestIdentity([row('g', { state: 'offline' })])?.id).toBe('g');
    expect(pickTestIdentity([row('a', { state: 'running' }), row('p', { state: 'provisioned' })])).toBeNull();
  });
});
