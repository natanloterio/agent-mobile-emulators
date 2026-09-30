import { describe, expect, it } from 'vitest';
import { createQualityFloor, invalidCallIds, isParamError, isTextToolCall, isToolParseError } from '../src/provider/quality.js';
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

describe('erro de parâmetro do MCP (incremento 3, spec §4.1)', () => {
  const paramErr = (id: string, msg: string) => ({ type: 'tool-error', toolCallId: id, toolName: 'android_conta1_scroll', error: new Error(msg) });
  it('isParamError casa os formatos do servidor e os dois prefixos (Review Focus 3)', () => {
    for (const m of [
      "Error executing tool android_conta1_scroll: Parameter 'amount' must be one of: small, medium, large. Got: '500'",
      "Error: Error executing tool android_conta1_scroll: Parameter 'amount' must be one of: small, medium, large",
      "Parameter 'x' must be a number, got: 'abc'", "Parameter 'x' must be an integer, got: '1.5'", "Parameter 'text' must be non-empty",
      "Missing required parameter 'node_id'", "Error executing tool t: Missing required parameter: 'name'",
    ]) expect(isParamError(m), m).toBe(true);
    for (const m of [
      "Error executing tool android_conta1_scroll_to_node: Node 'node_43bc623c' not visible after 5 scroll attempts",
      "Node 'n1' not found", "Node 'n1' is not clickable", 'fetch failed: ECONNREFUSED', "device 'emulator-5554' not found",
    ]) expect(isParamError(m), m).toBe(false);
  });
  it('invalidCallIds inclui tool-error de parâmetro e o piso conta', () => {
    const s = step([paramErr('p1', "Error executing tool android_conta1_scroll: Parameter 'amount' must be one of: small, medium, large. Got: '500'"), paramErr('n1', "Node 'x' not found"), bad('b1')]);
    expect(invalidCallIds(s)).toEqual(['b1', 'p1']);
    const f = createQualityFloor(2); f.observe(s); expect(f.tripped()).toBe(true);
  });
  it('tool-error com string (não Error) também conta', () => {
    expect(invalidCallIds(step([{ type: 'tool-error', toolCallId: 's1', toolName: 't', error: "Parameter 'amount' must be one of: a, b" }]))).toEqual(['s1']);
  });
  it('chamada escrita como texto (sem tool call de verdade) dispara o piso na hora: o modelo não se recupera sozinho', () => {
    const f = createQualityFloor(3);
    const text = (t: string): StepLike => ({ stepNumber: 1, text: t, content: [{ type: 'text' }], usage });
    f.observe(text('{"name":"finish_subtask","arguments":{"ok":true,"did":"x","blockers":""}}'));
    expect(f.tripped()).toBe(true);
    expect(f.count()).toBe(3);
  });
  it('isTextToolCall: objeto JSON como texto, e só sem tool call real no passo', () => {
    const t = (text: string, content: StepLike['content'] = [{ type: 'text' }]): StepLike => ({ stepNumber: 1, text, content, usage });
    expect(isTextToolCall(t('{"name":"finish_subtask","arguments":{}}'))).toBe(true);
    expect(isTextToolCall(t('```json\n{"name": "android_conta1_tap_node", "arguments": {"node_id": "x"}}\n```'))).toBe(true);
    expect(isTextToolCall(t('Não consegui concluir a subtarefa.'))).toBe(false);
    expect(isTextToolCall(t('{"?":"?"}'))).toBe(true); // lixo do gpt-oss na 1ª missão (subtarefa 4): também escala
    expect(isTextToolCall(t('{"name":"finish_subtask","arguments":{}}', [ok]))).toBe(false);
  });
  it('isTextToolCall também pega o JSON só com os argumentos (ex.: {"ok":true,"did":…} do finish_subtask)', () => {
    const t = (text: string): StepLike => ({ stepNumber: 1, text, content: [{ type: 'text' }], usage });
    expect(isTextToolCall(t('{"ok":true,"did":"captured natanloterio last post image","blockers":""}'))).toBe(true);
    expect(isTextToolCall(t('{}'))).toBe(false);
    expect(isTextToolCall(t('[1,2]'))).toBe(false);
  });
  it('isToolParseError: erro do Ollama ao ler a chamada, direto ou dentro do RetryError', () => {
    expect(isToolParseError(new Error("error parsing tool call: raw='We need open…'"))).toBe(true);
    const retry = Object.assign(new Error("Failed after 3 attempts. Last error: AI_APICallError: error parsing tool call: raw='x'"), { name: 'AI_RetryError' });
    expect(isToolParseError(retry)).toBe(true);
    expect(isToolParseError(new Error('fetch failed: ECONNREFUSED'))).toBe(false);
    expect(isToolParseError('texto')).toBe(false);
  });
  it('trip() dispara o piso na hora', () => {
    const f = createQualityFloor(3); f.trip();
    expect(f.tripped()).toBe(true); expect(f.count()).toBe(3);
  });
});
