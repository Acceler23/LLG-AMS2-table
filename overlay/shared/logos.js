// overlay/shared/logos.js
// Carregamento de imagens da overlay (logos de equipe/carro, icones).
// Ordem de busca: fonte online primeiro (repositorio de imagens configurado
// no servidor), pasta local overlay/assets como reserva. Uma URL que falhou
// nao e tentada de novo ate a configuracao ser reenviada pelo servidor.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LLGLogos = api;
})(typeof self !== "undefined" ? self : this, function () {
  function createLoader(localBase) {
    const local = String(localBase || "assets").replace(/\/+$/, "");
    let onlineBase = "";
    let cacheBust = "";
    const failed = new Set();

    function setConfig(cfg) {
      onlineBase = String((cfg && cfg.baseUrl) || "").replace(/\/+$/, "");
      cacheBust = String((cfg && cfg.cacheBust) || "");
      failed.clear();
    }

    function withBust(url) {
      if (!cacheBust) return url;
      return url + (url.includes("?") ? "&" : "?") + "v=" + encodeURIComponent(cacheBust);
    }

    // Para cada arquivo (ex: "teams/apex.png"), a URL online e depois a local.
    function candidates(relPaths) {
      const out = [];
      (relPaths || []).forEach((rel) => {
        if (!rel) return;
        const clean = String(rel).replace(/^\/+/, "");
        if (onlineBase) out.push(`${onlineBase}/${clean}`);
        out.push(`${local}/${clean}`);
      });
      return out.filter((u) => !failed.has(u));
    }

    function hide(img) {
      img.style.display = "none";
      img.removeAttribute("src");
      img.dataset.logoKey = "";
      img.onload = null;
      img.onerror = null;
    }

    // Mostra em `img` o primeiro arquivo de relPaths que existir. Pode ser
    // chamada a cada render: so recomeca o carregamento se o alvo mudou.
    function load(img, relPaths) {
      if (!img) return;
      const list = candidates(relPaths);
      if (!list.length) {
        hide(img);
        return;
      }
      const target = list[0];
      if (img.dataset.logoKey === target) return; // carregando ou ja carregada

      img.dataset.logoKey = target;
      img.style.display = "none";
      img.onload = () => {
        img.style.display = "";
      };
      img.onerror = () => {
        failed.add(target);
        img.dataset.logoKey = "";
        load(img, relPaths); // proxima candidata
      };
      img.src = withBust(target);
    }

    return { setConfig, candidates, load, hide };
  }

  return { createLoader };
});
