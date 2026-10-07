const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { installAcApp, parseLibraryFolders, enableInIni } = require("../server/acInstaller");

function tempDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "llg-ac-"));
  const gameDir = path.join(root, "assettocorsa");
  const documentsDir = path.join(root, "Documents");
  const sourceDir = path.join(root, "src");
  fs.mkdirSync(gameDir, { recursive: true });
  fs.mkdirSync(path.join(documentsDir, "Assetto Corsa", "cfg"), { recursive: true });
  fs.mkdirSync(sourceDir);
  fs.writeFileSync(path.join(sourceDir, "LLGOverlay.py"), "# v1\n");
  return { root, gameDir, documentsDir, sourceDir };
}

test("le as bibliotecas da Steam", () => {
  const vdf = '"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"D:\\\\SteamLibrary"\n\t}\n}';
  assert.deepEqual(parseLibraryFolders(vdf), ["C:\\Program Files (x86)\\Steam", "D:\\SteamLibrary"]);
});

test("python.ini: acrescenta a secao e nao mexe se ela ja existe", () => {
  assert.equal(enableInIni("[CHAT]\r\nACTIVE=1\r\n"), "[CHAT]\r\nACTIVE=1\r\n\r\n[LLGOVERLAY]\r\nACTIVE=1\r\n");
  assert.equal(enableInIni(""), "[LLGOVERLAY]\r\nACTIVE=1\r\n");
  assert.equal(enableInIni("[LLGOVERLAY]\r\nACTIVE=0\r\n"), null); // desligado de proposito
});

test("instala, ativa, e na segunda vez nao faz nada", async () => {
  const d = tempDirs();
  try {
    const ini = path.join(d.documentsDir, "Assetto Corsa", "cfg", "python.ini");
    fs.writeFileSync(ini, "[GMETER]\r\nACTIVE=1\r\n");
    let r = await installAcApp(d);
    assert.deepEqual([r.installed, r.copied, r.enabled, r.active], [true, true, true, true]);
    assert.equal(fs.readFileSync(path.join(d.gameDir, "apps", "python", "LLGOverlay", "LLGOverlay.py"), "utf8"), "# v1\n");
    assert.match(fs.readFileSync(ini, "utf8"), /\[GMETER\][\s\S]*\[LLGOVERLAY\]\r\nACTIVE=1/);
    r = await installAcApp(d);
    assert.deepEqual([r.copied, r.enabled, r.active], [false, false, true]);
    // desligado de proposito no jogo: continua desligado, e o painel avisa
    fs.writeFileSync(ini, "[LLGOVERLAY]\r\nACTIVE=0\r\n\r\n[GMETER]\r\nACTIVE=1\r\n");
    r = await installAcApp(d);
    assert.deepEqual([r.enabled, r.active], [false, false]);
    // versao nova do app: copia de novo
    fs.writeFileSync(path.join(d.sourceDir, "LLGOverlay.py"), "# v2\n");
    r = await installAcApp(d);
    assert.deepEqual([r.copied, r.enabled], [true, false]);
  } finally {
    fs.rmSync(d.root, { recursive: true, force: true });
  }
});

test("jogo nunca aberto: copia o app mas nao cria o python.ini", async () => {
  const d = tempDirs();
  try {
    fs.rmSync(path.join(d.documentsDir, "Assetto Corsa"), { recursive: true });
    const r = await installAcApp(d);
    assert.deepEqual([r.copied, r.enabled], [true, false]);
    assert.equal(fs.existsSync(path.join(d.documentsDir, "Assetto Corsa")), false);
  } finally {
    fs.rmSync(d.root, { recursive: true, force: true });
  }
});
