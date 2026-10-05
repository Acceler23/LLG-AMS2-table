// app/build.mjs
// Gera a pasta do aplicativo (nao compactada) em dist/LLG Overlay-win32-x64,
// com o "LLG Overlay.exe" dentro. Uso: npm run build
// O codigo fica em resources/app, em arquivos normais: da pra editar o
// overlay/drivers-config.js direto na pasta gerada.

import { packager } from "@electron/packager";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// O que NAO vai para o aplicativo. O .env de quem compila pode ter outras
// coisas (senha do OBS, portas), entao ele nao e copiado: so a chave do RLT
// e gravada num .env novo dentro do aplicativo (ver o fim deste arquivo).
const ignore = [
  /^\/dist($|\/)/,
  /^\/test($|\/)/,
  /^\/\.git($|\/)/,
  /^\/\.gitignore$/,
  /^\/\.vscode($|\/)/,
  /^\/\.claude($|\/)/,
  /^\/\.env$/,
  /^\/settings\.json$/,
  /^\/drivers-config_bak\.js$/,
  // headers dos jogos: so referencia para desenvolvimento, e os do LMU nao podem ser redistribuidos
  /^\/SharedMemory_LMU($|\/)/,
  /^\/SharedMemory_AMS2\.h$/,
  /^\/start\.bat$/,
  /^\/app\/build\.mjs$/,
  /^\/overlay\/assets\/\.git($|\/)/,
  /\.log$/,
];

// A pasta de saida nao pode estar em uso: com o LLG Overlay.exe aberto a
// partir dela, o Windows nao deixa apagar e o empacotamento falha.
process.on("uncaughtException", (err) => {
  if (err && (err.code === "EBUSY" || err.code === "EPERM")) {
    console.error("Nao foi possivel substituir a pasta dist: ela esta em uso.");
    console.error("Feche o LLG Overlay (e qualquer janela aberta nessa pasta) e rode de novo.");
    process.exit(1);
  }
  throw err;
});

const [outDir] = await packager({
  dir: root,
  name: "LLG Overlay",
  platform: "win32",
  arch: "x64",
  out: path.join(root, "dist"),
  overwrite: true,
  asar: false,
  prune: true,
  ignore,
});

// Chave do RLT da liga embutida no aplicativo, para quem receber a pasta nao
// precisar digitar nada. Vem de RLT_API_KEY (ambiente ou .env da raiz).
// Atencao: qualquer pessoa com a pasta consegue ler essa chave.
function readRltKey() {
  if (process.env.RLT_API_KEY) return process.env.RLT_API_KEY.trim();
  try {
    const m = fs.readFileSync(path.join(root, ".env"), "utf8").match(/^\s*RLT_API_KEY\s*=\s*(\S+)/m);
    return m ? m[1].replace(/^["']|["']$/g, "") : "";
  } catch {
    return "";
  }
}

const rltKey = readRltKey();
if (rltKey) {
  fs.writeFileSync(
    path.join(outDir, "resources", "app", ".env"),
    `# Gerado pelo build: chave do RLT da liga embutida no aplicativo.\r\nRLT_API_KEY=${rltKey}\r\n`
  );
  console.log("Chave do RLT embutida no aplicativo (resources/app/.env).");
} else {
  console.log("Sem RLT_API_KEY no .env: o aplicativo vai pedir a chave no painel.");
}

fs.writeFileSync(
  path.join(outDir, "LEIA-ME.txt"),
  [
    "LLG Overlay",
    "===========",
    "",
    "1. Abra o \"LLG Overlay.exe\". A janela do painel de controle aparece.",
    "2. No painel, copie os links das overlays e cole como Fonte de Navegador no OBS.",
    "3. Abra o Automobilista 2, o Le Mans Ultimate ou o Assetto Corsa Competizione",
    "   e entre numa sessao.",
    "   Os dados aparecem sozinhos; o programa detecta qual jogo esta em sessao.",
    "",
    "Assetto Corsa Competizione: o jogo precisa estar com a API de transmissao ligada.",
    "Em Documentos\\Assetto Corsa Competizione\\Config\\broadcasting.json deixe",
    "\"updListenerPort\": 9000 e reabra o jogo.",
    "",
    "Racing League Tools: escolha a temporada no topo do painel e clique em Aplicar.",
    "A temporada fica salva para a proxima vez.",
    "",
    "Tabela do piloto: no painel, marque \"Mostrar sobre o jogo\". O jogo precisa",
    "estar em modo janela sem bordas (em tela cheia exclusiva a janela nao aparece).",
    "",
    "Cores, logos e tabela de pontos: edite resources\\app\\overlay\\drivers-config.js",
    "e reabra o programa.",
    "",
    "Na primeira vez o Windows pode avisar que o aplicativo e desconhecido",
    "(SmartScreen), porque ele nao e assinado. Clique em \"Mais informacoes\" e",
    "\"Executar assim mesmo\".",
    "",
  ].join("\r\n")
);

console.log("Aplicativo gerado em:", outDir);
