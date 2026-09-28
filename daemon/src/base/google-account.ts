import type { DatabaseSync } from 'node:sqlite';
import { memoryPut } from '../db/missions.js';
import type { Vault } from '../vault/vault.js';

/** Senha da conta Google no cofre; o e-mail vai no `meta` (listável sem abrir o segredo). */
export const GOOGLE_PASSWORD_ENTRY = 'google:password';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isEmail = (s: string): boolean => EMAIL.test(s) && s.length <= 254;

export async function saveGoogleAccount(vault: Vault, email: string, password: string): Promise<void> {
  await vault.put(GOOGLE_PASSWORD_ENTRY, password, email.trim());
}

/** E-mail da conta guardada, ou null. Nunca devolve a senha. */
export async function googleAccountEmail(vault: Vault): Promise<string | null> {
  const e = (await vault.list('google:')).find((x) => x.id === GOOGLE_PASSWORD_ENTRY);
  return e?.meta ?? null;
}

/** A missão digita a senha com `type_secret google.password`; o valor vem do cofre e é mascarado nos logs. */
export function seedGoogleMemory(db: DatabaseSync, missionId: string, email: string): void {
  memoryPut(db, missionId, 'google.email', email);
  memoryPut(db, missionId, 'google.password', GOOGLE_PASSWORD_ENTRY, true);
}

/**
 * Objetivo da missão no celular-base: só entrar na Play Store e instalar o app. A conta Google sai depois por um
 * caminho fixo das Configurações (google-remove.ts), sem modelo: um modelo pequeno se perdia nesse trecho.
 */
export function baseMissionText(lang: string, targetPackage: string): string {
  if (lang.startsWith('pt')) {
    return [
      `Instale o app Instagram (pacote ${targetPackage}) pela Play Store deste celular.`,
      '1) Abra a Play Store e entre na conta Google cujo e-mail está na memória google.email; a senha está no segredo google.password (digite com type_secret).',
      '2) Busque "Instagram", instale e espere a instalação terminar. Não abra o Instagram nem crie conta nele.',
      'Termine quando o Instagram estiver instalado. Não mexa nas contas do aparelho: o Tapflock remove a conta Google depois. Se o Google pedir código, telefone ou outra verificação, peça ajuda humana.',
    ].join('\n');
  }
  return [
    `Install the Instagram app (package ${targetPackage}) from this phone's Play Store.`,
    '1) Open the Play Store and sign in to the Google account whose email is in memory google.email; the password is in secret google.password (type it with type_secret).',
    '2) Search "Instagram", install it and wait for the install to finish. Do not open Instagram or create an account in it.',
    'Finish when Instagram is installed. Do not touch the phone accounts: Tapflock removes the Google account afterwards. If Google asks for a code, phone or other verification, ask for human help.',
  ].join('\n');
}
