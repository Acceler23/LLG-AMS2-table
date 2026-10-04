// server/obsController.js
// Conexao com o OBS via obs-websocket (nativo no OBS 28+, ativar em
// Ferramentas > WebSocket Server Settings). Permite reagir a comandos
// vindos do painel de controle via wsServer.
//
// O OBS pode ser aberto antes ou depois do servidor: a conexao e tentada
// de novo a cada 5 s, e tambem quando cai no meio da transmissao.

const { OBSWebSocket } = require("obs-websocket-js");

const OBS_URL = process.env.OBS_WS_URL || "ws://127.0.0.1:4455";
const OBS_PASSWORD = process.env.OBS_WS_PASSWORD || "";
const RETRY_MS = 5000;

function connectObs(wss) {
  const obs = new OBSWebSocket();
  let connected = false;
  let retryTimer = null;
  let warned = false;

  function scheduleRetry() {
    if (retryTimer) return;
    retryTimer = setTimeout(tryConnect, RETRY_MS);
  }

  async function tryConnect() {
    retryTimer = null;
    try {
      await obs.connect(OBS_URL, OBS_PASSWORD || undefined);
      connected = true;
      warned = false;
      console.log("Conectado ao obs-websocket");
    } catch (err) {
      connected = false;
      if (!warned) {
        warned = true;
        console.warn("Nao foi possivel conectar ao OBS agora:", err.message);
        console.warn("Overlay/telemetria seguem normalmente. Nova tentativa a cada 5 s.");
      }
      scheduleRetry();
    }
  }

  obs.on("ConnectionClosed", () => {
    if (connected) console.warn("Conexao com o OBS caiu, tentando reconectar...");
    connected = false;
    scheduleRetry();
  });

  async function call(request, args) {
    if (!connected) {
      console.warn(`OBS desconectado: comando ${request} ignorado`);
      return;
    }
    try {
      await obs.call(request, args);
    } catch (err) {
      console.error(`Falha no comando ${request} do OBS:`, err.message);
    }
  }

  // Exemplo: painel manda { type:"command", name:"obs.setScene", payload:{ scene:"Corrida" } }
  wss.onCommand("obs.setScene", (payload) =>
    call("SetCurrentProgramScene", { sceneName: payload && payload.scene })
  );
  wss.onCommand("obs.startRecord", () => call("StartRecord"));
  wss.onCommand("obs.stopRecord", () => call("StopRecord"));

  tryConnect();
  return obs;
}

module.exports = { connectObs };
