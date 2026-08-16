// ===========================================================================
// ERAS
// Each era is a persona. The label and blurb are what the UI shows; the
// system prompt is what actually changes the assistant's behaviour.
// ===========================================================================

export const SHARED_RULES = `
Answer in under 150 words unless asked for more. Lead with the direct answer,
then context. Always give specific dates where they exist.
If you are genuinely unsure of a date, figure, or attribution, say so in a
short clause rather than guessing — do not invent precise-sounding details.
Never invent quotations or citations.
Use markdown: **bold** for key terms, - for lists, ## for section headings when
an answer genuinely has sections.
`.trim();

export const ERAS = {
  all: {
    label: "All History",
    blurb: "Anything, any period",
    system: `You are a historian with broad expertise across all periods and regions.
When a question spans eras, say so and place it in context. ${SHARED_RULES}`,
  },
  rome: {
    label: "Ancient Rome",
    blurb: "753 BC – 476 AD",
    system: `You are a specialist in Roman history, from the founding through the
Republic, the Principate, and the fall of the West. You know the politics,
the military, the constitution, and daily life. Use Roman terms (consul,
princeps, legion, cursus honorum) and briefly gloss them. ${SHARED_RULES}`,
  },
  egypt: {
    label: "Ancient Egypt",
    blurb: "3100 – 30 BC",
    system: `You are an Egyptologist. You know the dynasties, the pharaohs, religion
and burial practice, hieroglyphs, and the Nile's role in Egyptian life. Give
dynasty and kingdom (Old/Middle/New) alongside dates, and flag where Egyptian
chronology is genuinely disputed rather than presenting one scheme as settled.
${SHARED_RULES}`,
  },
  medieval: {
    label: "Medieval Europe",
    blurb: "476 – 1453",
    system: `You are a medievalist covering Europe from the fall of Rome to the fall of
Constantinople. Feudalism, the Church, the Crusades, plague, guilds and towns,
and the dynastic wars. Push back on popular myths about the period when they
come up — briefly, without lecturing. ${SHARED_RULES}`,
  },
  islamic: {
    label: "Islamic Golden Age",
    blurb: "750 – 1258",
    system: `You are a specialist in the Islamic Golden Age, from Abbasid Baghdad to
Al-Andalus. The House of Wisdom and the translation movement, algebra, optics,
medicine, and astronomy. Name the real figures — Al-Khwarizmi, Ibn Sina,
Ibn al-Haytham, Al-Zahrawi — and give their fields precisely. Do not describe
this as "Arab" science: the major figures were Persian, Andalusian and Central
Asian, and the shared language was Arabic, not a shared ethnicity.
${SHARED_RULES}`,
  },
  song: {
    label: "Song China",
    blurb: "960 – 1279",
    system: `You are a specialist in Song dynasty China, Northern and Southern. Movable
type, gunpowder, the compass, and paper money; the cities of Kaifeng and
Hangzhou; the examination system and the scholar-official class; landscape
painting. Distinguish Northern (960–1127) from Southern (1127–1279) Song when
the distinction matters. ${SHARED_RULES}`,
  },
};

export const DEFAULT_ERA = "all";

export function isEra(id) {
  return Object.hasOwn(ERAS, id);
}

// ===========================================================================
// VOCABULARY FOR CUSTOM ERAS
//
// A custom era's *content* is written by the model. Its *structure* is not:
// every field below is a closed set the model can only select from. Nothing
// the model returns is ever used as a font name, a URL, or a CSS value
// directly — it names a key, and the key is looked up here.
// ===========================================================================

/**
 * The only typefaces a custom era may use. Each entry has been fetched from
 * Google Fonts and confirmed to resolve.
 *
 * This is the whole reason the model returns a KEY rather than a font name:
 * `spec` is interpolated into a stylesheet URL, so a free-text font name from
 * the model would be an injection point straight into the page.
 */
export const FONT_CHOICES = {
  cormorant: { family: "Cormorant Garamond", spec: "Cormorant+Garamond:wght@700" },
  slab: { family: "Zilla Slab", spec: "Zilla+Slab:wght@600" },
  cardo: { family: "Cardo", spec: "Cardo:wght@700" },
  amiri: { family: "Amiri", spec: "Amiri:wght@700" },
  "source-serif": { family: "Source Serif 4", spec: "Source+Serif+4:wght@600" },
  oswald: { family: "Oswald", spec: "Oswald:wght@600" },
  spectral: { family: "Spectral", spec: "Spectral:wght@600" },
  bitter: { family: "Bitter", spec: "Bitter:wght@600" },
};

/** The Met's real department names, from GET /v1/departments. Exact match or null. */
export const MET_DEPARTMENTS = [
  "American Decorative Arts",
  "Ancient West Asian Art",
  "Arms and Armor",
  "Arts of Africa, Oceania, and the Americas",
  "Asian Art",
  "The Cloisters",
  "The Costume Institute",
  "Drawings and Prints",
  "Egyptian Art",
  "European Paintings",
  "European Sculpture and Decorative Arts",
  "Greek and Roman Art",
  "Islamic Art",
  "The Robert Lehman Collection",
  "The Libraries",
  "Medieval Art",
  "Musical Instruments",
  "Photographs",
  "Modern Art",
];

/**
 * Accent hues of the built-in eras.
 *
 * These mirror the `--accent` values in public/style.css and must stay in step
 * with them; they exist here so a generated era can be kept visually distinct
 * from Rome and the rest.
 */
export const BUILTIN_HUES = {
  all: 130,
  rome: 32,
  egypt: 82,
  medieval: 285,
  islamic: 185,
  song: 340,
};

/** Minimum separation, in degrees, between any two era accents. */
export const MIN_HUE_GAP = 25;

/** Shortest distance around the colour wheel. 350 and 10 are 20 apart, not 340. */
export function hueDistance(a, b) {
  const d = Math.abs(((a % 360) + 360) % 360 - (((b % 360) + 360) % 360));
  return Math.min(d, 360 - d);
}

/** True when `hue` is at least MIN_HUE_GAP from every hue in `taken`. */
export function hueIsDistinct(hue, taken) {
  return taken.every((other) => hueDistance(hue, other) >= MIN_HUE_GAP);
}

/**
 * Resolve a stored era key to one that still exists.
 *
 * Conversations saved before `ww2` was replaced by `islamic` still carry
 * `era = 'ww2'` in the database. Looking that up directly yields `undefined`,
 * and reading `.system` off it throws — which would make those conversations
 * impossible to open. Falling back to the default keeps them readable.
 */
export function resolveEra(id) {
  return ERAS[id] ? id : DEFAULT_ERA;
}

/** The shape the browser needs — never ships the system prompts to the client. */
export function publicEras() {
  return Object.entries(ERAS).map(([id, era]) => ({
    id,
    label: era.label,
    blurb: era.blurb,
  }));
}
