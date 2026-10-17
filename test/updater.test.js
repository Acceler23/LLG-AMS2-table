const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { compareVersions, releaseInfo, findAppFolder } = require("../app/updater");

test("versoes: compara numero a numero, com ou sem o v", () => {
  assert.ok(compareVersions("0.1.10", "0.1.9") > 0);
  assert.ok(compareVersions("v0.2.0", "0.1.1") > 0);
  assert.equal(compareVersions("0.1.1", "v0.1.1"), 0);
  assert.ok(compareVersions("0.1.0", "0.1.1") < 0);
  assert.equal(compareVersions("abc", "0.1.0"), 0); // fora do padrao: nunca e "mais nova"
});

const release = {
  tag_name: "v0.2.0",
  draft: false,
  prerelease: false,
  body: "**Como instalar**",
  assets: [
    { name: "outra-coisa.txt", browser_download_url: "https://x/outra" },
    { name: "LLG-Overlay-v0.2.0-win64.zip", size: 123, digest: "sha256:" + "ab".repeat(32), browser_download_url: "https://x/zip" },
  ],
};

test("release: acha o zip do aplicativo e o SHA-256", () => {
  const info = releaseInfo(release);
  assert.equal(info.version, "0.2.0");
  assert.equal(info.url, "https://x/zip");
  assert.equal(info.sha256, "ab".repeat(32));
});

test("release sem o zip, rascunho ou pre-release nao serve", () => {
  assert.equal(releaseInfo({ ...release, assets: [release.assets[0]] }), null);
  assert.equal(releaseInfo({ ...release, draft: true }), null);
  assert.equal(releaseInfo({ ...release, prerelease: true }), null);
  assert.equal(releaseInfo({ ...release, tag_name: "teste" }), null);
});

test("zip descompactado: acha a pasta com o LLG Overlay.exe", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "llg-upd-test-"));
  try {
    fs.mkdirSync(path.join(dir, "LLG Overlay", "resources"), { recursive: true });
    fs.writeFileSync(path.join(dir, "LLG Overlay", "LLG Overlay.exe"), "");
    assert.equal(findAppFolder(dir), path.join(dir, "LLG Overlay"));
    assert.equal(findAppFolder(path.join(dir, "LLG Overlay", "resources")), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
