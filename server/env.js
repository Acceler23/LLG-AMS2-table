// server/env.js
// Carrega o arquivo .env da raiz do projeto (se existir) para process.env.
// Formato: uma variavel por linha, NOME=valor. Linhas com # sao comentarios.
// Variaveis ja definidas no ambiente tem prioridade sobre o arquivo.

const fs = require("fs");
const path = require("path");

function loadEnv(file) {
  const target = file || path.join(__dirname, "..", ".env");
  let text;
  try {
    text = fs.readFileSync(target, "utf8");
  } catch (_) {
    return false;
  }
  text.split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith("#")) return;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  });
  return true;
}

module.exports = { loadEnv };
