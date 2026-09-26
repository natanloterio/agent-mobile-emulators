import type { ProviderMode, RoleDef, RoleKey } from '../types/fleet';

export const ROLES: readonly RoleDef[] = [
  { key: 'lider', name: 'Líder', volume: '1× por objetivo · decomposição', tone: 'grey' },
  { key: 'worker', name: 'Worker por device', volume: '40–60 passos × N contas', tone: 'green' },
  { key: 'esc', name: 'Escalonamento', volume: 'Raro · tela inesperada, orçamento, ação sensível', tone: 'dark' },
];

export const DEFAULT_MODES: Readonly<Record<RoleKey, ProviderMode>> = {
  lider: 'nuvem',
  worker: 'local',
  esc: 'nuvem',
};

export function modelFor(role: RoleKey, mode: ProviderMode): string {
  if (mode === 'local') return 'Qwen3-30B-A3B · 4-bit';
  return role === 'worker' ? 'Claude Haiku' : 'Claude Sonnet';
}

export function endpointFor(mode: ProviderMode): string {
  return mode === 'local' ? 'http://127.0.0.1:8000/v1 (vLLM)' : 'api.anthropic.com';
}

export interface TestResultRow {
  readonly label: string;
  readonly value: string;
}

export function testResultFor(mode: ProviderMode): readonly TestResultRow[] {
  const local = mode === 'local';
  return [
    { label: 'Latência', value: local ? '410 ms' : '1,2 s' },
    { label: 'Tokens/s', value: local ? '88' : '64' },
    { label: 'Argumentos', value: 'estruturados e válidos' },
    { label: 'Tool', value: 'android_conta1_get_screen_state' },
  ];
}
