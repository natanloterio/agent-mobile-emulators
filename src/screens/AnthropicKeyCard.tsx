import { useCallback, useEffect, useState } from 'react';
import { Button } from '../components/Button';
import { Heading } from '../components/Heading';
import { Notice } from '../components/Notice';
import { useI18n } from '../i18n/I18nProvider';
import { useDaemonStatus } from '../live/daemonStatus';
import type { MessageKey } from '../i18n/messages';
import { KeyTestSchema } from '../onboarding/schema';
import { ipcErrorText } from '../onboarding/view';
import { keyNotice, parseKeyStatus, type KeyStatus } from './anthropicKey';

type Phase = 'idle' | 'busy' | 'saved' | 'savedEnvWins' | 'invalid' | 'network' | 'failed';
const PHASE_MSG: Partial<Record<Phase, MessageKey>> = {
  saved: 'providers.key.saved', savedEnvWins: 'providers.key.savedEnvWins', invalid: 'onboarding.key.invalid', network: 'onboarding.key.network',
};

/** Chave da Anthropic depois do onboarding: testa antes de gravar, e a resposta do daemon nunca traz a chave. */
export function AnthropicKeyCard({ anyCloudRole }: { readonly anyCloudRole: boolean }) {
  const { t } = useI18n();
  const bridge = window.tapflock;
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [key, setKey] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  // Relê quando o daemon fica pronto: aberta antes dele subir, a tela ficaria sem saber da chave.
  const daemonState = useDaemonStatus().status?.state;
  const load = useCallback(() => {
    void bridge?.anthropicKey?.status().then((raw) => setStatus(parseKeyStatus(raw)), () => setStatus(null));
  }, [bridge]);
  useEffect(load, [load, daemonState]);

  if (!bridge?.anthropicKey || !bridge.setup) return null;
  const { anthropicKey, setup } = bridge;

  const save = async () => {
    setPhase('busy'); setError(null);
    try {
      const test = KeyTestSchema.safeParse(await setup.testKey(key.trim()));
      const result = test.success ? test.data.result : 'invalid';
      if (result !== 'ok') { setPhase(result); return; }
      await anthropicKey.set(key.trim());
      // A variável de ambiente vence o cofre (ApiKeyStore.current): a chave nova só vale sem ela.
      setKey(''); setPhase(status?.source === 'env' ? 'savedEnvWins' : 'saved'); load();
    } catch (e) { setPhase('failed'); setError(ipcErrorText(e)); }
  };

  const notice = status && keyNotice(status, anyCloudRole);
  const msg = PHASE_MSG[phase];
  return (
    <section className="card card--white card--shadow keycard" aria-label={t('providers.key.title')}>
      <Heading size="h4">{t('providers.key.title')}</Heading>
      {notice && (notice.tone === 'error' ? <Notice>{t(notice.key)}</Notice> : <p className="keycard__status">{t(notice.key)}</p>)}
      <form className="keycard__row" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <input
          className="role__input keycard__input" type="password" autoComplete="off" placeholder="sk-ant-…"
          aria-label={t('providers.key.input')} value={key} onChange={(e) => { setKey(e.target.value); setPhase('idle'); }}
        />
        <Button type="submit" disabled={!key.trim() || phase === 'busy'}>{t(phase === 'busy' ? 'providers.key.saving' : 'providers.key.save')}</Button>
      </form>
      {msg && <p role="status" className={phase === 'saved' ? 'keycard__ok' : 'keycard__bad'}>{t(msg)}</p>}
      {phase === 'failed' && error && <Notice>{t('providers.key.saveFailed', { error })}</Notice>}
    </section>
  );
}
