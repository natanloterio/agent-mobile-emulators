import { useMemo } from 'react';
import { KillBanner } from './components/KillBanner';
import { MobileBottomNav, MobileTopbar } from './components/MobileChrome';
import { Sidebar } from './components/Sidebar';
import { demoMission } from './data/missions';
import { currentGoalText, DEFAULT_GOAL_TEXT, PAST_GOALS } from './data/goals';
import { useI18n } from './i18n/I18nProvider';
import { gpuBar } from './lib/gpuBar';
import { kvCacheLeftGiB, liveVram, vramEmulatorShare } from './lib/resources';
import { vramMeasured } from './lib/platformMeters';
import { useIsMobile } from './lib/useIsMobile';
import { liveRoles } from './live/merge';
import { useLiveFleet } from './live/useLiveFleet';
import { Cockpit } from './screens/Cockpit';
import { Device } from './screens/Device';
import { Identities, type CredentialHandlers } from './screens/Identities';
import type { MissionIdentityOption } from './screens/MissionComposer';
import { NewGoal } from './screens/NewGoal';
import { Providers } from './screens/Providers';
import { Report } from './screens/Report';
import { requestOf } from './state/fleetReducer';
import { buildDeviceView, buildFleetView } from './state/fleetView';
import { selectLiveIdRows, type IdRow, type RowAction } from './state/idRows';
import {
  selectGoalHeader, selectLiveGoalPct, selectLiveGoalStats, selectLiveReportCards, selectPastGoalRows,
} from './state/liveSelectors';
import { isOpenMission, missionForIdentity } from './state/missionView';
import { missionKey, MISSION_START_KEY } from './state/missionActions';
import { selectDemoPlanVM, selectPlanVM } from './state/planView';
import {
  selectCostRows, selectGoalPct, selectGoalStats, selectIdRows, selectNeedsList, selectReportCards, selectRoles, selectSelected,
} from './state/selectors';
import { useFleet } from './state/useFleet';
import './components/Shell.css';

// Parâmetros do design (props do editor).
const FULL_TILES = true;
const SHOW_COST = true;
const DEMO_PAST = PAST_GOALS.map((g) => ({ ...g, key: g.text }));

export function App() {
  const { state, actions, bridged, goal, identity, credentials, mission, settings } = useFleet();
  const isMobile = useIsMobile();
  const { snap: live, frames, bus } = useLiveFleet();
  const i18n = useI18n();
  const { t } = i18n;

  const view = useMemo(() => buildFleetView(state, live, frames, bridged, i18n), [state, live, frames, bridged, i18n]);
  const { isLive, tiles, fleetSize } = view;
  const sel = tiles.length ? selectSelected(tiles, state.sel) : undefined;

  // Estável: a tela recarrega o status num efeito que depende desta referência.
  const credHandlers = useMemo<CredentialHandlers>(() => ({
    load: () => void credentials.load(),
    open: (id) => credentials.prepare(id),
    save: (id, u, p) => void credentials.save(id, u, p),
    forget: (id, name) => void credentials.forget(id, name),
    login: (id) => void credentials.login(id),
  }), [credentials]);

  const onRowAction = (r: IdRow, a: RowAction) => {
    if (a.kind === 'open' && a.index !== undefined && a.index >= 0) { actions.openDevice(a.index); return; }
    if (a.kind === 'extra' && a.index !== undefined) { actions.extraAction(a.index); return; }
    if (!r.id) return;
    if (a.kind === 'boot-window' || a.kind === 'boot') void identity.boot(r.id, a.kind === 'boot-window');
    else if (a.kind === 'discard') void identity.discard(r.id, r.name);
    else if (a.kind === 'restore') void identity.restore(r.id, r.name);
    else if (a.kind === 'rebaseline') void identity.rebaseline(r.id);
  };

  const cockpit = () => (
    <Cockpit
      tiles={tiles}
      bus={bus}
      goalHeader={isLive
        ? selectGoalHeader(view.goal, i18n)
        : { kicker: t('cockpit.goal.running', { pattern: t('cockpit.demo.pattern') }), title: currentGoalText(i18n) }}
      goalStats={isLive ? selectLiveGoalStats(view.goal, SHOW_COST, i18n) : selectGoalStats(tiles, fleetSize, SHOW_COST, i18n)}
      goalPct={isLive ? selectLiveGoalPct(view.goal) : selectGoalPct(tiles)}
      showCost={SHOW_COST}
      fullTiles={FULL_TILES}
      isMobile={isMobile}
      empty={view.empty}
      killError={requestOf(state, 'kill').error}
      onOpen={actions.openDevice}
      onKill={() => (isLive ? void goal.kill() : actions.kill())}
      onNew={() => actions.go('new')}
      onProvision={() => actions.go('ids')}
    />
  );

  const screen = (() => {
    switch (state.screen) {
      case 'cockpit':
        return cockpit();
      case 'device': {
        if (!sel) return cockpit();
        const d = buildDeviceView(state, view, live, sel, i18n);
        const id = sel.id ?? '';
        const m = isLive ? missionForIdentity(live, sel.id) : state.sel === 0 ? demoMission(i18n) : null;
        const mReq = m ? requestOf(state, missionKey(m.id)) : null;
        return (
          <Device
            sel={sel}
            bus={bus}
            {...d}
            isMobile={isMobile}
            onBack={() => actions.go('cockpit')}
            onToggleControl={() => (isLive ? void identity.setControl(id, !d.control) : actions.toggleControl())}
            onTogglePause={() => (isLive ? void identity.pause(id, !d.paused) : actions.togglePause())}
            onResolve={() => (isLive ? void identity.resolve(id) : actions.resolveSelected())}
            onBan={isLive ? () => void identity.ban(id, sel.name, sel.error) : undefined}
            onInput={isLive ? (g) => void identity.input(id, g) : undefined}
            mission={m}
            missionBusy={mReq?.busy}
            missionError={mReq?.error ?? null}
            onMission={isLive && m ? (a) => void mission.act(m.id, a, m.text) : undefined}
          />
        );
      }
      case 'new': {
        const options: readonly MissionIdentityOption[] = (live?.identities ?? [])
          .filter((i) => !i.discardedAt && i.state !== 'banned')
          .map((i) => {
            const busyMission = (live?.missions ?? []).some((m) => m.identityId === i.id && isOpenMission(m));
            const disabled = busyMission || !!i.controlled || !!i.paused || i.state === 'running';
            const note = busyMission ? t('mission.state.running') : i.controlled ? t('device.control.release') : i.paused ? t('device.resume') : i.state;
            return { id: i.id, name: i.name, handle: i.handle, disabled, note };
          });
        return (
          <NewGoal
            goalText={state.goalText}
            planStage={state.planStage}
            plan={state.planStage !== 2 ? null : isLive ? (state.plan && selectPlanVM(state.plan)) : selectDemoPlanVM(tiles, fleetSize)}
            planReq={requestOf(state, 'plan')}
            launchReq={requestOf(state, 'launch')}
            isMobile={isMobile}
            onSetGoal={actions.setGoal}
            onDecompose={() => (isLive ? void goal.decompose(state.goalText || DEFAULT_GOAL_TEXT) : actions.decompose())}
            onReset={actions.resetPlan}
            onLaunch={() => (isLive ? state.plan && void goal.launch(state.plan) : actions.launch(fleetSize))}
            mission={isLive ? { options, req: requestOf(state, MISSION_START_KEY), onStart: (id, text) => void mission.start(id, text).then((ok) => { if (ok) actions.go('cockpit'); }) } : undefined}
          />
        );
      }
      case 'report':
        return (
          <Report
            cards={isLive ? selectLiveReportCards(view.goal, i18n) : selectReportCards(tiles)}
            needsList={selectNeedsList(tiles)}
            costRows={selectCostRows(tiles)}
            pastGoals={isLive ? (state.pastGoals && selectPastGoalRows(state.pastGoals, i18n)) : DEMO_PAST}
            pastReq={requestOf(state, 'goals')}
            goalKey={`${view.goal?.id ?? ''}:${view.goal?.state ?? ''}`}
            isMobile={isMobile}
            onOpen={actions.openDevice}
            onLoadGoals={isLive ? () => void goal.loadGoals() : undefined}
          />
        );
      case 'ids':
        return (
          <Identities
            rows={isLive
              ? selectLiveIdRows(live?.identities ?? [], state.requests, Date.now(), i18n, { status: state.credentials, results: state.loginResults })
              : selectIdRows(state, fleetSize, i18n)}
            isMobile={isMobile}
            provisionReq={requestOf(state, 'provision')}
            onProvision={(pin) => (isLive ? void identity.provision(pin) : actions.provision())}
            onAction={onRowAction}
            onLoginDone={(id, handle) => void identity.loginDone(id, handle)}
            onRegisterPin={(id, pin) => void identity.registerPin(id, pin)}
            creds={isLive ? credHandlers : undefined}
          />
        );
      case 'prov': {
        const vram = isLive ? liveVram(live?.host, fleetSize, i18n) : null;
        const budgetsReq = requestOf(state, 'budgets');
        return (
          <Providers
            roles={liveRoles(selectRoles(state, i18n), live, i18n)}
            fleetSize={fleetSize}
            kvLeft={vram?.kvLeft ?? kvCacheLeftGiB(fleetSize, i18n)}
            vramEmuShare={vram?.emuShare ?? vramEmulatorShare(fleetSize)}
            vramTotal={vram?.total ?? '32 GB'}
            gpu={isLive ? gpuBar(live?.host?.gpu, i18n) : null}
            showVram={!isLive || vramMeasured(live?.host)}
            isMobile={isMobile}
            onPickMode={actions.pickMode}
            onTest={actions.testConnection}
            onSetField={actions.setProviderField}
            onLoadModels={actions.loadProviderModels}
            budgets={live?.stepBudgets ? {
              goal: live.stepBudgets.goal,
              mission: live.stepBudgets.mission,
              busy: budgetsReq.busy,
              error: budgetsReq.error,
              onSave: (patch) => void settings.saveBudgets(patch),
            } : null}
          />
        );
      }
    }
  })();

  const resumeReq = requestOf(state, 'resume');
  return (
    <div className={`shell${isMobile ? ' shell--mobile' : ''}`}>
      {isMobile ? (
        <MobileTopbar meters={view.meters} />
      ) : (
        <Sidebar screen={state.screen} needsCount={view.needsCount} meters={view.meters} host={view.host} onNavigate={actions.go} />
      )}
      <main className="main">
        {view.killed && (
          <KillBanner onResume={() => (isLive ? void goal.resume() : actions.resume())} busy={resumeReq.busy} error={resumeReq.error} />
        )}
        {screen}
      </main>
      {isMobile && <MobileBottomNav screen={state.screen} needsCount={view.needsCount} onNavigate={actions.go} />}
    </div>
  );
}
