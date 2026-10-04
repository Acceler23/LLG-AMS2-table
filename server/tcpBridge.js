// server/tcpBridge.js
//
// Recebe os dados do listener.ps1 por TCP local. O listener le a Shared
// Memory do AMS2 e manda um JSON por ciclo, prefixado com 4 bytes indicando
// o tamanho (big-endian), pra sabermos onde uma mensagem termina e a outra
// comeca dentro do fluxo TCP.

const net = require("net");

const MAX_MESSAGE_BYTES = 4 * 1024 * 1024; // um ciclo completo tem ~40 KB

function startTcpBridge(port, onPacket) {
  const server = net.createServer((socket) => {
    console.log("Bridge (PowerShell) conectada");
    let buffer = Buffer.alloc(0);

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      // pode chegar mais de um pacote junto, ou um pacote partido em
      // varios pedacos -- por isso o loop + prefixo de tamanho
      while (buffer.length >= 4) {
        const msgLen = buffer.readUInt32BE(0);
        if (msgLen > MAX_MESSAGE_BYTES) {
          // prefixo corrompido: derruba a conexao, o listener reconecta sozinho
          console.error("Bridge: tamanho de mensagem invalido, reiniciando conexao");
          socket.destroy();
          return;
        }
        if (buffer.length < 4 + msgLen) break; // ainda falta parte do pacote
        const msg = buffer.subarray(4, 4 + msgLen);
        buffer = buffer.subarray(4 + msgLen);
        onPacket(msg);
      }
    });

    socket.on("close", () => console.log("Bridge (PowerShell) desconectada"));
    socket.on("error", (err) => console.error("Erro na conexao da bridge:", err.message));
  });

  server.on("error", (err) => console.error("Erro no servidor da bridge:", err.message));

  server.listen(port, "127.0.0.1", () => {
    console.log(`Bridge TCP esperando o listener.ps1 conectar na porta ${port}`);
  });

  return server;
}

module.exports = { startTcpBridge };
