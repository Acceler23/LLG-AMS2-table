const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const secret = require("../server/secret");

test("criptografa e abre de volta, sem deixar o texto a mostra", () => {
  const key = "abc123-chave-de-teste";
  const enc = secret.encrypt(key);
  assert.ok(secret.isEncrypted(enc));
  assert.ok(!enc.includes(key));
  assert.equal(secret.decrypt(enc), key);
  // cada gravacao sai diferente, mesmo com a mesma chave
  assert.notEqual(secret.encrypt(key), enc);
});

test("valor alterado ou invalido nao abre", () => {
  const enc = secret.encrypt("segredo");
  const parts = enc.split(":");
  parts[3] = Buffer.from("outra coisa").toString("base64");
  assert.equal(secret.decrypt(parts.join(":")), "");
  assert.equal(secret.decrypt("llg1:lixo"), "");
  assert.equal(secret.decrypt("texto puro"), "");
});

test("reveal aceita texto puro e criptografado", () => {
  assert.equal(secret.reveal("  chave-pura "), "chave-pura");
  assert.equal(secret.reveal(secret.encrypt("chave")), "chave");
  assert.equal(secret.reveal(undefined), "");
});

test("arquivo da chave: grava criptografado e le de volta", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "llg-key-"));
  try {
    const file = path.join(dir, "rlt-key.enc");
    assert.equal(secret.readKeyFile(file), ""); // sem arquivo
    secret.writeKeyFile("minha-chave", file);
    assert.ok(!fs.readFileSync(file, "utf8").includes("minha-chave"));
    assert.equal(secret.readKeyFile(file), "minha-chave");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("settings: chave salva em texto puro e regravada criptografada", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "llg-set-"));
  const before = process.env.LLG_DATA_DIR;
  try {
    fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ rltApiKey: "chave-antiga" }));
    process.env.LLG_DATA_DIR = dir;
    delete require.cache[require.resolve("../server/settings")];
    const settings = require("../server/settings");
    assert.equal(settings.getSecret("rltApiKey"), "chave-antiga");
    const onDisk = () => fs.readFileSync(path.join(dir, "settings.json"), "utf8");
    assert.ok(!onDisk().includes("chave-antiga"));
    assert.equal(settings.getSecret("rltApiKey"), "chave-antiga");
    settings.setSecret("rltApiKey", "chave-nova");
    assert.ok(!onDisk().includes("chave-nova"));
    assert.equal(settings.getSecret("rltApiKey"), "chave-nova");
    settings.setSecret("rltApiKey", null);
    assert.equal(settings.getSecret("rltApiKey"), "");
  } finally {
    if (before === undefined) delete process.env.LLG_DATA_DIR;
    else process.env.LLG_DATA_DIR = before;
    delete require.cache[require.resolve("../server/settings")];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
