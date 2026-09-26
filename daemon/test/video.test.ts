import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createVideoStreams, scidFor, serverArgs, type VideoPacket, type VideoState } from '../src/device/video.js';

const nal = (type: number, ...body: number[]) => Buffer.from([0, 0, 0, 1, type, ...body]);
const SPS = nal(0x67, 1), PPS = nal(0x68, 2), IDR = nal(0x65, 3), P = nal(0x41, 4), END = Buffer.from([0, 0, 0, 1]);

function harness() {
  const calls: string[] = []; const children: { serial: string; args: readonly string[]; em: EventEmitter; killed: boolean }[] = [];
  const sockets: PassThrough[] = [];
  const adb = {
    push: async (serial: string, local: string, remote: string) => { calls.push(`push ${serial} ${local}→${remote}`); },
    forward: async (serial: string, port: number, spec: string) => { calls.push(`forward ${serial} ${port} ${spec}`); },
    forwardRemove: async (serial: string, port: number) => { calls.push(`forwardRemove ${serial} ${port}`); },
    shellSpawn: (serial: string, cmd: readonly string[]) => { const em = new EventEmitter(); const c = { serial, args: cmd, em, killed: false }; children.push(c); return { pid: children.length, kill: () => { c.killed = true; em.emit('exit'); return true; }, on: (ev: 'exit' | 'error', cb: () => void) => em.on(ev, cb) }; },
  };
  const connect = async (_port: number) => { const s = new PassThrough(); sockets.push(s); return s; };
  const waits: (() => void)[] = []; const sleep = () => new Promise<void>((r) => { waits.push(r); });
  const states: string[] = [];
  const v = createVideoStreams({ adb, connect, sleep, serverPath: '/repo/daemon/vendor/scrcpy-server-v4.1', portFrom: 27183, onState: (id, s) => states.push(`${id}:${s}`) });
  const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
  return { adb, calls, children, sockets, waits, states, v, settle };
}

describe('scidFor / serverArgs', () => {
  it('scid é 8 hex determinístico; args do servidor têm raw_stream e sem áudio/controle', () => {
    expect(scidFor('conta1')).toMatch(/^[0-9a-f]{8}$/); expect(scidFor('conta1')).toBe(scidFor('conta1')); expect(scidFor('conta2')).not.toBe(scidFor('conta1'));
    // scrcpy faz Integer.parseInt(scid, 16): precisa caber em int32 com sinal ('probe' dava a949c530 antes da correção)
    for (const id of ['conta1', 'probe', 'B']) { expect(scidFor(id)).toMatch(/^[0-9a-f]{8}$/); expect(parseInt(scidFor(id), 16)).toBeLessThanOrEqual(0x7fffffff); }
    const a = serverArgs('0000abcd').join(' ');
    expect(a).toMatch(/^CLASSPATH=\/data\/local\/tmp\/enxame-scrcpy-server\.jar app_process \/ com\.genymobile\.scrcpy\.Server 4\.1 /);
    for (const kv of ['scid=0000abcd', 'tunnel_forward=true', 'video=true', 'audio=false', 'control=false', 'raw_stream=true', 'cleanup=true', 'max_size=720', 'max_fps=30', 'video_bit_rate=2000000', 'video_codec_options=i-frame-interval:int=2']) expect(a).toContain(kv);
  });
});

describe('createVideoStreams', () => {
  it('inativo não faz nada; ativo: push, forward, spawn, conecta e emite pacotes com seq e key', async () => {
    const h = harness(); const pk: VideoPacket[] = []; h.v.onPacket((p) => pk.push(p));
    h.v.start([{ id: 'conta1', serial: 'emulator-5554' }]); await h.settle();
    expect(h.calls).toEqual([]); expect(h.v.state('conta1')).toBe('idle');
    h.v.setActive(true); await h.settle();
    expect(h.calls).toEqual(['push emulator-5554 /repo/daemon/vendor/scrcpy-server-v4.1→/data/local/tmp/enxame-scrcpy-server.jar', `forward emulator-5554 27183 localabstract:scrcpy_${scidFor('conta1')}`]);
    expect(h.children[0].args.join(' ')).toContain('raw_stream=true');
    h.sockets[0].write(Buffer.concat([SPS, PPS, IDR, P, END])); await h.settle();
    expect(pk.map((p) => [p.id, p.seq, p.key])).toEqual([['conta1', 0, true], ['conta1', 1, false]]);
    expect(pk[0].data.equals(Buffer.concat([SPS, PPS, IDR]))).toBe(true);
    expect(h.v.state('conta1')).toBe('streaming'); expect(h.states).toContain('conta1:streaming');
    h.v.stop(); await h.settle(); expect(h.children[0].killed).toBe(true); expect(h.calls.at(-1)).toBe('forwardRemove emulator-5554 27183');
  });
  it('socket fecha → retrying, forwardRemove, respawn após retryMs; duas identidades com portas distintas e independentes', async () => {
    const h = harness(); h.v.setActive(true);
    h.v.start([{ id: 'A', serial: 'a' }, { id: 'B', serial: 'b' }]); await h.settle();
    expect(h.calls.filter((c) => c.startsWith('forward '))).toEqual([`forward a 27183 localabstract:scrcpy_${scidFor('A')}`, `forward b 27184 localabstract:scrcpy_${scidFor('B')}`]);
    h.sockets[0].end(); await h.settle();
    expect(h.v.state('A')).toBe('retrying'); expect(h.v.state('B')).toBe('starting');
    expect(h.children[0].killed).toBe(true); expect(h.calls).toContain('forwardRemove a 27183'); expect(h.children[1].killed).toBe(false);
    h.waits.shift()?.(); await h.settle();                       // retryMs passou
    expect(h.children.filter((c) => c.serial === 'a')).toHaveLength(2); expect(h.calls.filter((c) => c === 'push a /repo/daemon/vendor/scrcpy-server-v4.1→/data/local/tmp/enxame-scrcpy-server.jar')).toHaveLength(2); // push a cada sessão (o servidor apaga o jar)
    h.v.stop();
  });
  it('setActive(false) mata os processos e remove os forwards; setActive(true) sobe de novo', async () => {
    const h = harness(); h.v.setActive(true); h.v.start([{ id: 'A', serial: 'a' }]); await h.settle();
    h.v.setActive(false); await h.settle();
    expect(h.children[0].killed).toBe(true); expect(h.calls).toContain('forwardRemove a 27183'); expect(h.v.state('A')).toBe('idle');
    h.v.setActive(true); await h.settle(); expect(h.children).toHaveLength(2); h.v.stop();
  });
});
