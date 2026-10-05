// server/settings.js
// Configuracoes escolhidas pelo painel que precisam sobreviver a um
// reinicio: chave do RLT e temporada aplicada. Ficam em settings.json, fora
// do git. No aplicativo (.exe) o arquivo vai para a pasta de dados do
// usuario (LLG_DATA_DIR); rodando pelo start.bat, fica na raiz do projeto.

const fs = require("fs");
const path = require("path");

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

module.exports = { get, set, file };
