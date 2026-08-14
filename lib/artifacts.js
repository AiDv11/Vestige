// ===========================================================================
// ARTIFACTS — The Metropolitan Museum of Art Open Access API
//
// The model can invent dates. A real museum object can't: it has a catalogue
// number, a photograph, and a curator's date. Showing one beside an answer
// turns "trust me" into "here is the thing".
//
// No API key, no auth. https://metmuseum.github.io/
//
// Three things this module has to survive, all found by testing the live API:
//
//   1. `departmentId` combined with `q` is broken — "pharaoh" filtered to
//      Egyptian Art returns ONE result. So the filtering is done here, on the
//      objects we fetch back, not in the query.
//
//   2. `hasImages=true` destroys relevance — with it on, a nonsense query
//      ("zzzqqxx") returns 128 hits. So it is never sent; objects without a
//      photograph are dropped locally instead.
//
//   3. Firing ~24 parallel object requests gets you blocked by their bot
//      protection, which answers with HTML instead of JSON. Hence the small
//      batches, the pause between them, the User-Agent, and the content-type
//      check below.
// ===========================================================================

const BASE = "https://collectionapi.metmuseum.org/public/collection/v1";

const USER_AGENT =
  "HistoryBot/1.0 (educational portfolio project; +https://github.com/AiDv11/history-bot)";

/**
 * Which Met departments count as evidence for each era, plus a hint appended
 * to the search to bias it toward the right period.
 *
 * `departments: null` disables artifacts for that era entirely. WWII is the
 * case: the Met is an art museum with essentially no Second World War
 * holdings, and testing showed the search happily returns a portrait from
 * 1866 for "Operation Barbarossa". A wrong artifact is worse than none — the
 * whole point of this feature is that the evidence is real.
 */
const ERA_SOURCES = {
  all: {
    hint: "",
    departments: [
      "Greek and Roman Art",
      "Egyptian Art",
      "Medieval Art",
      "The Cloisters",
      "Ancient West Asian Art",
      "Islamic Art",
      "Asian Art",
      "Arms and Armor",
      "European Paintings",
      "European Sculpture and Decorative Arts",
      "Arts of Africa, Oceania, and the Americas",
      "Drawings and Prints",
    ],
  },
  rome: { hint: "roman", departments: ["Greek and Roman Art"] },
  egypt: { hint: "ancient egypt", departments: ["Egyptian Art"] },
  medieval: {
    hint: "medieval",
    departments: ["Medieval Art", "The Cloisters", "Arms and Armor"],
  },
  ww2: { hint: "", departments: null },
};

// Question scaffolding carries no search signal and actively hurts results.
const STOPWORDS = new Set(
  `a an the of in on at to for from by with and or but is was were are be been
   what who when where why how did do does was were which whose whom that this
   these those it its his her their my your our me you he she they them we us
   about into over under after before during tell explain describe give me
   please can could would should really actually just some any more most`
    .split(/\s+/)
    .filter(Boolean),
);

/** Turn a natural question into a keyword query the Met search can use. */
function toQuery(question, hint) {
  const words = question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .slice(0, 8);

  return [...words, hint].filter(Boolean).join(" ").trim();
}

// --- polite HTTP ------------------------------------------------------------

async function getJSON(path, signal) {
  const res = await fetch(BASE + path, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal,
  });

  if (!res.ok) throw new Error(`Met API ${res.status}`);

  // Bot protection answers with an HTML challenge page and a 200. Parsing
  // that as JSON throws a confusing SyntaxError, so check first.
  const type = res.headers.get("content-type") || "";
  if (!type.includes("json")) throw new Error("Met API returned non-JSON");

  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function inBatches(items, size, fn, pause = 150) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
    if (i + size < items.length) await sleep(pause);
  }
  return out;
}

// --- cache ------------------------------------------------------------------

const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours
const CACHE_MAX = 300;
const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  // Refresh insertion order so this stays the most-recently-used.
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
}

function cacheSet(key, value) {
  cache.set(key, { at: Date.now(), value });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

// --- relevance --------------------------------------------------------------

/**
 * How well an object matches what was asked. The department filter already
 * removes the badly wrong ones; this ranks what's left so the best two or
 * three surface rather than an arbitrary two or three.
 */
function score(object, terms) {
  const haystack = [
    object.title,
    object.culture,
    object.period,
    object.objectName,
    object.artistDisplayName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  let s = terms.reduce((n, t) => (haystack.includes(t) ? n + 1 : n), 0);

  if (object.isHighlight) s += 0.5; // curator-flagged standouts
  if (object.primaryImageSmall) s += 0.25;

  return s;
}

function normalise(object) {
  return {
    id: object.objectID,
    title: object.title || "Untitled",
    date: object.objectDate || "",
    culture: object.culture || object.period || object.department || "",
    medium: object.medium || "",
    image: object.primaryImageSmall,
    url: object.objectURL,
    credit: object.creditLine || "",
  };
}

// --- public -----------------------------------------------------------------

/**
 * Find museum objects that support an answer.
 *
 * Never throws and never blocks the chat: on any failure — network, bot
 * block, timeout, thin results — it returns an empty array and the reply
 * simply appears without artifacts.
 *
 * @returns {Promise<Array>} at most `limit` objects, best match first
 */
export async function findArtifacts(era, question, { limit = 3, timeoutMs = 12_000 } = {}) {
  const source = ERA_SOURCES[era];
  if (!source?.departments) return []; // era has no usable holdings

  const query = toQuery(question, source.hint);
  if (!query) return [];

  const key = `${era}:${query}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const found = await getJSON(
      "/search?" + new URLSearchParams({ q: query }),
      controller.signal,
    );

    const ids = (found.objectIDs || []).slice(0, 12);
    if (ids.length === 0) {
      cacheSet(key, []);
      return [];
    }

    const objects = (
      await inBatches(ids, 4, async (id) => {
        try {
          return await getJSON(`/objects/${id}`, controller.signal);
        } catch {
          return null; // one bad object shouldn't sink the batch
        }
      })
    ).filter(Boolean);

    const terms = query.split(" ").filter((t) => t.length > 2);

    // The collection catalogues related pieces separately — the panels of one
    // wall painting, or two busts of the same emperor, arrive as distinct
    // objects with identical titles. Showing the same caption twice reads as
    // a bug, so keep only the best-scoring object per title.
    const seen = new Set();

    const results = objects
      .filter((o) => o.primaryImageSmall && source.departments.includes(o.department))
      .map((o) => ({ object: o, score: score(o, terms) }))
      .sort((a, b) => b.score - a.score)
      .filter(({ object }) => {
        const key = object.title.trim().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit)
      .map(({ object }) => normalise(object));

    cacheSet(key, results);
    return results;
  } catch {
    return []; // enhancement only — a failure here is invisible to the user
  } finally {
    clearTimeout(timer);
  }
}

export { ERA_SOURCES };
