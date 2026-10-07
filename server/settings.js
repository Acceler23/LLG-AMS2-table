// server/settings.js
// Configuracoes escolhidas pelo painel que precisam sobreviver a um
// reinicio: chave do RLT e temporada aplicada. Ficam em settings.json, fora
// do git. No aplicativo (.exe) o arquivo vai para a pasta de dados do
// usuario (LLG_DATA_DIR); rodando pelo start.bat, fica na raiz do projeto.

const fs = require("fs");
const path = require("path");
const secret = require("./secret");

const dir = process.env.LLG_DATA_DIR || path.join(__dirname, "..");
const file = path.join(dir, "settings.json");

let data = {};
try {
  data = JSON.parse(fs.readFileSync(file, "utf8")) || {};
} catch (_) {
  data = {};
}

function get(key) {
  return data[key];
}

function set(key, value) {
  if (value === undefined || value === null || value === "") delete data[key];
  else data[key] = value;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (err) {
    console.warn("Nao foi possivel salvar settings.json:", err.message);
  }
}

// Valores secretos (chave do RLT): gravados criptografados. Um valor antigo,
// salvo em texto puro, e aceito e regravado criptografado na primeira leitura.
function getSecret(key) {
  const value = data[key];
  if (!value) return "";
  if (secret.isEncrypted(value)) return secret.decrypt(value);
  set(key, secret.encrypt(value));
  return String(value);
}

function setSecret(key, value) {
  set(key, value ? secret.encrypt(value) : null);
}

module.exports = { get, set, getSecret, setSecret, file };
