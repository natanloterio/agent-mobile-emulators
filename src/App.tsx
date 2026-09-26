import { useMemo } from 'react';
import { KillBanner } from './components/KillBanner';
import { MobileBottomNav, MobileTopbar } from './components/MobileChrome';
import { Sidebar } from './components/Sidebar';
import { hostMeters, kvCacheLeftGiB, vramEmulatorShare } from './lib/resources';
import { useIsMobile } from './lib/useIsMobile';
import { liveLogFor, liveRoles, mergeLive } from './live/merge';
import { useLiveFleet } from './live/useLiveFleet';
import { Cockpit } from './screens/Cockpit';
import { Device } from './screens/Device';
import { Identities } from './screens/Identities';
import { NewGoal } from './screens/NewGoal';
import { Providers } from './screens/Providers';
import { Report } from './screens/Report';
import {
  selectCostRows, selectEstimate, selectGoalPct, selectGoalStats, selectIdRows, selectLog, selectNeedsCount,
  selectNeedsList, selectPlanTasks, selectReportCards, selectRoles, selectSelected, selectSelStats, selectTiles,
} from './state/selectors';
import { useFleet } from './state/useFleet';
import './components/Shell.css';

// Parâmetros do design (props do editor). Alvo de 8 vem do spec §3: teto por CPU.
const FLEET_SIZE = 8;
const FULL_TILES = true;
const SHOW_COST = true;

export function App() {
  const { state, actions } = useFleet();
  const isMobile = useIsMobile();
  const { snap: live, frames, bus } = useLiveFleet();

  const mergedIds = useMemo(() => mergeLive(state.ids, live, frames), [state.ids, live, frames]);
  const tiles = useMemo(() => selectTiles({ ...state, ids: mergedIds }, FLEET_SIZE), [state, mergedIds]);
  const sel = selectSelected(tiles, state.sel);
  const needsCount = selectNeedsCount(tiles);
  const meters = useMemo(() => hostMeters(FLEET_SIZE), []);

  const screen = (() => {
    switch (state.screen) {
      case 'cockpit':
        return (
          <Cockpit
            tiles={tiles}
            bus={bus}
            goalStats={selectGoalStats(tiles, FLEET_SIZE, SHOW_COST)}
            goalPct={selectGoalPct(tiles)}
            showCost={SHOW_COST}
            fullTiles={FULL_TILES}
            isMobile={isMobile}
            onOpen={actions.openDevice}
            onKill={() => { actions.kill(); void window.enxame?.kill?.(); }}
            onNew={() => actions.go('new')}
          />
        );
      case 'device':
        return (
          <Device
            sel={sel}
            bus={bus}
            log={liveLogFor(live, sel.name) ?? selectLog(sel)}
            stats={selectSelStats(sel)}
            control={state.control}
            isMobile={isMobile}
            onBack={() => actions.go('cockpit')}
            onToggleControl={actions.toggleControl}
            onTogglePause={actions.togglePause}
            onResolve={actions.resolveSelected}
          />
        );
      case 'new':
        return (
          <NewGoal
            goalText={state.goalText}
            planStage={state.planStage}
            planTasks={selectPlanTasks(tiles)}
            estimate={selectEstimate(tiles, FLEET_SIZE)}
            isMobile={isMobile}
            onSetGoal={actions.setGoal}
            onDecompose={actions.decompose}
            onReset={actions.resetPlan}
            onLaunch={() => { actions.launch(FLEET_SIZE); void window.enxame?.startGoal?.(state.goalText); }}
          />
        );
      case 'report':
        return (
          <Report
            cards={selectReportCards(tiles)}
            needsList={selectNeedsList(tiles)}
            costRows={selectCostRows(tiles)}
            isMobile={isMobile}
            onOpen={actions.openDevice}
          />
        );
      case 'ids':
        return (
          <Identities
            rows={selectIdRows(state, FLEET_SIZE)}
            isMobile={isMobile}
            onProvision={actions.provision}
            onOpen={actions.openDevice}
            onExtraAction={actions.extraAction}
          />
        );
      case 'prov':
        return (
          <Providers
            roles={liveRoles(selectRoles(state), live)}
            fleetSize={FLEET_SIZE}
            kvLeft={kvCacheLeftGiB(FLEET_SIZE)}
            vramEmuShare={vramEmulatorShare(FLEET_SIZE)}
            isMobile={isMobile}
            onPickMode={actions.pickMode}
            onTest={actions.testConnection}
            onSetField={actions.setProviderField}
            onLoadModels={actions.loadProviderModels}
          />
        );
    }
  })();

  return (
    <div className={`shell${isMobile ? ' shell--mobile' : ''}`}>
      {isMobile ? (
        <MobileTopbar meters={meters} />
      ) : (
        <Sidebar screen={state.screen} needsCount={needsCount} meters={meters} onNavigate={actions.go} />
      )}
      <main className="main">
        {state.killed && <KillBanner onResume={actions.resume} />}
        {screen}
      </main>
      {isMobile && <MobileBottomNav screen={state.screen} needsCount={needsCount} onNavigate={actions.go} />}
    </div>
  );
}
