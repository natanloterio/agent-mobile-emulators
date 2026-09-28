import { describe, expect, it } from 'vitest';
import { PT, createI18n } from '../i18n/translate';
import { LOCAL_MODELS } from './catalog';
import { INITIAL_STATE, type OnboardingState } from './reducer';
import type { DepStatus, SetupReport } from './schema';
import {
  defaultMode, defaultModel, depRows, emulatorCapacity, footerView, formatMb, installTotals, ipcErrorText, jobsToInstall, modelFit, shouldApplyRoles, summarize, vramBar,
} from './view';

const dep = (id: DepStatus['id'], state: DepStatus['state'], over: Partial<DepStatus> = {}): DepStatus => ({ id, state, version: null, sizeMb: null, fix: null, ...over });
const rtx = { name: 'RTX 4090', totalGiB: 24, unified: false };
const hw = { ramGiB: 64, threads: 32, cpuModel: 'Ryzen', gpu: rtx, diskFreeGiB: 412 };
const partial: SetupReport = {
  deps: [dep('sdk', 'ok'), dep('adb', 'ok'), dep('emu', 'ok'), dep('img', 'todo', { sizeMb: 1600 }), dep('kvm', 'ok'), dep('ollama', 'ok'), dep('keyring', 'ok')],
  hardware: hw, localModels: ['qwen3:14b'], imageAbi: 'x86_64',
};
const model = (id: string) => LOCAL_MODELS.find((m) => m.id === id)!;
const st = (over: Partial<OnboardingState>): OnboardingState => ({ ...INITIAL_STATE, report: partial, ...over });

describe('depRows', () => {
  it('insere o modelo logo depois do Ollama, com o tamanho do catálogo quando falta', () => {
    const rows = depRows(partial, 'misto', 'gpt-oss:20b');
    expect(rows.map((r) => r.id)).toEqual(['sdk', 'adb', 'emu', 'img', 'kvm', 'ollama', 'model', 'keyring']);
    expect(rows[6]).toMatchObject({ id: 'model', state: 'todo', sizeMb: 14000 });
  });
  it('modelo já baixado fica ok', () => {
    expect(depRows(partial, 'local', 'qwen3:14b').find((r) => r.id === 'model')).toMatchObject({ state: 'ok', version: 'qwen3:14b' });
  });
  it('só nuvem tira Ollama e modelo', () => {
    expect(depRows(partial, 'nuvem', 'gpt-oss:20b').map((r) => r.id)).not.toContain('ollama');
    expect(depRows(partial, 'nuvem', 'gpt-oss:20b').map((r) => r.id)).not.toContain('model');
  });
});

describe('summarize e jobsToInstall', () => {
  it('conta estados e soma o download', () => {
    const rows = depRows(partial, 'misto', 'gpt-oss:20b');
    expect(summarize(rows)).toEqual({ total: 8, ok: 6, todo: 2, user: 0, downloadMb: 15600 });
    expect(jobsToInstall(rows)).toEqual(['img', 'model']);
  });
});

describe('hardware', () => {
  it('capacidade pelo menor entre CPU (4 threads) e RAM (4,6 GB)', () => {
    expect(emulatorCapacity(hw)).toEqual({ count: 8, limit: 'cpu' });
    expect(emulatorCapacity({ ...hw, ramGiB: 16 })).toEqual({ count: 3, limit: 'ram' });
    expect(emulatorCapacity({ ...hw, threads: 0 })).toEqual({ count: 0, limit: 'cpu' });
  });
  it('encaixe do modelo na placa', () => {
    expect(modelFit(model('gpt-oss:20b'), rtx)).toBe('fits');
    expect(modelFit(model('qwen3:32b'), rtx)).toBe('too-big');
    expect(modelFit(model('qwen3:32b'), { name: 'x', totalGiB: 26, unified: false })).toBe('tight');
    expect(modelFit(model('gpt-oss:20b'), null)).toBe('cpu');
  });
  it('padrões: com GPU misto e o recomendado; sem GPU só nuvem; placa pequena pega o maior que cabe', () => {
    expect(defaultMode(rtx)).toBe('misto');
    expect(defaultMode(null)).toBe('nuvem');
    expect(defaultModel(rtx)).toBe('gpt-oss:20b');
    expect(defaultModel({ name: 'x', totalGiB: 16, unified: false })).toBe('qwen3:14b');
    expect(defaultModel(null)).toBe('gpt-oss:20b');
  });
  it('barra de VRAM', () => {
    const b = vramBar(model('gpt-oss:20b'), rtx)!;
    expect(b.systemPct).toBeCloseTo(5);
    expect(b.modelPct).toBeCloseTo(66.67, 1);
    expect(b.freeGiB).toBe(6.8);
    expect(vramBar(model('gpt-oss:20b'), null)).toBeNull();
  });
});

describe('installTotals', () => {
  it('soma o que foi baixado e diz se falhou ou terminou', () => {
    const t = installTotals(['img', 'model'], {
      img: { id: 'img', state: 'done', doneMb: 1600, totalMb: 1600, error: null },
      model: { id: 'model', state: 'err', doneMb: 8540, totalMb: 14000, error: { kind: 'disk-full', message: 'sem espaço' } },
    }, { img: 1600, model: 14000 });
    expect(t).toEqual({ doneMb: 10140, totalMb: 15600, doneCount: 1, count: 2, failed: true, allDone: false });
  });
  it('item sem evento ainda conta pelo tamanho estimado', () => {
    expect(installTotals(['img'], {}, { img: 1600 })).toEqual({ doneMb: 0, totalMb: 1600, doneCount: 0, count: 1, failed: false, allDone: false });
    expect(installTotals([], {}, {}).allDone).toBe(true);
  });
});

describe('formatMb e ipcErrorText', () => {
  it('MB até 1000, GB depois, no formato do idioma', () => {
    expect(formatMb(14, PT)).toBe('14 MB');
    expect(formatMb(15600, PT)).toBe('15,6 GB');
    expect(formatMb(15600, createI18n('en'))).toBe('15.6 GB');
  });
  it('tira o prefixo do Electron', () => {
    expect(ipcErrorText(new Error("Error invoking remote method 'tapflock:setup:finish': Error: daemon não respondeu em 15 s"))).toBe('daemon não respondeu em 15 s');
    expect(ipcErrorText('x')).toBe('x');
  });
});

describe('footerView', () => {
  it('passo 1: bloqueia com item que precisa de você; senão diz quantos itens vêm', () => {
    const needs = { ...partial, deps: partial.deps.map((d) => (d.id === 'kvm' ? dep('kvm', 'user', { fix: 'kvm-group' }) : d)) };
    expect(footerView(st({ report: needs }), PT)).toMatchObject({ disabled: true, hint: 'Resolva o item marcado para continuar' });
    expect(footerView(st({ model: 'gpt-oss:20b' }), PT)).toMatchObject({ disabled: false, action: 'Continuar', hint: 'Itens para instalar no próximo passo: 2' });
    expect(footerView(st({ report: null, checking: true }), PT)).toMatchObject({ disabled: true, hint: 'Verificando a máquina…' });
  });
  it('passo 2: Instalar com o download; aviso de disco curto; modelo que não cabe bloqueia', () => {
    expect(footerView(st({ step: 1, model: 'gpt-oss:20b' }), PT)).toMatchObject({ action: 'Instalar', hint: '15,6 GB de download', disabled: false });
    const lowDisk = { ...partial, hardware: { ...hw, diskFreeGiB: 10 } };
    expect(footerView(st({ step: 1, report: lowDisk, model: 'gpt-oss:20b' }), PT).hint).toBe('15,6 GB de download, mas só 10,0 GB livres em disco');
    expect(footerView(st({ step: 1, model: 'qwen3:32b' }), PT).disabled).toBe(true);
  });
  it('passo 3: espera terminar; erro bloqueia; tudo pronto libera; configurando bloqueia', () => {
    const running = st({ step: 2, model: 'qwen3:14b', installing: true, jobs: { img: { id: 'img', state: 'run', doneMb: 800, totalMb: 1600, error: null } } });
    expect(footerView(running, PT)).toMatchObject({ disabled: true, hint: 'Instalando…', backDisabled: true });
    const failed = st({ step: 2, model: 'qwen3:14b', jobs: { img: { id: 'img', state: 'err', doneMb: 800, totalMb: 1600, error: { kind: 'network', message: 'x' } } } });
    expect(footerView(failed, PT)).toMatchObject({ disabled: true, hint: 'A instalação parou. Veja o aviso acima.' });
    const done = st({ step: 2, model: 'qwen3:14b', jobs: { img: { id: 'img', state: 'done', doneMb: 1600, totalMb: 1600, error: null } } });
    expect(footerView(done, PT)).toMatchObject({ disabled: false, hint: 'Instalação concluída' });
    expect(footerView({ ...done, finishing: true }, PT)).toMatchObject({ disabled: true, action: 'Configurando…' });
    expect(footerView({ ...done, finishError: '409' }, PT)).toMatchObject({ disabled: false, hint: 'Não deu para configurar os papéis: 409' });
  });
  it('passo 4: abre o Cockpit, sem Voltar', () => {
    expect(footerView(st({ step: 3 }), PT)).toMatchObject({ action: 'Abrir o Cockpit', showBack: false, disabled: false });
  });
});

describe('shouldApplyRoles', () => {
  it('primeira execução sempre aplica os papéis', () => {
    expect(shouldApplyRoles(true, st({}))).toBe(true);
  });
  it('reabertura só aplica se a pessoa mexeu em modo ou modelo', () => {
    expect(shouldApplyRoles(false, st({}))).toBe(false);
    expect(shouldApplyRoles(false, st({ modeTouched: true }))).toBe(true);
    expect(shouldApplyRoles(false, st({ modelTouched: true }))).toBe(true);
  });
});
