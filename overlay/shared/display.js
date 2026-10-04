// overlay/shared/display.js
// Regras de exibicao usadas pela tabela E pelo driver card, para os dois
// mostrarem sempre o mesmo nome de classe, a mesma cor e o mesmo logo.
// As listas vem de drivers-config.js (CLASS_NAME_OVERRIDES, CLASS_COLORS,
// DEFAULT_COLOR, CAR_LOGOS, TEAM_LOGO_OVERRIDES).
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LLGDisplay = api;
})(typeof self !== "undefined" ? self : this, function () {
  let testConfig = null;

  // No navegador le as constantes globais de drivers-config.js. Nos testes
  // (Node) a configuracao e injetada com setConfig().
  function config() {
    if (testConfig) return testConfig;
    return {
      classNameOverrides: typeof CLASS_NAME_OVERRIDES !== "undefined" ? CLASS_NAME_OVERRIDES : {},
      classColors: typeof CLASS_COLORS !== "undefined" ? CLASS_COLORS : null,
      defaultColor: typeof DEFAULT_COLOR !== "undefined" ? DEFAULT_COLOR : "rgb(0, 98, 255)",
      carLogos: typeof CAR_LOGOS !== "undefined" ? CAR_LOGOS : null,
      teamLogoOverrides: typeof TEAM_LOGO_OVERRIDES !== "undefined" ? TEAM_LOGO_OVERRIDES : {},
    };
  }

  function setConfig(cfg) {
    testConfig = cfg;
  }

  function normalizeColor(c) {
    if (!c) return null;
    let s = String(c).trim();
    if (!s) return null;
    if (s.startsWith("rgb") || s.startsWith("hsl")) return s;
    if (s.startsWith("#")) s = s.slice(1);
    if (/^[0-9a-fA-F]{8}$/.test(s)) return `#${s.slice(2, 8)}`;
    if (/^[0-9a-fA-F]{6}$/.test(s) || /^[0-9a-fA-F]{3}$/.test(s)) return `#${s}`;
    return c;
  }

  // "GT3_Gen2_LD" -> "GT3 Gen2"; CLASS_NAME_OVERRIDES tem prioridade.
  function formatClassName(raw) {
    if (!raw) return raw;
    const overrides = config().classNameOverrides || {};
    if (overrides[raw]) return overrides[raw];
    return String(raw)
      .replace(/_(LD|HD|SW)(?=_|$)/gi, "") // sufixos tecnicos que nao fazem parte do nome
      .replace(/_/g, " ")
      .trim();
  }

  function hashColor(str) {
    let h = 0;
    const s = String(str || "");
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return `hsl(${Math.abs(h) % 360}, 65%, 42%)`;
  }

  // Cor de uma classe. rltClasses: classes da temporada do RLT (ou null).
  function classColor(key, rltClasses) {
    const cfg = config();
    if (rltClasses && rltClasses.length) {
      const c = rltClasses.find((x) => x.uniqueName === key || x.name === key);
      const col = c && normalizeColor(c.color);
      if (col) return col;
    }
    const colors = cfg.classColors;
    if (!colors) return cfg.defaultColor;
    if (key && colors[key]) return colors[key];
    const formatted = formatClassName(key);
    if (formatted && colors[formatted]) return colors[formatted];
    if (key) {
      const noSpace = String(key).replace(/\s+/g, "_");
      if (colors[noSpace]) return colors[noSpace];
    }
    for (const [raw, name] of Object.entries(cfg.classNameOverrides || {})) {
      if (name === formatted && colors[raw]) return colors[raw];
    }
    if (key && key !== "—") return hashColor(key);
    return cfg.defaultColor;
  }

  function teamSlug(name) {
    return String(name || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
  }

  function manufacturerName(carName) {
    return (carName || "").split(" ")[0];
  }

  // Arquivo do logo da montadora, pelo nome do carro.
  function carLogo(carName) {
    const logos = config().carLogos;
    if (!logos) return undefined;
    return logos[manufacturerName(carName)] || logos[carName];
  }

  // Equipe com nome de montadora (ex: "Porsche", "McLaren") usa o logo dela.
  function carLogoFromTeam(teamName) {
    const logos = config().carLogos;
    if (!teamName || !logos) return null;
    if (logos[teamName]) return logos[teamName];
    const first = manufacturerName(teamName);
    if (logos[first]) return logos[first];
    const slug = teamSlug(teamName);
    for (const key of Object.keys(logos)) {
      if (teamSlug(key) === slug) return logos[key];
    }
    return null;
  }

  // Arquivo do logo da equipe. Ordem: escolha feita no painel (localOverrides),
  // TEAM_LOGO_OVERRIDES do drivers-config.js, e por fim o nome em minusculas
  // com "_" (ex: "Hell Machine" -> hell_machine.png).
  function teamLogoFile(teamName, localOverrides) {
    if (!teamName) return null;
    if (localOverrides && localOverrides[teamName]) return localOverrides[teamName];
    const overrides = config().teamLogoOverrides || {};
    if (overrides[teamName]) return overrides[teamName];
    const slug = teamSlug(teamName);
    return slug ? `${slug}.png` : null;
  }

  // Caminhos a tentar para o logo de um piloto: equipe primeiro, depois carro.
  function logoPaths(teamName, carName, localOverrides) {
    const carFile = carLogo(carName) || carLogoFromTeam(teamName);
    const teamFile = teamLogoFile(teamName, localOverrides);
    return [teamFile ? `teams/${teamFile}` : null, carFile ? `cars/${carFile}` : null];
  }

  return {
    setConfig,
    formatClassName,
    hashColor,
    classColor,
    teamSlug,
    manufacturerName,
    carLogo,
    carLogoFromTeam,
    teamLogoFile,
    logoPaths,
  };
});
