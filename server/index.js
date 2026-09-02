// server/index.js
// Ponto de entrada: sobe o servidor HTTP (serve overlay/ e control-panel/),
// abre o WebSocket para os clientes e recebe os dados do listener.ps1
// (que le a Shared Memory do AMS2 e manda pronto em JSON).

const path = require("path");
const express = require("express");
const http = require("http");

const { createWsServer } = require("./wsServer");
const { startTcpBridge } = require("./tcpBridge");
const { connectObs } = require("./obsController");

const HTTP_PORT = process.env.HTTP_PORT || 8080; // porta da overlay/painel (obs-websocket usa 4455, nao conflita)
const BRIDGE_PORT = process.env.BRIDGE_PORT || 5607; // porta TCP local entre o listener.ps1 e este servidor

const app = express();
app.use("/overlay", express.static(path.join(__dirname, "..", "overlay")));
app.use("/panel", express.static(path.join(__dirname, "..", "control-panel")));

const server = http.createServer(app);

// WebSocket: distribui a tabela de tempos para os clientes e recebe comandos deles
const wss = createWsServer(server);

// Bridge: o listener.ps1 le a Shared Memory do AMS2 e ja manda o standings
// pronto em JSON -- aqui e' so' repassar pro WebSocket.
startTcpBridge(BRIDGE_PORT, (buffer) => {
  try {
    const data = JSON.parse(buffer.toString("utf8"));
    wss.broadcast({ type: "standings", data });
  } catch (err) {
    console.error("Erro ao interpretar dados da bridge:", err.message);
  }
});

// OBS: conexao opcional via obs-websocket, controlada por eventos de telemetria
// ou por comandos vindos do painel de controle (ver wsServer.js -> onClientMessage)
connectObs(wss);

server.listen(HTTP_PORT, () => {
  console.log(`Tabela de tempos em      http://localhost:${HTTP_PORT}/overlay/timing-table.html`);
  console.log(`Painel de controle em    http://localhost:${HTTP_PORT}/panel/panel.html`);
  console.log(`Aguardando o listener.ps1 (rode-o em outra janela) para receber dados do AMS2`);
});
