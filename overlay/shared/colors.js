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

  return { normalizeColor };
});
