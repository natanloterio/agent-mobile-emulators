// Hook afterPack do electron-builder (build.afterPack no package.json).
//
// Por que isto existe: o 0.1.0 não tem certificado de assinatura de desenvolvedor Apple, então
// `mac.identity` é `null` e o electron-builder não assina nada por conta própria. Mas no Apple
// Silicon todo binário precisa de ao menos uma assinatura ad-hoc: o electron-builder já alterou o
// Info.plist e outros arquivos do bundle nesta etapa (doPack), o que invalida a assinatura original
// do Electron. Sem reassinar aqui, `Enxame.app` fica com uma assinatura inválida e o macOS recusa
// abrir mesmo com "Abrir Mesmo Assim". Por isso assinamos com `codesign --sign -` (identidade "-" =
// ad-hoc), sem `--timestamp` (não se aplica a ad-hoc e exige rede) e sem hardened runtime (que exigiria
// entitlements extras para uma assinatura ad-hoc). Este hook roda para toda plataforma empacotada
// (afterPack é global no electron-builder), então ele precisa ser inócuo fora do darwin — inclusive
// em pull requests, para que o CI valide este script mesmo sem assinar nada de fato.
//
// context: AfterPackContext (app-builder-lib/out/configuration.d.ts) — usamos
// context.appOutDir, context.packager.appInfo.productFilename e context.electronPlatformName.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

module.exports = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);

  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });

  try {
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
  } catch (error) {
    throw new Error(`assinatura ad-hoc de ${appPath} não passou em \`codesign --verify\`: ${error.message}`);
  }
};
