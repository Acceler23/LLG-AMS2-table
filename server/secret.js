// server/secret.js
// Chave do RLT criptografada (AES-256-GCM) em vez de em texto puro: e assim
// que ela e distribuida e que fica guardada no settings.json de cada pessoa.
//
// Limite que precisa ficar claro: o aplicativo tem que conseguir abrir a
// chave sozinho, entao o segredo usado para criptografar esta aqui no codigo.
// Isso impede que a chave seja lida abrindo um arquivo ou procurando no
// GitHub, mas quem tiver o aplicativo e quiser mesmo a chave consegue
// recupera-la. Protecao de verdade so com a chave fora do aplicativo.
//
// O aplicativo nao leva a chave: na primeira vez que abre, ele pede a chave
// CRIPTOGRAFADA, que o organizador gera aqui e passa para quem vai usar:
//   npm run encrypt-key
// (le RLT_API_KEY do ambiente ou do .env, mostra a chave criptografada e
// grava server/rlt-key.enc, que fica fora do git e fora do aplicativo)

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PREFIX = "llg1:";
const KEY_FILE = path.join(__dirname, "rlt-key.enc");

// segredo montado em pedacos, so para nao aparecer inteiro numa busca
const PARTS = ["LLG", "overlay", "liga-lets-go", "rlt", "2026"];
let derived = null;
function cipherKey() {
  if (!derived) derived = crypto.scryptSync(PARTS.join("/"), "llg-overlay-salt-v1", 32);
  return derived;
}

function isEncrypted(value) {
  return typeof value === "string" && value.startsWith(PREFIX);
}

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", cipherKey(), iv);
  const data = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
  return PREFIX + [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(":");
}

// Devolve o texto original, ou "" se o valor estiver corrompido ou alterado.
function decrypt(value) {
  if (!isEncrypted(value)) return "";
  try {
    const [iv, tag, data] = value.slice(PREFIX.length).trim().split(":").map((p) => Buffer.from(p, "base64"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", cipherKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch (_) {
    return "";
  }
}

// Aceita o valor criptografado ou em texto puro (ex: RLT_API_KEY no .env).
function reveal(value) {
  const text = String(value || "").trim();
  return isEncrypted(text) ? decrypt(text) : text;
}

// Chave embutida (server/rlt-key.enc), ou "" se o arquivo nao existir.
function readKeyFile(file) {
  try {
    return decrypt(fs.readFileSync(file || KEY_FILE, "utf8").trim());
  } catch (_) {
    return "";
  }
}

function writeKeyFile(key, file) {
  fs.writeFileSync(file || KEY_FILE, encrypt(String(key).trim()) + "\n");
}

module.exports = { encrypt, decrypt, reveal, isEncrypted, readKeyFile, writeKeyFile, KEY_FILE };

// npm run encrypt-key: grava server/rlt-key.enc a partir de RLT_API_KEY
if (require.main === module) {
  let key = reveal(process.env.RLT_API_KEY);
  if (!key) {
    try {
      const m = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8").match(/^\s*RLT_API_KEY\s*=\s*(\S+)/m);
      key = m ? reveal(m[1].replace(/^["']|["']$/g, "")) : "";
    } catch (_) {}
  }
  if (!key) {
    console.error("Defina RLT_API_KEY no ambiente ou no arquivo .env e rode de novo.");
    process.exit(1);
  }
  writeKeyFile(key);
  console.log("Chave criptografada, para passar a quem vai usar o aplicativo (colar na primeira vez que abrir):");
  console.log("");
  console.log(fs.readFileSync(KEY_FILE, "utf8").trim());
  console.log("");
  console.log(`Tambem gravada em ${KEY_FILE}. A chave pura do RLT nao foi exibida.`);
}
