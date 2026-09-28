import { useEffect, useState } from 'react';
import { App } from './App';
import { Onboarding } from './onboarding/Onboarding';
import { SetupStatusSchema } from './onboarding/schema';
import type { Screen } from './types/fleet';

type Phase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'onboarding'; readonly reopened: boolean }
  | { readonly kind: 'app'; readonly startScreen: Screen | null };

/**
 * Decide entre o onboarding (primeira execução, spec onboarding) e o app. Sem a ponte de setup (navegador, preload
 * antigo) ou se o main não responder, abre o app como antes: o onboarding nunca pode trancar quem já usa o Tapflock.
 * O atalho de Provedores só aparece onde o onboarding tem suporte (Linux x86_64); "Voltar ao app" volta a Provedores.
 */
export function Root() {
  const setup = window.tapflock?.setup;
  const [phase, setPhase] = useState<Phase>(() => (setup ? { kind: 'loading' } : { kind: 'app', startScreen: null }));
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    if (!setup) return;
    setup.status().then(
      (raw) => {
        const s = SetupStatusSchema.safeParse(raw);
        setSupported(s.success && s.data.supported);
        setPhase(s.success && s.data.supported && !s.data.completed ? { kind: 'onboarding', reopened: false } : { kind: 'app', startScreen: null });
      },
      () => setPhase({ kind: 'app', startScreen: null }),
    );
  }, [setup]);

  if (phase.kind === 'loading') return null;
  if (phase.kind === 'onboarding' && setup) {
    return (
      <Onboarding
        bridge={setup}
        onDone={(screen) => setPhase({ kind: 'app', startScreen: screen })}
        onClose={phase.reopened ? () => setPhase({ kind: 'app', startScreen: 'prov' }) : undefined}
      />
    );
  }
  return (
    <App
      startScreen={phase.kind === 'app' ? phase.startScreen : null}
      onReopenSetup={setup && supported ? () => setPhase({ kind: 'onboarding', reopened: true }) : undefined}
    />
  );
}
