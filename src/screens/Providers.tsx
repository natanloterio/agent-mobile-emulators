import { useEffect } from 'react';
import { Heading } from '../components/Heading';
import type { RoleVM } from '../state/selectors';
import type { ProviderMode, RoleKey } from '../types/fleet';
import { shouldSubmitEndpoint } from './endpointSubmit';
import './Providers.css';

interface ProvidersProps {
  readonly roles: readonly RoleVM[];
  readonly fleetSize: number;
  readonly kvLeft: string;
  readonly vramEmuShare: string;
  readonly isMobile: boolean;
  readonly onPickMode: (role: RoleKey, mode: ProviderMode) => void;
  readonly onTest: (role: RoleKey) => void;
  readonly onSetField: (role: RoleKey, patch: { model?: string; endpoint?: string }) => void;
  readonly onLoadModels: (role: RoleKey) => void;
}

const MODES: readonly { readonly key: ProviderMode; readonly label: string }[] = [
  { key: 'nuvem', label: 'Nuvem' },
  { key: 'local', label: 'Local' },
];

export function Providers({ roles, fleetSize, kvLeft, vramEmuShare, isMobile, onPickMode, onTest, onSetField, onLoadModels }: ProvidersProps) {
  // Recarrega a lista de modelos quando a tela abre e quando algum papel troca de modo.
  const modeKey = roles.map((r) => `${r.key}:${r.mode}`).join('|');
  useEffect(() => { roles.forEach((r) => onLoadModels(r.key)); }, [modeKey]);

  return (
    <div className="screen">
      <header className="screen__title">
        <Heading size={isMobile ? 'h3' : 'h2'}>Provedores</Heading>
        <p className="screen__lede">Modelo configurado por papel, não global. Local ganha onde há volume: no worker.</p>
      </header>

      <div className="roles">
        {roles.map((r) => (
          <div className={`card card--${r.tone} card--shadow role`} key={r.key}>
            <div className="role__head"><span className="role__name">{r.name}</span><span className="role__volume">{r.volume}</span></div>
            <div className="role__toggle" role="radiogroup" aria-label={`Provedor do papel ${r.name}`}>
              {MODES.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  role="radio"
                  aria-checked={r.mode === m.key}
                  className={`role__mode${r.mode === m.key ? ' role__mode--active' : ''}`}
                  onClick={() => onPickMode(r.key, m.key)}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <label className="role__field"><span>Modelo</span>
              <select className="role__select" value={r.model} onChange={(e) => onSetField(r.key, { model: e.target.value })} aria-label={`Modelo do papel ${r.name}`}>
                {(r.models.includes(r.model) ? r.models : [r.model, ...r.models]).map((m) => (
                  <option key={m} value={m}>{m === r.model && !r.models.includes(m) ? `${m} (atual)` : m}</option>
                ))}
              </select>
            </label>
            {r.mode === 'local' ? (
              <label className="role__field"><span>Endpoint</span>
                <input className="role__input" defaultValue={r.endpoint} key={r.endpoint} aria-label={`Endpoint do papel ${r.name}`}
                  onBlur={(e) => { if (shouldSubmitEndpoint(e.target.value, r.endpoint, r.putError)) onSetField(r.key, { endpoint: e.target.value }); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
              </label>
            ) : (
              <div className="role__field"><span>Endpoint</span><div className="role__box role__box--mono">{r.endpoint}</div></div>
            )}
            {r.error && <div className="role__error" role="alert">{r.error}</div>}
            <button
              type="button"
              className={`role__test${r.key === 'esc' ? ' role__test--green' : ''}`}
              onClick={() => onTest(r.key)}
              disabled={r.testing}
            >
              {r.testLabel}
            </button>
            {r.result && (
              <div className="role__result">
                {r.result.map((x) => (
                  <div className="role__result-row" key={x.label}><span>{x.label}</span><b>{x.value}</b></div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="card card--grey vram">
        <div className="row-between">
          <Heading size="h4" variant="black">VRAM disputada · 32 GB</Heading>
          <span className="muted-15">KV cache restante: <b>{kvLeft}</b> para {fleetSize} sequências de ~13k tokens</span>
        </div>
        <div className="vram__stack" aria-label="Distribuição da VRAM">
          <div className="vram__seg vram__seg--emu" style={{ width: vramEmuShare }}>Emuladores</div>
          <div className="vram__seg vram__seg--weights" style={{ width: '59%' }}>Pesos 30B 4-bit · 19 GiB</div>
          <div className="vram__seg vram__seg--kv">KV</div>
        </div>
        <span className="vram__floor">
          Piso de qualidade: 3 erros de tool call numa tarefa → worker escala para nuvem e a tarefa fica marcada como degradada.
        </span>
      </div>
    </div>
  );
}
