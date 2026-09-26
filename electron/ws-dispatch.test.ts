import { describe, expect, it } from 'vitest';
import { dispatchWsMessage } from './ws-dispatch.js';

describe('dispatchWsMessage', () => {
  it('encaminha snapshot, frame e video; ignora tipo desconhecido e JSON inválido', () => {
    const got: Record<string, unknown[]> = { snapshot: [], frame: [], video: [] };
    const h = { onSnapshot: (d: unknown) => got.snapshot.push(d), onFrame: (d: unknown) => got.frame.push(d), onVideo: (d: unknown) => got.video.push(d) };
    dispatchWsMessage(JSON.stringify({ type: 'snapshot', data: { killed: false } }), h);
    dispatchWsMessage(JSON.stringify({ type: 'frame', data: { id: 'c1', at: 'x', png: 'AAA=' } }), h);
    dispatchWsMessage(JSON.stringify({ type: 'video', data: { id: 'c1', seq: 1, key: true, nal: 'AAAAAWU=' } }), h);
    dispatchWsMessage(JSON.stringify({ type: 'other', data: 1 }), h); dispatchWsMessage('{nope', h);
    expect(got).toEqual({ snapshot: [{ killed: false }], frame: [{ id: 'c1', at: 'x', png: 'AAA=' }], video: [{ id: 'c1', seq: 1, key: true, nal: 'AAAAAWU=' }] });
  });
});
