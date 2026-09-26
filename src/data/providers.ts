import { PT, type I18n } from '../i18n/translate';
import type { ProviderMode, RoleDef, RoleKey } from '../types/fleet';

/** Nome e volume do papel no idioma pedido (português por padrão). */
export const roleName = (role: RoleKey, { t }: I18n = PT): string => t(`providers.role.${role}.name`);
export const roleVolume = (role: RoleKey, { t }: I18n = PT): string => t(`providers.role.${role}.volume`);

const role = (key: RoleKey, tone: RoleDef['tone']): RoleDef => ({ key, name: roleName(key), volume: roleVolume(key), tone });
/** Papéis com nome/volume em português; a tela traduz por `roleName`/`roleVolume`. */
export const ROLES: readonly RoleDef[] = [role('lider', 'grey'), role('worker', 'green'), role('esc', 'dark')];

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

export function testResultFor(mode: ProviderMode, { t, fmt }: I18n = PT): readonly TestResultRow[] {
  const local = mode === 'local';
  return [
    { label: t('providers.result.latency'), value: local ? '410 ms' : `${fmt.decimal(1.2)} s` },
    { label: t('providers.result.tps'), value: local ? '88' : '64' },
    { label: t('providers.result.args'), value: t('providers.result.argsOk') },
    { label: t('providers.result.tool'), value: 'android_conta1_get_screen_state' },
  ];
}
