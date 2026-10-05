// app/dev.js
// Abre o aplicativo em modo desenvolvimento (npm run app).
// O terminal do VS Code define ELECTRON_RUN_AS_NODE=1, que faz o Electron
// rodar como Node comum e quebra o aplicativo; por isso a variavel e removida.

const { spawn } = require("child_process");
const path = require("path");
const electron = require("electron"); // fora do Electron, devolve o caminho do executavel

const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [path.join(__dirname, "..")].concat(process.argv.slice(2)), { stdio: "inherit", env });
child.on("exit", (code) => process.exit(code == null ? 0 : code));
