import { useEffect } from "react";

/**
 * The React port of applyEra() and loadEraFont() in public/app.js.
 *
 * This is a legitimate useEffect — unlike the streaming, which was a user
 * event. Theming writes to document.documentElement and appends <link> tags,
 * both of which are outside the React tree. Synchronising an external system
 * to your state is exactly what effects are for.
 */

// Mirrors lib/eras.js. A custom era stores a KEY from this map, never a font
// name — `spec` is interpolated into a stylesheet URL, so free text would be
// an injection point.
const FONT_CHOICES = {
  cormorant: { family: "Cormorant Garamond", spec: "Cormorant+Garamond:wght@700" },
  slab: { family: "Zilla Slab", spec: "Zilla+Slab:wght@600" },
  cardo: { family: "Cardo", spec: "Cardo:wght@700" },
  amiri: { family: "Amiri", spec: "Amiri:wght@700" },
  "source-serif": { family: "Source Serif 4", spec: "Source+Serif+4:wght@600" },
  oswald: { family: "Oswald", spec: "Oswald:wght@600" },
  spectral: { family: "Spectral", spec: "Spectral:wght@600" },
  bitter: { family: "Bitter", spec: "Bitter:wght@600" },
};

// "all" has no entry, so the first paint still costs zero webfonts.
const ERA_FONT = {
  rome: "cormorant",
  egypt: "slab",
  medieval: "cardo",
  islamic: "amiri",
  song: "source-serif",
};

// Module scope, deliberately: this must survive re-renders AND StrictMode's
// double-mount in development. A useRef would reset on remount and append the
// same stylesheet twice.
const loadedFonts = new Set();

function loadFont(key) {
  const choice = FONT_CHOICES[key];
  if (!choice || loadedFonts.has(key)) return;
  loadedFonts.add(key);

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${choice.spec}&display=swap`;
  document.head.append(link);
}

// Set inline for a custom era, removed for built-ins so the [data-era] rules
// in the stylesheet take over again.
const THEMED = [
  "--accent",
  "--tint",
  "--tint-hi",
  "--font-display",
  "--display-weight",
  "--display-tracking",
];

/**
 * @param eras    the list from /api/eras
 * @param eraId   the era to display. Pass `hovered ?? selected` to reproduce
 *                the hover-preview behaviour from the vanilla era picker.
 */
export function useEra(eras, eraId) {
  useEffect(() => {
    const era = eras.find((e) => e.id === eraId);
    const root = document.documentElement;

    if (era?.custom) {
      // Range-checked server-side already; re-normalise anyway, because it is
      // about to be interpolated into a CSS colour.
      const hue = ((Number(era.hue) % 360) + 360) % 360 || 0;
      const family = FONT_CHOICES[era.font]?.family;

      root.dataset.era = "custom";
      root.style.setProperty("--accent", `oklch(0.66 0.15 ${hue})`);
      root.style.setProperty("--tint", `oklch(0.09 0.008 ${hue})`);
      root.style.setProperty("--tint-hi", `oklch(0.13 0.012 ${hue})`);
      root.style.setProperty("--display-weight", "600");
      root.style.setProperty("--display-tracking", "-0.02em");
      if (family) {
        root.style.setProperty("--font-display", `"${family}", Georgia, serif`);
      }
    } else {
      // Same fallback as resolveEraFor on the server: an unknown key (a
      // retired built-in, or a deleted custom era) resolves to the default
      // rather than leaving the page unthemed.
      root.dataset.era = era ? eraId : "all";
      for (const prop of THEMED) root.style.removeProperty(prop);
    }

    loadFont(era?.custom ? era.font : ERA_FONT[eraId]);
  }, [eras, eraId]);
}