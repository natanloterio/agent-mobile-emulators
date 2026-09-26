/** Amostra `nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits`; `exec` é injetável para teste. */
export function startVramSampler(exec: () => Promise<string>, everyMs = 2000): { stop(): number } {
  let peak = 0; let active = true;
  const tick = async () => { if (!active) return; const v = Number((await exec().catch(() => '0')).trim()); if (v > peak) peak = v; if (active) setTimeout(tick, everyMs); };
  void tick();
  return { stop: () => { active = false; return peak; } };
}
