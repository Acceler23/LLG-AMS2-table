// overlay/shared/colors.js
// Usado pela overlay (browser, global LLGColors) e pelo servidor (require).
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LLGColors = api;
})(typeof self !== "undefined" ? self : this, function () {
  // Aceita "#RGB", "#RRGGBB", "AARRGGBB" (formato do RLT/WPF), rgb()/hsl().
  // Devolve sempre algo que o CSS entende, ou null se vier vazio.
  function normalizeColor(c) {
    if (!c) return null;
    let s = String(c).trim();
    if (!s) return null;
    if (s.startsWith("rgb") || s.startsWith("hsl")) return s;
    if (s.startsWith("#")) s = s.slice(1);
    if (/^[0-9a-fA-F]{8}$/.test(s)) return `#${s.slice(2, 8)}`;
    if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s}`;
    if (/^[0-9a-fA-F]{3}$/.test(s)) return `#${s}`;
    return c;
  }

  // "#RGB" / "#RRGGBB" / "AARRGGBB" -> [r, g, b], ou null
  function toRgb(c) {
    const n = normalizeColor(c);
    if (!n || n[0] !== "#") return null;
    let hex = n.slice(1);
    if (hex.length === 3) hex = hex.split("").map((ch) => ch + ch).join("");
    if (hex.length !== 6) return null;
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  }

  // cor no ponto t (0..1) de um degrade linear entre a e b
  function mix(a, b, t) {
    return a.map((v, i) => Math.round(v + (b[i] - v) * t));
  }

  function luminance(rgb) {
    const lin = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  }

  // Preto ou branco, o que tiver mais contraste com o fundo. O limite 0.179
  // e o ponto em que o contraste (WCAG) com preto e com branco se iguala.
  function readableOn(rgb) {
    return luminance(rgb) > 0.179 ? "#000000" : "#ffffff";
  }

  // Qualquer cor de CSS usada aqui (hex, rgb(), hsl()) -> [r, g, b], ou null
  function parseCssColor(c) {
    const hex = toRgb(c);
    if (hex) return hex;
    const s = String(c || "").trim();
    let m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])].map((v) => Math.round(v));
    m = s.match(/^hsla?\(\s*([\d.]+)[\s,]+([\d.]+)%[\s,]+([\d.]+)%/i);
    if (m) {
      const h = (Number(m[1]) % 360) / 360;
      const sat = Number(m[2]) / 100;
      const l = Number(m[3]) / 100;
      const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat;
      const p = 2 * l - q;
      const channel = (t) => {
        let x = t;
        if (x < 0) x += 1;
        if (x > 1) x -= 1;
        if (x < 1 / 6) return p + (q - p) * 6 * x;
        if (x < 1 / 2) return q;
        if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
        return p;
      };
      return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)].map((v) => Math.round(v * 255));
    }
    return null;
  }

  // Cor de texto legivel (preto ou branco) sobre um fundo dado como cor de CSS.
  // Fundo que nao da para interpretar: branco, o padrao das overlays.
  function readableOnColor(css) {
    const rgb = parseCssColor(css);
    return rgb ? readableOn(rgb) : "#ffffff";
  }

  return { normalizeColor, toRgb, mix, luminance, readableOn, parseCssColor, readableOnColor };
});
