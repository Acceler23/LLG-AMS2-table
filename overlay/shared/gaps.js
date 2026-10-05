// overlay/shared/gaps.js
// Intervalo por TEMPO: guarda, para cada carro, em que instante ele passou
// por cada ponto da pista (distancia total percorrida). O gap de A para B
// (B na frente) e' "agora" menos o instante em que B esteve onde A esta'.
// Isso nao oscila com a velocidade instantanea como distancia/velocidade.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LLGGaps = api;
})(typeof self !== "undefined" ? self : this, function () {
  const MAX_SAMPLES = 6000; // ~20 min a 5 Hz por carro
  const MAX_SPEED_MS = 120; // acima disso o salto de distancia e' erro de leitura
  const REJECTS_TO_RESET = 15; // ~3 s de leituras "impossiveis" = sessao reiniciou

  function createGapTracker() {
    const cars = new Map(); // nome -> { d: [], t: [], rejects }

    function reset() {
      cars.clear();
    }

    function addSample(name, dist, now) {
      let car = cars.get(name);
      if (!car) {
        car = { d: [], t: [], rejects: 0 };
        cars.set(name, car);
      }
      const n = car.d.length;
      if (n === 0) {
        car.d.push(dist);
        car.t.push(now);
        return;
      }
      const delta = dist - car.d[n - 1];
      const dt = Math.max(0.2, (now - car.t[n - 1]) / 1000);
      if (delta < -5 || delta > MAX_SPEED_MS * dt + 50) {
        // salto impossivel (ex: volta contada antes da distancia zerar)
        car.rejects += 1;
        if (car.rejects >= REJECTS_TO_RESET) {
          car.d = [dist];
          car.t = [now];
          car.rejects = 0;
        }
        return;
      }
      car.rejects = 0;
      if (delta < 1) {
        // parado: o instante valido naquele ponto e' o ultimo em que esteve la
        car.t[n - 1] = now;
        return;
      }
      car.d.push(dist);
      car.t.push(now);
      if (car.d.length > MAX_SAMPLES) {
        car.d.splice(0, MAX_SAMPLES / 2);
        car.t.splice(0, MAX_SAMPLES / 2);
      }
    }

    function update(standings, now) {
      (standings || []).forEach((e) => {
        if (!e || !e.name || typeof e.totalDistance !== "number") return;
        addSample(e.name, e.totalDistance, now);
      });
    }

    // instante (ms) em que o carro passou pela distancia `dist`, ou null
    function timeAt(car, dist) {
      const d = car.d;
      const n = d.length;
      if (!n || dist < d[0] || dist > d[n - 1]) return null;
      let lo = 0;
      let hi = n - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (d[mid] < dist) lo = mid + 1;
        else hi = mid;
      }
      if (lo === 0 || d[lo] === dist) return car.t[lo];
      const span = d[lo] - d[lo - 1];
      const frac = span > 0 ? (dist - d[lo - 1]) / span : 1;
      return car.t[lo - 1] + (car.t[lo] - car.t[lo - 1]) * frac;
    }

    // { sec } | { laps } | null (sem historico suficiente ainda)
    function gap(behindName, aheadName, trackLength) {
      const a = cars.get(behindName);
      const b = cars.get(aheadName);
      if (!a || !b || !a.d.length || !b.d.length) return null;
      const dA = a.d[a.d.length - 1];
      const tA = a.t[a.t.length - 1];
      const dB = b.d[b.d.length - 1];
      const diff = dB - dA;
      if (diff <= 0) return { sec: 0 };
      if (trackLength > 0 && diff >= trackLength) return { laps: Math.floor(diff / trackLength) };
      const tB = timeAt(b, dA);
      if (tB == null) return null;
      return { sec: Math.max(0, (tA - tB) / 1000) };
    }

    return { update, gap, reset };
  }

  return { createGapTracker };
});
