import { describe, expect, it } from 'vitest';
import { bridgeMessage } from './useFleet';

describe('bridgeMessage', () => {
  it('tira o prefixo do request e o envelope {"error":…}', () => {
    expect(bridgeMessage(new Error('/providers/worker → 409: {"error":"objetivo ou teste em execução"}'))).toBe('objetivo ou teste em execução');
  });
  it('tira o invólucro do IPC do Electron antes da limpeza', () => {
    expect(bridgeMessage(new Error(`Error invoking remote method 'enxame:setProvider': Error: /providers/esc → 400: {"error":"endpoint precisa ser http(s)"}`))).toBe('endpoint precisa ser http(s)');
    expect(bridgeMessage(new Error(`Error invoking remote method 'enxame:getProviderModels': TypeError: fetch failed`))).toBe('fetch failed');
    expect(bridgeMessage(new Error(`Error invoking remote method 'enxame:getProviderModels': Error: No handler registered for 'enxame:getProviderModels'`))).toBe(`No handler registered for 'enxame:getProviderModels'`);
  });
  it('mensagem sem invólucro passa intacta', () => {
    expect(bridgeMessage(new Error('fetch failed'))).toBe('fetch failed');
  });
});
