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

  return { normalizeColor, toRgb, mix, luminance, readableOn };
});
