import { describe, expect, it } from 'vitest';
import { shouldSubmitEndpoint } from './endpointSubmit';

describe('shouldSubmitEndpoint', () => {
  it('envia quando o valor mudou', () => {
    expect(shouldSubmitEndpoint('http://127.0.0.1:11435/v1', 'http://127.0.0.1:11434/v1', null)).toBe(true);
  });
  it('não envia o mesmo valor sem erro pendente', () => {
    expect(shouldSubmitEndpoint('http://127.0.0.1:11434/v1', 'http://127.0.0.1:11434/v1', null)).toBe(false);
  });
  it('reenvia o valor válido quando há erro no card (limpa o erro do ftp://x)', () => {
    expect(shouldSubmitEndpoint('http://127.0.0.1:11434/v1', 'http://127.0.0.1:11434/v1', 'endpoint precisa ser http(s)')).toBe(true);
  });
});
