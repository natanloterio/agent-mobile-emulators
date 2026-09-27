import { useEffect, useState } from 'react';
import { App } from './App';
import { Onboarding } from './onboarding/Onboarding';
import { SetupStatusSchema } from './onboarding/schema';
import type { Screen } from './types/fleet';

type Phase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'onboarding' }
  | { readonly kind: 'app'; readonly startScreen: Screen | null };

/**
 * Decide entre o onboarding (primeira execução, spec onboarding) e o app. Sem a ponte de setup (navegador, preload
 * antigo) ou se o main não responder, abre o app como antes: o onboarding nunca pode trancar quem já usa o Enxame.
 */
export function Root() {
  const setup = window.enxame?.setup;
  const [phase, setPhase] = useState<Phase>(() => (setup ? { kind: 'loading' } : { kind: 'app', startScreen: null }));

  useEffect(() => {
    if (!setup) return;
    setup.status().then(
      (raw) => {
        const s = SetupStatusSchema.safeParse(raw);
        setPhase(s.success && s.data.supported && !s.data.completed ? { kind: 'onboarding' } : { kind: 'app', startScreen: null });
      },
      () => setPhase({ kind: 'app', startScreen: null }),
    );
  }, [setup]);

  if (phase.kind === 'loading') return null;
  if (phase.kind === 'onboarding' && setup) {
    return <Onboarding bridge={setup} onDone={(screen) => setPhase({ kind: 'app', startScreen: screen })} />;
  }
  return (
    <App
      startScreen={phase.kind === 'app' ? phase.startScreen : null}
      onReopenSetup={setup ? () => setPhase({ kind: 'onboarding' }) : undefined}
    />
  );
}
