// server/acInstaller.js
// Instala o app do Assetto Corsa (ac-app/LLGOverlay) na pasta do jogo e o
// ativa, para quem usa a overlay nao precisar copiar nada a mao. So roda
// quando pedido pelo botao do painel (POST /api/ac/install).
//
//  - acha o jogo pelas bibliotecas da Steam;
//  - copia o app se ele nao estiver la ou estiver desatualizado;
//  - ativa em Documentos\Assetto Corsa\cfg\python.ini, so se o app ainda nao
//    estiver listado (quem desligou de proposito continua com ele desligado).
//
// Quem nao tem o jogo nao e afetado: nada e criado.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

const APP_NAME = "LLGOverlay";
const APP_SOURCE = path.join(__dirname, "..", "ac-app", APP_NAME);
const INI_SECTION = "LLGOVERLAY";

function run(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { encoding: "utf8", windowsHide: true, timeout: 10000 }, (err, stdout) => resolve(err ? "" : String(stdout || "")));
  });
}

// Pastas "path" do libraryfolders.vdf da Steam
function parseLibraryFolders(text) {
  const out = [];
  const re = /"path"\s+"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(text || ""))) out.push(m[1].replace(/\\\\/g, "\\"));
  return out;
}

async function findSteamLibraries() {
  const libs = [];
  const out = await run("reg", ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"]);
  const m = /SteamPath\s+REG_SZ\s+(.+)/i.exec(out);
  const steam = m ? m[1].trim() : path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Steam");
  libs.push(steam);
  try {
    parseLibraryFolders(fs.readFileSync(path.join(steam, "steamapps", "libraryfolders.vdf"), "utf8")).forEach((p) => libs.push(p));
  } catch (_) {}
  return libs;
}

async function findGameDir() {
  for (const lib of await findSteamLibraries()) {
    const dir = path.join(lib, "steamapps", "common", "assettocorsa");
    if (fs.existsSync(path.join(dir, "acs.exe"))) return dir;
  }
  return null;
}

async function findDocuments() {
  const out = (await run("powershell.exe", ["-NoProfile", "-Command", "[Environment]::GetFolderPath('MyDocuments')"])).trim();
  return out || path.join(os.homedir(), "Documents");
}

// Copia os arquivos do app que faltam ou mudaram. Devolve true se copiou algo.
function copyApp(gameDir, sourceDir) {
  const target = path.join(gameDir, "apps", "python", APP_NAME);
  let changed = false;
  fs.readdirSync(sourceDir).forEach((name) => {
    const from = path.join(sourceDir, name);
    if (!fs.statSync(from).isFile()) return;
    const data = fs.readFileSync(from);
    const to = path.join(target, name);
    let same = false;
    try {
      same = fs.readFileSync(to).equals(data);
    } catch (_) {}
    if (same) return;
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(to, data);
    changed = true;
  });
  return changed;
}

// Acrescenta a secao do app no python.ini. Devolve o texto novo, ou null se
// o app ja esta listado (ligado ou desligado).
function enableInIni(text) {
  if (new RegExp(`^\\s*\\[${INI_SECTION}\\]`, "im").test(text || "")) return null;
  const base = (text || "").replace(/\s+$/, "");
  return (base ? base + "\r\n\r\n" : "") + `[${INI_SECTION}]\r\nACTIVE=1\r\n`;
}

// Devolve { enabled, active }: se o python.ini foi alterado agora, e se o app
// esta ligado nele.
function enableApp(documentsDir) {
  const cfgDir = path.join(documentsDir, "Assetto Corsa", "cfg");
  if (!fs.existsSync(cfgDir)) return { enabled: false, active: false }; // o jogo nunca foi aberto nesta maquina
  const file = path.join(cfgDir, "python.ini");
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (_) {}
  const next = enableInIni(text);
  if (next === null) {
    const m = new RegExp(`\\[${INI_SECTION}\\]([^\\[]*)`, "i").exec(text);
    return { enabled: false, active: !!m && /^\s*ACTIVE\s*=\s*1/im.test(m[1]) };
  }
  fs.writeFileSync(file, next);
  return { enabled: true, active: true };
}

// options (so para testes): { gameDir, documentsDir, sourceDir }
async function installAcApp(options) {
  const opts = options || {};
  try {
    const sourceDir = opts.sourceDir || APP_SOURCE;
    if (!fs.existsSync(sourceDir)) return { installed: false, reason: "sem-app" };
    const gameDir = opts.gameDir || (await findGameDir());
    if (!gameDir) return { installed: false, reason: "sem-jogo" };
    const copied = copyApp(gameDir, sourceDir);
    const { enabled, active } = enableApp(opts.documentsDir || (await findDocuments()));
    if (copied || enabled) console.log(`Assetto Corsa: app da overlay ${copied ? "instalado" : "ativado"} em ${gameDir}.`);
    return { installed: true, gameDir, copied, enabled, active };
  } catch (err) {
    console.log(`Assetto Corsa: nao foi possivel instalar o app da overlay (${err.code || err.message}).`);
    return { installed: false, reason: "erro" };
  }
}

module.exports = { installAcApp, parseLibraryFolders, enableInIni, copyApp, findGameDir };
