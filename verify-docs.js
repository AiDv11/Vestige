/**
 * Documentation verifier — checks that README.md and CLAUDE.md still describe
 * the code that is actually here.
 *
 * Why this exists: the React rewrite landed and both documents went on saying
 * the frontend was "vanilla HTML, CSS and JavaScript — no framework, no build
 * step" for a while afterwards. Nothing failed, because nothing was checking.
 * Prose rots silently; that is the whole problem with it. These checks are the
 * cheapest available smoke alarm.
 *
 * Run it:  node verify-docs.js
 * Exit code is 1 if any check fails, so CI can use it.
 *
 * Same rules as the rest of the test scripts here (CLAUDE.md §10):
 * assertions must be strict enough to fail, and you should prove one bites by
 * breaking it before trusting a green run.
 */

import { readFileSync, existsSync } from "node:fs";
import { FONT_CHOICES, MET_DEPARTMENTS, MIN_HUE_GAP, ERAS } from "./lib/eras.js";

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");

// Read from source rather than importing lib/customEras.js. That module pulls
// in lib/chat.js, which constructs the Groq client at import time and throws if
// GROQ_API_KEY is missing — and a documentation check has no business needing
// an API key, or a network, to run.
const MAX_NAME_LENGTH = Number(
  read("lib/customEras.js").match(/MAX_NAME_LENGTH\s*=\s*(\d+)/)?.[1],
);

const README = read("README.md");
const CLAUDE = read("CLAUDE.md");
const SERVER = read("server.js");
const GITIGNORE = read(".gitignore");
const RENDER = read("render.yaml");
const PKG = JSON.parse(read("package.json"));
const CLIENT_PKG = JSON.parse(read("client/package.json") || "{}");

const DOCS = [
  ["README.md", README],
  ["CLAUDE.md", CLAUDE],
];

let failures = 0;
let checks = 0;

function check(label, ok, detail = "") {
  checks++;
  if (ok) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n          ${detail}` : ""}`);
  }
}

function group(name) {
  console.log(`\n${name}`);
}

// ---------------------------------------------------------------------------
// 1. The build wiring itself.
//
// These read the config files rather than the docs. If one of these fails the
// app is broken, not just mis-described — and the docs below are describing
// something that no longer exists either way.
// ---------------------------------------------------------------------------

group("Build wiring");

for (const f of [
  "client/index.html",
  "client/vite.config.js",
  "client/src/main.jsx",
  "client/src/App.jsx",
  "client/src/Markdown.jsx",
  "client/src/useEra.js",
  "client/src/style.css",
]) {
  check(`${f} exists`, existsSync(f));
}

check(
  "server.js serves client/dist",
  /express\.static\(\s*["']client\/dist["']/.test(SERVER),
  "expected app.use(express.static(\"client/dist\"))",
);

check(
  "server.js no longer serves public/",
  !/express\.static\(\s*["']public["']/.test(SERVER),
  "public/ is the old vanilla frontend — it is kept as reference, not served",
);

check(
  "package.json has a build script that builds the client",
  /cd client/.test(PKG.scripts?.build ?? "") &&
    /npm run build/.test(PKG.scripts?.build ?? ""),
  `build = ${JSON.stringify(PKG.scripts?.build)}`,
);

check(
  "render.yaml builds the client",
  /buildCommand:.*npm run build/.test(RENDER),
);

// npm start runs `node --watch`. Shipping that to production means a file
// watcher in a container, and a restart loop if anything ever writes to disk.
check(
  "render.yaml starts with `npm run server`, not `npm start`",
  /startCommand:\s*npm run server\b/.test(RENDER),
  "`npm start` runs --watch; that has no business in production",
);

check("client/dist is gitignored", /^client\/dist\/?$/m.test(GITIGNORE));

// ---------------------------------------------------------------------------
// 2. Dependencies.
//
// Both docs claim "three runtime dependencies". That claim is only honest if
// react lives in the client's package.json and not in the root one.
// ---------------------------------------------------------------------------

group("Dependencies");

const rootDeps = Object.keys(PKG.dependencies ?? {}).sort();
const clientDeps = Object.keys(CLIENT_PKG.dependencies ?? {});

check(
  "root has exactly three runtime dependencies",
  rootDeps.length === 3 &&
    ["dotenv", "express", "groq-sdk"].every((d) => rootDeps.includes(d)),
  `found: ${rootDeps.join(", ") || "none"}`,
);

check(
  "react is a client dependency, not a server one",
  !rootDeps.includes("react") &&
    !rootDeps.includes("react-dom") &&
    clientDeps.includes("react") &&
    clientDeps.includes("react-dom"),
  `root: ${rootDeps.join(", ")} | client: ${clientDeps.join(", ")}`,
);

for (const [name, text] of DOCS) {
  check(
    `${name} says react/react-dom are build dependencies, not runtime ones`,
    /react[^\n]*(build|bundle)|\b(build|client)[^\n]*react-dom/i.test(text),
  );
}

// ---------------------------------------------------------------------------
// 3. Stale phrases.
//
// This is the check that would have caught the React drift. Each entry is a
// sentence that was true of the vanilla-only app and became false the moment
// the build step landed. A doc may still *describe* the old frontend — that is
// deliberate, public/ is kept as a reference — so these patterns are written
// to match the claim-as-current-fact, not any mention of the past.
// ---------------------------------------------------------------------------

group("Stale claims");

const STALE = [
  [
    /no framework,? no build step/i,
    "the frontend has a build step now (Vite)",
  ],
  [
    /frontend is three files the browser reads directly/i,
    "the browser reads client/dist, which Vite generates",
  ],
  [
    /files in `?public\/`? are re-read/i,
    "public/ is not served at all any more",
  ],
  [
    /\|\s*Frontend\s*\|[^|\n]*[Vv]anilla[^|\n]*\|/,
    "the Frontend row of the stack table should name React + Vite",
  ],
  [
    /deployment status is unconfirmed/i,
    "deployment is confirmed live",
  ],
  [
    /\*\*The React frontend rewrite\*\*\s*—\s*phase 2/i,
    "the rewrite is done; it does not belong under 'what is not built'",
  ],
];

for (const [name, text] of DOCS) {
  for (const [pattern, why] of STALE) {
    check(`${name} free of: ${pattern.source.slice(0, 46)}`, !pattern.test(text), why);
  }
}

// ---------------------------------------------------------------------------
// 4. Things both docs must now say.
//
// The inverse of the above: a doc that never mentions the build step cannot be
// describing this app correctly, however carefully it avoids stale phrases.
// ---------------------------------------------------------------------------

group("Required coverage");

const REQUIRED = [
  [/client\/dist/, "names the build output the server actually serves"],
  [/npm run build/, "tells you to build before there is a UI"],
  [/client\/src\/App\.jsx/, "file map includes the client"],
  [/5173/, "documents the Vite dev server port"],
  [/npm run dev/, "documents the dev workflow"],
  [/public\/[^\n]{0,80}(no longer served|not served)/i, "says public/ is no longer served"],
  [/dangerouslySetInnerHTML/, "states the escaping claim in checkable terms"],
];

for (const [name, text] of DOCS) {
  for (const [pattern, why] of REQUIRED) {
    check(`${name} ${why}`, pattern.test(text));
  }
}

// ---------------------------------------------------------------------------
// 5. The escaping claim.
//
// Both docs now assert that dangerouslySetInnerHTML appears nowhere in the
// client, and offer that as the whole audit. That is a strong claim to put in
// a README, so it gets checked rather than trusted. Markdown.jsx returning
// React elements is what makes it possible to keep.
// ---------------------------------------------------------------------------

group("Escaping is structural");

const clientSource = [
  "client/src/App.jsx",
  "client/src/Markdown.jsx",
  "client/src/useEra.js",
  "client/src/main.jsx",
  "client/index.html",
]
  .map(read)
  .join("\n");

check(
  "dangerouslySetInnerHTML appears nowhere in client/",
  !/dangerouslySetInnerHTML/.test(clientSource),
);

// Comments are stripped first: Markdown.jsx explains at the top that the
// vanilla version "ends at innerHTML", and a check that can't tell an
// explanation from an assignment would fail on the comment that documents the
// very property being checked.
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const markdownCode = stripComments(read("client/src/Markdown.jsx"));

check(
  "Markdown.jsx builds React elements, not an HTML string",
  /from ["']react["']/.test(markdownCode) && !/innerHTML/.test(markdownCode),
);

// ---------------------------------------------------------------------------
// 6. Numbers in the prose.
//
// The README states several counts as facts. They are cheap to derive from the
// code, so there is no reason to let them drift.
// ---------------------------------------------------------------------------

group("Numbers claimed in prose");

const WORDS = {
  3: "three",
  6: "six",
  8: "eight",
  12: "twelve",
  19: "nineteen",
  25: "25",
  60: "60",
};

// Accepts either the digit or the spelled-out word, since the docs mix both.
function statesNumber(text, n, context) {
  const word = WORDS[n];
  const pattern = new RegExp(
    `(${n}|${word})[^.\\n]{0,60}${context}|${context}[^.\\n]{0,60}(${n}|${word})`,
    "i",
  );
  return pattern.test(text);
}

const fontCount = Object.keys(FONT_CHOICES).length;
const eraCount = Object.keys(ERAS).length;
const deptCount = MET_DEPARTMENTS.length;
const routeCount = (SERVER.match(/^app\.(get|post|patch|put|delete)\(/gm) ?? []).length;

check(
  `README states ${fontCount} vetted fonts`,
  statesNumber(README, fontCount, "fonts?"),
  `FONT_CHOICES has ${fontCount}`,
);

check(
  `README states ${deptCount} valid Met departments`,
  statesNumber(README, deptCount, "valid values"),
  `MET_DEPARTMENTS has ${deptCount}`,
);

check(
  `README states the ${MIN_HUE_GAP}° hue gap`,
  new RegExp(`${MIN_HUE_GAP}\\s*°`).test(README),
  `MIN_HUE_GAP is ${MIN_HUE_GAP}`,
);

check(
  `README states the ${MAX_NAME_LENGTH}-character name cap`,
  new RegExp(`${MAX_NAME_LENGTH}-character`).test(README),
  `MAX_NAME_LENGTH is ${MAX_NAME_LENGTH}`,
);

check(
  `CLAUDE.md states ${eraCount} built-in eras`,
  statesNumber(CLAUDE, eraCount, "built-in eras"),
  `ERAS has ${eraCount}: ${Object.keys(ERAS).join(", ")}`,
);

// The route count is printed at startup precisely so a stale server is
// obvious. The docs quote a sample of that line, so the sample should be real.
for (const [name, text] of DOCS) {
  const quoted = text.match(/(\d+) routes \| database/);
  check(
    `${name} quotes the real route count (${routeCount})`,
    quoted ? Number(quoted[1]) === routeCount : true,
    quoted ? `doc says ${quoted[1]}, server registers ${routeCount}` : "",
  );
}

// ---------------------------------------------------------------------------
// 7. Every path the docs name should exist.
//
// The general version of check 3: catches a file map that drifts from the tree
// in either direction. client/dist and data/ are generated, so they are exempt.
// ---------------------------------------------------------------------------

group("Paths named in the docs");

const GENERATED = /^(client\/dist|data|node_modules|\.env)/;
const EXT = "js|jsx|css|html|svg|png|json|yaml|md";

// Backticked paths in prose: `lib/artifacts.js`
const INLINE_PATH = new RegExp(`\`([a-zA-Z0-9_./-]+\\.(?:${EXT}))\``, "g");

// Paths at the start of a line inside a fence — the file-map format:
//     lib/artifacts.js     Met Museum lookup
// Worth checking separately, and the first version of this script missed it.
// The file map is the single most drift-prone part of either document, and it
// writes its paths bare, so a check that only understood backticks was
// inspecting everything except the place that goes wrong.
const FENCED_PATH = new RegExp(`^([a-zA-Z0-9_./-]+\\.(?:${EXT}))\\s`, "gm");

for (const [name, text] of DOCS) {
  const missing = new Set();
  const fences = (text.match(/```[\s\S]*?```/g) ?? []).join("\n");

  const candidates = [
    ...[...text.matchAll(INLINE_PATH)].map((m) => m[1]),
    ...[...fences.matchAll(FENCED_PATH)].map((m) => m[1]),
  ];

  for (const p of candidates) {
    if (GENERATED.test(p)) continue;
    if (!p.includes("/")) continue; // bare filenames like `package.json` in prose
    if (!existsSync(p)) missing.add(p);
  }

  check(
    `${name} names only paths that exist`,
    missing.size === 0,
    missing.size ? `missing: ${[...missing].join(", ")}` : "",
  );
}

// ---------------------------------------------------------------------------

console.log(
  `\n${failures ? "FAILED" : "PASSED"} — ${checks - failures}/${checks} checks\n`,
);

process.exit(failures ? 1 : 0);
