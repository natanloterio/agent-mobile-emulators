import { describe, expect, it } from 'vitest';
import { nextAction, type SinkState } from './h264Sink';

const idle: SinkState = { configured: false, waitingKey: true, errors: 0 };
describe('nextAction (h264Sink)', () => {
  it('antes do primeiro key: skip; key → configure+decode; depois decode; erro → reset e espera key', () => {
    expect(nextAction(idle, { key: false })).toEqual({ action: 'skip', state: idle });
    const r1 = nextAction(idle, { key: true }); expect(r1.action).toBe('configure'); expect(r1.state).toEqual({ configured: true, waitingKey: false, errors: 0 });
    expect(nextAction(r1.state, { key: false }).action).toBe('decode');
    const r2 = nextAction(r1.state, { key: false, error: true }); expect(r2.action).toBe('reset'); expect(r2.state).toEqual({ configured: false, waitingKey: true, errors: 1 });
    expect(nextAction(r2.state, { key: false }).action).toBe('skip'); expect(nextAction(r2.state, { key: true }).action).toBe('configure');
  });
});
