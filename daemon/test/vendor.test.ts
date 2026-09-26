import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config.js';

/** Guarda contra corrupção do binário empacotado (ou um ponteiro git-lfs no lugar do arquivo real). */
describe('scrcpy-server empacotado', () => {
  it('tamanho e sha256 batem com CONFIG.scrcpy', () => {
    const path = CONFIG.scrcpy.serverPath;
    expect(statSync(path).size).toBe(733_706);
    const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
    expect(sha256).toBe(CONFIG.scrcpy.sha256);
  });
});
