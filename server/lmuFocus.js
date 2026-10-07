// server/lmuFocus.js
// Carro em foco no Le Mans Ultimate.
// A Shared Memory do LMU nao diz qual carro a camera esta mostrando (como
// espectador nem existe "carro do jogador"). O proprio jogo, porem, tem uma
// API local que responde isso: GET /rest/watch/focus devolve o slot do carro
// em foco. Este modulo consulta essa API enquanto o LMU for o jogo ativo.

const PORT = process.env.LMU_API_PORT || 6397;
const URL = `http://127.0.0.1:${PORT}/rest/watch/focus`;
const POLL_MS = 300;
const IDLE_AFTER_MS = 3000; // sem dados do LMU por esse tempo: para de consultar
const STALE_AFTER_MS = 3000; // resposta mais velha que isso nao e usada

let timer = null;
let lastWantedAt = 0;
let focusSlot = null;
let focusAt = 0;
let busy = false;

async function poll() {
  if (Date.now() - lastWantedAt > IDLE_AFTER_MS) {
    clearInterval(timer);
    timer = null;
    return;
  }
  if (busy) return;
  busy = true;
  try {
    const res = await fetch(URL, { signal: AbortSignal.timeout(1000) });
    const slot = Number((await res.text()).trim());
    if (res.ok && Number.isInteger(slot) && slot >= 0) {
      focusSlot = slot;
      focusAt = Date.now();
    }
  } catch (_) {
    // jogo fechando ou API indisponivel: fica com o que a Shared Memory disser
  } finally {
    busy = false;
  }
}

// Marca em cada carro do payload do LMU se ele e o carro em foco (isPlayer).
// Sem resposta recente da API, mantem o que o listener mandou (carro do jogador).
function apply(payload) {
  lastWantedAt = Date.now();
  if (!timer) {
    timer = setInterval(poll, POLL_MS);
    poll();
  }
  if (focusSlot === null || Date.now() - focusAt > STALE_AFTER_MS) return payload;
  const standings = (payload && payload.standings) || [];
  if (!standings.some((e) => e.slot === focusSlot)) return payload;
  standings.forEach((e) => {
    e.isPlayer = e.slot === focusSlot;
  });
  return payload;
}

module.exports = { apply };
