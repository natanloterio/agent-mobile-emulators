import { useMemo } from 'react';
import { KillBanner } from './components/KillBanner';
import { MobileBottomNav, MobileTopbar } from './components/MobileChrome';
import { Sidebar } from './components/Sidebar';
import { CURRENT_GOAL_TEXT, DEFAULT_GOAL_TEXT, PAST_GOALS } from './data/goals';
import { kvCacheLeftGiB, liveVram, vramEmulatorShare } from './lib/resources';
import { useIsMobile } from './lib/useIsMobile';
import { liveRoles } from './live/merge';
import { useLiveFleet } from './live/useLiveFleet';
import { Cockpit } from './screens/Cockpit';
import { Device } from './screens/Device';
import { Identities } from './screens/Identities';
import { NewGoal } from './screens/NewGoal';
import { Providers } from './screens/Providers';
import { Report } from './screens/Report';
import { requestOf } from './state/fleetReducer';
import { buildDeviceView, buildFleetView } from './state/fleetView';
import { selectLiveIdRows, type IdRow, type RowAction } from './state/idRows';
import {
  selectGoalHeader, selectLiveGoalPct, selectLiveGoalStats, selectLiveReportCards, selectPastGoalRows,
} from './state/liveSelectors';
import { selectDemoPlanVM, selectPlanVM } from './state/planView';
import {
  selectCostRows, selectGoalPct, selectGoalStats, selectIdRows, selectNeedsList, selectReportCards, selectRoles, selectSelected,
} from './state/selectors';
import { useFleet } from './state/useFleet';
import './components/Shell.css';

// Parâmetros do design (props do editor).
const FULL_TILES = true;
const SHOW_COST = true;
const DEMO_HEADER = { kicker: 'Objetivo em execução · fan-out replicado', title: CURRENT_GOAL_TEXT };
const DEMO_PAST = PAST_GOALS.map((g) => ({ ...g, key: g.text }));

export function App() {
  const { state, actions, bridged, goal, identity } = useFleet();
  const isMobile = useIsMobile();
  const { snap: live, frames, bus } = useLiveFleet();

  const view = useMemo(() => buildFleetView(state, live, frames, bridged), [state, live, frames, bridged]);
  const { isLive, tiles, fleetSize } = view;
  const sel = tiles.length ? selectSelected(tiles, state.sel) : undefined;

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
      goalHeader={isLive ? selectGoalHeader(view.goal) : DEMO_HEADER}
      goalStats={isLive ? selectLiveGoalStats(view.goal, SHOW_COST) : selectGoalStats(tiles, fleetSize, SHOW_COST)}
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
        const d = buildDeviceView(state, view, live, sel);
        const id = sel.id ?? '';
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
          />
        );
      }
      case 'new':
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
          />
        );
      case 'report':
        return (
          <Report
            cards={isLive ? selectLiveReportCards(view.goal) : selectReportCards(tiles)}
            needsList={selectNeedsList(tiles)}
            costRows={selectCostRows(tiles)}
            pastGoals={isLive ? (state.pastGoals && selectPastGoalRows(state.pastGoals)) : DEMO_PAST}
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
            rows={isLive ? selectLiveIdRows(live?.identities ?? [], state.requests, Date.now()) : selectIdRows(state, fleetSize)}
            isMobile={isMobile}
            provisionReq={requestOf(state, 'provision')}
            onProvision={(pin) => (isLive ? void identity.provision(pin) : actions.provision())}
            onAction={onRowAction}
            onLoginDone={(id, handle) => void identity.loginDone(id, handle)}
            onRegisterPin={(id, pin) => void identity.registerPin(id, pin)}
          />
        );
      case 'prov': {
        const vram = isLive ? liveVram(live?.host, fleetSize) : null;
        return (
          <Providers
            roles={liveRoles(selectRoles(state), live)}
            fleetSize={fleetSize}
            kvLeft={vram?.kvLeft ?? kvCacheLeftGiB(fleetSize)}
            vramEmuShare={vram?.emuShare ?? vramEmulatorShare(fleetSize)}
            vramTotal={vram?.total ?? '32 GB'}
            isMobile={isMobile}
            onPickMode={actions.pickMode}
            onTest={actions.testConnection}
            onSetField={actions.setProviderField}
            onLoadModels={actions.loadProviderModels}
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
        <Sidebar screen={state.screen} needsCount={view.needsCount} meters={view.meters} onNavigate={actions.go} />
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
