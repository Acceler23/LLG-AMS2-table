// overlay/shared/groups.js
// Regra unica de "a que classe este carro pertence", usada pela tabela e
// pelo driver card para as posicoes por classe baterem sempre.
//   1) Temporada do RLT com classes: a classe do piloto no RLT ("—" se o
//      piloto nao foi reconhecido).
//   2) Sessao de uma classe so que esta em SPLIT_BY_CAR_CLASSES (ex: Carrera
//      Cup com 3.8 e 4.0): cada modelo de carro vira uma classe.
//   3) Caso geral: a classe do jogo (carClass).
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LLGGroups = api;
})(typeof self !== "undefined" ? self : this, function () {
  // opts.rltEnabled(): true quando ha temporada do RLT com classes
  // opts.lookup(entry): piloto do RLT correspondente, ou null
  // opts.splitClasses: Set/array com as classes divididas por carro
  function createGrouper(opts) {
    const rltEnabled = opts.rltEnabled || (() => false);
    const lookup = opts.lookup || (() => null);
    const splitClasses = new Set(opts.splitClasses || []);
    let memo = { ref: null, value: false };

    function isSplitByCar(standings) {
      if (rltEnabled()) return false;
      if (memo.ref === standings) return memo.value;
      const classes = new Set();
      (standings || []).forEach((e) => {
        if (e.carClass) classes.add(e.carClass);
      });
      const value = classes.size === 1 && splitClasses.has(classes.values().next().value);
      memo = { ref: standings, value };
      return value;
    }

    function key(entry, standings) {
      if (rltEnabled()) {
        const info = lookup(entry);
        return info ? info.uniqueName || info.name || "—" : "—";
      }
      if (isSplitByCar(standings)) return entry.carName || "—";
      return entry.carClass || "—";
    }

    // posicao do piloto dentro do proprio grupo, pela posicao geral
    function position(entry, standings) {
      if (!entry) return null;
      const k = key(entry, standings);
      const list = (standings || [])
        .filter((e) => key(e, standings) === k)
        .sort((a, b) => (a.position || 999) - (b.position || 999));
      const idx = list.findIndex((e) => e.name === entry.name);
      return idx >= 0 ? idx + 1 : null;
    }

    // posicao de largada dentro do grupo (entry.startPosition vem do servidor)
    function startPosition(entry, standings) {
      if (!entry || entry.startPosition == null) return null;
      const k = key(entry, standings);
      const list = (standings || [])
        .filter((e) => e.startPosition != null && key(e, standings) === k)
        .sort((a, b) => a.startPosition - b.startPosition);
      const idx = list.findIndex((e) => e.name === entry.name);
      return idx >= 0 ? idx + 1 : null;
    }

    return { key, isSplitByCar, position, startPosition };
  }

  return { createGrouper };
});
