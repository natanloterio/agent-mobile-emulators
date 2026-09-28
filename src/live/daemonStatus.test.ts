import { describe, expect, it } from 'vitest';
import { parseDaemonStatus } from './daemonStatus';

describe('parseDaemonStatus', () => {
  it('aceita os três estados do main', () => {
    expect(parseDaemonStatus({ state: 'ok' })).toEqual({ state: 'ok' });
    expect(parseDaemonStatus({ state: 'failed', reason: 'exited', exitCode: 1, logPath: null, detail: 'x' }))
      .toEqual({ state: 'failed', reason: 'exited', exitCode: 1, logPath: null, detail: 'x' });
  });
  it('recusa formato desconhecido', () => {
    expect(parseDaemonStatus({ state: 'failed' })).toBeNull();
    expect(parseDaemonStatus('ok')).toBeNull();
  });
});
