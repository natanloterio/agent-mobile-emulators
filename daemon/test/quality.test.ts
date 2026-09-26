import { describe, expect, it } from 'vitest';
import { createQualityFloor, invalidCallIds } from '../src/provider/quality.js';
import type { StepLike } from '../src/worker/record.js';

const usage = { inputTokens: 1, outputTokens: 1 };
const step = (content: StepLike['content'], n = 1): StepLike => ({ stepNumber: n, text: '', content, usage });
const ok = { type: 'tool-call', toolCallId: 'a', toolName: 'android_conta1_tap_node', input: { node_id: 'x' } };
const bad = (id: string) => ({ type: 'tool-call', toolCallId: id, toolName: 'android_conta1_tap_node', input: {}, invalid: true });
const gateDenied = { type: 'tool-approval-response', approvalId: 'p', approved: false, toolCall: { toolCallId: 'g', toolName: 'android_conta1_tap_node' } };
const infraErr = { type: 'tool-error', toolCallId: 'a', toolName: 'android_conta1_tap_node', error: new Error("device 'emulator-5554' not found") };

describe('QualityFloor', () => {
  it('invalidCallIds devolve só as tool calls marcadas invalid', () => {
    expect(invalidCallIds(step([ok, bad('b1'), gateDenied, infraErr]))).toEqual(['b1']);
    expect(invalidCallIds(step([{ type: 'text' }]))).toEqual([]);
  });
  it('acumula por tarefa (não consecutivo) e dispara em limit', () => {
    const f = createQualityFloor(3);
    expect(f.observe(step([bad('1')]))).toBe(1);
    expect(f.observe(step([ok, gateDenied, infraErr]))).toBe(1);
    expect(f.tripped()).toBe(false);
    f.observe(step([bad('2')]));
    expect(f.tripped()).toBe(false);
    f.observe(step([bad('3')]));
    expect(f.tripped()).toBe(true); expect(f.count()).toBe(3); expect(f.limit).toBe(3);
  });
  it('não conta negação do gate, erro de infra nem passo só de texto', () => {
    const f = createQualityFloor(1);
    f.observe(step([gateDenied])); f.observe(step([infraErr])); f.observe(step([{ type: 'text' }]));
    expect(f.tripped()).toBe(false);
  });
});
