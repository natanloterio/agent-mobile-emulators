import { useCallback, useEffect, useRef, useState } from 'react';
import { pointAt } from './point';
import { closesPanel } from './script';
import type { UseGuide } from './useGuide';

export const HELP_BUTTON_ID = 'guide-help';

export interface GuidePanelState {
  readonly open: boolean;
  /** O cartão mudou com o painel fechado: acende o ponto do botão Ajuda. */
  readonly unread: boolean;
  readonly toggle: () => void;
  readonly show: () => void;
  readonly close: () => void;
}

/** O cartão pede a pessoa (verificação, formulário) ou algo falhou: vale abrir o painel sozinho. */
const asksForPerson = (g: UseGuide) =>
  g.step.kind === 'human' || g.step.kind === 'form' || (g.step.milestone !== null && g.progress.milestones[g.step.milestone] === 'failed');

/**
 * Abrir/fechar o painel (spec guia §3.2): abre no fim do onboarding, na primeira vez que o checklist aparece
 * incompleto nesta sessão e quando um passo pede a pessoa; nunca reabre sozinho pelo mesmo cartão depois de fechado.
 */
export function useGuidePanel(guide: UseGuide | null, initialOpen: boolean): GuidePanelState {
  const [open, setOpen] = useState(initialOpen);
  const [unread, setUnread] = useState(false);
  const autoOpened = useRef(new Set<string>());
  const sawIncomplete = useRef(false);
  // Refs: o efeito roda duas vezes no StrictMode e não pode ler um `open` velho nem tratar o mesmo cartão duas vezes.
  const openRef = useRef(open);
  openRef.current = open;
  const lastStep = useRef<string | null>(null);
  const stepId = guide?.step.id ?? null;

  useEffect(() => {
    if (!guide || !stepId || lastStep.current === stepId) return;
    const firstCard = lastStep.current === null;
    const prevStep = lastStep.current;
    lastStep.current = stepId;
    if (closesPanel(prevStep, stepId)) { setOpen(false); return; }
    const first = !sawIncomplete.current && guide.progress.current !== null;
    if (first) sawIncomplete.current = true;
    const ask = asksForPerson(guide) && !autoOpened.current.has(stepId);
    if (first || ask) {
      autoOpened.current.add(stepId);
      setOpen(true);
      return;
    }
    // Só a troca de cartão decide; abrir/fechar à mão não reabre nada.
    // O estado quieto não é novidade: não acende o ponto.
    if (!firstCard && !openRef.current && guide.step.kind !== 'idle') setUnread(true);
  }, [stepId]);

  // Destaque do alvo do cartão, depois de a tela ter desenhado o elemento.
  const point = guide?.step.point;
  useEffect(() => {
    if (!open || !point) return;
    const id = window.setTimeout(() => pointAt(point), 60);
    return () => window.clearTimeout(id);
  }, [open, point, stepId]);

  const show = useCallback(() => { setOpen(true); setUnread(false); }, []);
  // O foco volta ao botão Ajuda (spec guia §8); sem isso ele cairia no body quando o painel some.
  const close = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => document.getElementById(HELP_BUTTON_ID)?.focus());
  }, []);
  const toggle = useCallback(() => setOpen((o) => { if (!o) setUnread(false); return !o; }), []);
  return { open, unread, toggle, show, close };
}
