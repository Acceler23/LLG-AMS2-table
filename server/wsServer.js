// server/wsServer.js
// Canal bidirecional:
//  - servidor -> clientes: telemetria em tempo real (broadcast)
//  - clientes -> servidor: comandos/inputs (troca de pagina da overlay,
//    forcar evento, pedir status do OBS, etc.)

const { WebSocketServer } = require("ws");

function createWsServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  const clients = new Set();
  const commandHandlers = new Map(); // registrado por outros modulos (ex: obsController)

  wss.on("connection", (socket) => {
    clients.add(socket);
    console.log(`Cliente conectado (${clients.size} ativos)`);

    socket.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch (err) {
        console.warn("Mensagem invalida recebida:", raw.toString());
        return;
      }

      // Formato esperado: { type: "command", name: "...", payload: {...} }
      if (msg.type === "command") {
        if (msg.name && String(msg.name).startsWith("overlay.")) {
          const payload = JSON.stringify({ type: "overlayCommand", name: msg.name, payload: msg.payload || {} });
          for (const c of clients) {
            if (c.readyState === c.OPEN) c.send(payload);
          }
          return;
        }
        if (commandHandlers.has(msg.name)) {
          commandHandlers.get(msg.name)(msg.payload, socket);
        } else {
          console.log("Comando sem handler registrado:", msg);
        }
      }
    });

    socket.on("close", () => {
      clients.delete(socket);
      console.log(`Cliente desconectado (${clients.size} ativos)`);
    });
  });

  return {
    raw: wss,
    broadcast(obj) {
      const payload = JSON.stringify(obj);
      for (const c of clients) {
        if (c.readyState === c.OPEN) c.send(payload);
      }
    },
    // Permite que outros modulos (ex: obsController.js) reajam a comandos
    // vindos da overlay/painel sem acoplar tudo neste arquivo.
    onCommand(name, handler) {
      commandHandlers.set(name, handler);
    },
  };
}

module.exports = { createWsServer };
