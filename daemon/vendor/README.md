# scrcpy-server v4.1

Binário do servidor Android do scrcpy (Genymobile, Apache-2.0), baixado de
https://github.com/Genymobile/scrcpy/releases/tag/v4.1 (`scrcpy-server-v4.1`).
sha256: deacb991ed2509715160ffdc7907e47b4160eb30d1566217e9047fd5b8850cae

O daemon faz `adb push` dele para `/data/local/tmp/enxame-scrcpy-server.jar` e o executa com
`app_process` (spec inc. 4 §4.1). Para atualizar: baixar a release, atualizar `CONFIG.scrcpy.version`
e `sha256` em `daemon/src/config.ts`, rodar a integração (`ENXAME_INTEGRATION=1`).
