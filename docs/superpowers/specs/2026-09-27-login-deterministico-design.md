# Login pelo daemon, com credenciais fora do modelo

**Data:** 2026-09-27 · **Altera:** spec principal §4.1 ("login uma vez, por humano"): o login continua sob demanda humana, mas quem digita pode ser o daemon.

## Regras
- A senha nunca chega ao LLM, ao banco do daemon nem a log. Fica cifrada pelo `safeStorage` do Electron (chaveiro do SO: GNOME Keyring / KWallet); sem chaveiro real (`basic_text`), recusa guardar.
- Login é um roteiro fixo do daemon (sem modelo): destrava com o PIN, abre o Instagram, preenche usuário e senha pelos campos da tela de login, toca "Log in".
- Uma tentativa por clique. Código, captcha, "confirme que é você" ou senha recusada → `needs-human`, sem retry. Nunca dispara sozinho (sessão caída continua virando `needs-human`).
- Digitação pelo `type_append_text` do MCP: aceita qualquer caractere; o servidor MCP registra só o nome da ferramenta e o tamanho do texto.

## Contrato

**Daemon** `POST /identities/:id/login { username, password }` → `200 { outcome: 'logged-in' | 'already-logged-in' | 'needs-human', detail: string }`. 400 corpo inválido (a mensagem nunca repete o corpo); 409 se a identidade está `running`, `banned`, descartada, sob controle humano, ou com o emulador fora do adb. Síncrono (até ~90 s). Sucesso: estado `logged-in`, handle `@<username>` se ainda era "sem conta" e o username tem forma de @, snapshot salvo.

Esta rota **não** entra na lista de permissão do canal genérico `enxame:api`: só o main do Electron a chama, com a senha que ele decifrou.

**Electron (preload `window.enxame`)**
```ts
credentials: {
  available(): Promise<{ ok: boolean; reason: string | null }>;      // backend do safeStorage
  status(): Promise<Readonly<Record<string, { username: string }>>>; // por id de identidade; nunca a senha
  set(id: string, username: string, password: string): Promise<void>;
  clear(id: string): Promise<void>;
};
login(id: string): Promise<{ outcome: 'logged-in' | 'already-logged-in' | 'needs-human'; detail: string }>;
```
Arquivo: `<userData>/credentials.json` com `{ version: 1, entries: { [id]: { username, secret } } }`, `secret` = senha cifrada (base64). Username em claro (não é segredo e a tela o mostra).

## Resultado (2026-09-27)

- Cofre: `safeStorage` disponível nesta máquina (GNOME Keyring); `credentials.json` em 0600, sem a senha em claro. Senha ausente do banco, dos steps, dos logs do daemon/Electron e do logcat.
- Login real na conta2 pela tela: o daemon preencheu e tocou "Log in" em 18 s. Depois disso o Android ofereceu guardar a senha no gerenciador do Google e, por trás, o Instagram pediu **verificação da conta** ("Choose a way to confirm your account").
- Defeito achado e corrigido: o roteiro declarou sucesso com o diálogo do Android na frente. Agora recusa o diálogo de senha, trata a verificação de conta como desafio (`needs-human`, sem tocar nela) e só declara sucesso com o próprio Instagram na frente.
