import { describe, expect, it } from 'vitest';
import { createH264Sink, nextAction, type SinkState } from './h264Sink';

const idle: SinkState = { configured: false, waitingKey: true, errors: 0, lastSeq: null };
describe('nextAction (h264Sink)', () => {
  it('antes do primeiro key: skip; key → configure+decode; depois decode; erro → reset e espera key', () => {
    expect(nextAction(idle, { key: false, seq: 1 })).toEqual({ action: 'skip', state: idle });
    const r1 = nextAction(idle, { key: true, seq: 2 }); expect(r1.action).toBe('configure'); expect(r1.state).toEqual({ configured: true, waitingKey: false, errors: 0, lastSeq: 2 });
    expect(nextAction(r1.state, { key: false, seq: 3 }).action).toBe('decode');
    const r2 = nextAction(r1.state, { error: true }); expect(r2.action).toBe('reset'); expect(r2.state).toEqual({ configured: false, waitingKey: true, errors: 1, lastSeq: 2 });
    expect(nextAction(r2.state, { key: false, seq: 4 }).action).toBe('skip'); expect(nextAction(r2.state, { key: true, seq: 5 }).action).toBe('configure');
  });
  it('delta duplicado (seq <= último aceito) é descartado; key com seq menor (reinício do stream) é aceito', () => {
    const k = nextAction(idle, { key: true, seq: 10 }).state;
    const d = nextAction(k, { key: false, seq: 11 }); expect(d.action).toBe('decode'); expect(d.state.lastSeq).toBe(11);
    expect(nextAction(d.state, { key: false, seq: 11 })).toEqual({ action: 'skip', state: d.state });
    expect(nextAction(d.state, { key: false, seq: 10 }).action).toBe('skip');
    const restart = nextAction(d.state, { key: true, seq: 0 }); expect(restart.action).not.toBe('skip'); expect(restart.state.lastSeq).toBe(0);
    expect(nextAction(restart.state, { key: false, seq: 1 }).action).toBe('decode');
  });
});

describe('createH264Sink sem WebCodecs (node)', () => {
  it('vira no-op', () => {
    const sink = createH264Sink({} as HTMLCanvasElement);
    sink.push({ id: 'a', seq: 1, key: true, nal: 'AAAA' }); sink.close();
    expect(sink.lastFrameAt()).toBeNull();
  });
});
