// app/updater.js
// Atualizacao automatica pelos Releases do GitHub.
//
// Ao abrir, o aplicativo pergunta ao GitHub qual e o ultimo Release. Se for
// mais novo que a versao aberta, mostra um aviso; aceitando:
//   1. baixa o zip do Release (LLG-Overlay-vX.Y.Z-win64.zip) para a pasta
//      temporaria e confere o SHA-256 que o GitHub informa
//   2. descompacta (tar.exe do Windows)
//   3. deixa um script do PowerShell esperando o aplicativo fechar; ele copia
//      a versao nova por cima da pasta do aplicativo e abre o aplicativo de novo
//   4. fecha o aplicativo
// As configuracoes (painel, chave, temporada) ficam na pasta do usuario
// (AppData), fora da pasta do aplicativo, e nao sao tocadas.

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn, execFile } = require("child_process");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

const REPO = "Acceler23/LLG-overlay-table";
const LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const ASSET_RE = /^LLG-Overlay-v?\d+\.\d+\.\d+-win64\.zip$/i;
const EXE_NAME = "LLG Overlay.exe";

// "v1.2.3" -> [1, 2, 3]; null se nao for uma versao
function parseVersion(text) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(text || "").trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// > 0 se a for mais nova que b
function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

// Do JSON do GitHub (/releases/latest) para o que o atualizador precisa.
// null se o Release nao serve (rascunho, sem o zip, versao fora do padrao).
function releaseInfo(release) {
  if (!release || release.draft || release.prerelease) return null;
  const version = String(release.tag_name || "").replace(/^v/i, "");
  if (!parseVersion(version)) return null;
  const asset = (release.assets || []).find((a) => a && ASSET_RE.test(a.name || ""));
  if (!asset || !asset.browser_download_url) return null;
  const digest = /^sha256:([0-9a-f]{64})$/i.exec(String(asset.digest || ""));
  return {
    version,
    notes: String(release.body || "").trim(),
    url: asset.browser_download_url,
    name: asset.name,
    size: Number(asset.size) || 0,
    sha256: digest ? digest[1].toLowerCase() : null,
  };
}

// Release mais novo que currentVersion, ou null.
async function checkForUpdate(currentVersion) {
  const res = await fetch(LATEST_URL, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "LLG-Overlay-updater" },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 404) return null; // ainda sem Release
  if (!res.ok) throw new Error(`GitHub respondeu ${res.status}`);
  const info = releaseInfo(await res.json());
  return info && compareVersions(info.version, currentVersion) > 0 ? info : null;
}

async function download(info, file, onProgress) {
  const res = await fetch(info.url, { headers: { "User-Agent": "LLG-Overlay-updater" }, redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`Download falhou (${res.status})`);
  const total = Number(res.headers.get("content-length")) || info.size || 0;
  const hash = crypto.createHash("sha256");
  let done = 0;
  const body = Readable.fromWeb(res.body);
  body.on("data", (chunk) => {
    hash.update(chunk);
    done += chunk.length;
    if (onProgress && total) onProgress(done / total);
  });
  await pipeline(body, fs.createWriteStream(file));
  const sha = hash.digest("hex");
  if (info.sha256 && sha !== info.sha256) throw new Error("O arquivo baixado não confere com o do GitHub (SHA-256 diferente). Tente de novo.");
}

function extract(zip, dir) {
  const tar = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
  return new Promise((resolve, reject) => {
    execFile(tar, ["-xf", zip, "-C", dir], { windowsHide: true, timeout: 5 * 60 * 1000 }, (err) =>
      err ? reject(new Error(`Não foi possível descompactar: ${err.message}`)) : resolve()
    );
  });
}

// Pasta descompactada que tem o LLG Overlay.exe (o zip tem uma pasta "LLG Overlay" dentro)
function findAppFolder(dir, depth = 0) {
  if (fs.existsSync(path.join(dir, EXE_NAME))) return dir;
  if (depth >= 2) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const hit = findAppFolder(path.join(dir, entry.name), depth + 1);
    if (hit) return hit;
  }
  return null;
}

// Script que roda depois que o aplicativo fecha: copia a versao nova e reabre.
const SCRIPT = `param([int]$AppPid, [string]$Source, [string]$Target, [string]$Exe, [string]$Work)
$log = Join-Path $Work "update.log"
"Atualizando $Target a partir de $Source" | Out-File $log -Encoding utf8
try { Wait-Process -Id $AppPid -Timeout 90 -ErrorAction Stop } catch {}
Start-Sleep -Seconds 2
# /E copia tudo (subpastas); arquivos que so existem na pasta antiga ficam
robocopy $Source $Target /E /R:20 /W:1 /NP /NFL /NDL | Out-File $log -Append -Encoding utf8
$rc = $LASTEXITCODE
"robocopy terminou com codigo $rc (0 a 7 = ok)" | Out-File $log -Append -Encoding utf8
Start-Process -FilePath $Exe -WorkingDirectory $Target
if ($rc -lt 8) { Remove-Item -Recurse -Force (Join-Path $Work "files"), (Join-Path $Work "update.zip") -ErrorAction SilentlyContinue }
`;

// Baixa, confere e prepara a troca. Depois disso o aplicativo deve fechar
// (app.quit()); o script espera ele sair, copia e abre de novo.
//   opts.installDir / opts.pid: so para testes (padrao: a pasta do .exe e este processo)
async function prepareUpdate(info, onProgress, opts = {}) {
  const installDir = opts.installDir || path.dirname(process.execPath);
  const exe = path.join(installDir, EXE_NAME);
  if (!fs.existsSync(exe)) throw new Error(`Não achei o ${EXE_NAME} em ${installDir}.`);
  // a pasta precisa aceitar escrita (ex: nao funciona dentro de Arquivos de Programas)
  try {
    const probe = path.join(installDir, ".llg-update-test");
    fs.writeFileSync(probe, "");
    fs.unlinkSync(probe);
  } catch (_) {
    throw new Error(`Sem permissão para gravar em ${installDir}. Mova a pasta do aplicativo para Documentos, por exemplo, ou atualize manualmente.`);
  }

  const work = path.join(os.tmpdir(), `llg-overlay-update-${info.version}`);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(path.join(work, "files"), { recursive: true });
  const zip = path.join(work, "update.zip");
  await download(info, zip, onProgress);
  await extract(zip, path.join(work, "files"));
  const source = findAppFolder(path.join(work, "files"));
  if (!source) throw new Error(`O zip do Release não tem o ${EXE_NAME}.`);

  const script = path.join(work, "update.ps1");
  fs.writeFileSync(script, "\ufeff" + SCRIPT.replace(/\n/g, "\r\n"));
  await startIndependent(script, { AppPid: opts.pid || process.pid, Source: source, Target: installDir, Exe: exe, Work: work });
}

// Roda o script num processo independente, que continua depois que o
// aplicativo fecha. O PowerShell abre esse processo com Start-Process (o modo
// "detached" do Node nem sempre chega a rodar) e os parametros vao codificados,
// para caminhos com espaco ou apostrofo nao quebrarem a linha de comando.
function startIndependent(script, params) {
  const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const encode = (s) => Buffer.from(s, "utf16le").toString("base64");
  const args = Object.entries(params).map(([k, v]) => `-${k} ${typeof v === "number" ? v : quote(v)}`).join(" ");
  const inner = `& ${quote(script)} ${args}`;
  const outer = `Start-Process -FilePath powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${encode(inner)}'`;
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-EncodedCommand", encode(outer)], {
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", (err) => reject(new Error(`N\u00e3o foi poss\u00edvel iniciar a troca de vers\u00e3o: ${err.message}`)));
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`N\u00e3o foi poss\u00edvel iniciar a troca de vers\u00e3o (c\u00f3digo ${code}).`))));
  });
}

module.exports = { parseVersion, compareVersions, releaseInfo, checkForUpdate, prepareUpdate, findAppFolder, REPO };
