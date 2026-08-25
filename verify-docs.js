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

import { readFileSync, existsSync, readdirSync } from "node:fs";
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
// 7. Measured numbers, and the suite that produced them.
//
// Section 6 checks numbers that are DERIVABLE — count the fonts, count the
// routes, and you know whether the prose is right. These are the other kind:
// numbers that exist only because somebody ran something. "6 of 8 runs
// compromised". "5 failures". Nothing derives them, so nothing notices when
// they stop being true, and they are the most persuasive sentences in either
// document precisely because they sound like evidence.
//
// Both documents carried wrong ones, and not briefly. CLAUDE.md §7 credited
// message-edit truncation to a mutation that "produced 9 failures" — the suite
// that produced the 9 had been written to a scratch directory and lost, and
// the rebuilt one produces 5. §6 described the injection defence as two
// findings, tested and contained, while the third and decisive one had not
// been found yet. Same failure both times: the prose outlived the run behind
// it, and the run was not somewhere anyone could repeat.
//
// So the rule is that a measured number quoted in a document has to be
// recorded in the test file that measures it, on a `// MEASURED: key = …`
// line, and the two have to agree. This catches drift in both directions:
//
//   - a document quoting a number the suite does not record;
//   - a document and a suite disagreeing about a number they both state;
//   - a claim quietly DELETED from one document rather than corrected, which
//     is the direction a checker built only from the docs cannot see.
//
// It does not, and cannot, verify that the recorded number is what a fresh run
// would produce. Nothing short of re-running the mutation does that. What it
// buys is that the number has one home instead of three, and that home is next
// to the code that measures it.
//
// SCOPE, stated honestly: the sweep below recognises measurement-SHAPED text —
// `N/M`, `N of M`, `N failures/runs/trials`. A measured number written in
// another shape ("returns 128 hits") slips through. Widening the shapes is
// cheap; guessing which prose numbers are measurements is not, and a checker
// that cries wolf gets deleted. Add a shape when a claim needs one.
//
// Proven to bite (§10 — a green run means nothing if red was unreachable).
// Each of these was applied, run, and reverted:
//
//   a doc quoting a stale number ........................ RED
//   a MEASURED line deleted from the suite .............. RED
//   a suite and a doc disagreeing about a number ........ RED
//   a claim deleted from one doc instead of corrected ... RED
//   a new measured number added to prose only ........... RED
//   a suite on disk that run.js never runs .............. RED
// ---------------------------------------------------------------------------

group("Measured numbers vs. the suite that produced them");

const TEST_DIR = "tests";
const testFiles = existsSync(TEST_DIR)
  ? readdirSync(TEST_DIR)
      .filter((f) => f.endsWith(".test.js"))
      .map((f) => `${TEST_DIR}/${f}`)
  : [];

check("there are test files to check the docs against", testFiles.length > 0, TEST_DIR);

// Every suite on disk has to be registered in the runner. An unregistered
// suite is this same bug in miniature: a file that looks like proof and never
// runs.
const RUNNER = read("tests/run.js");
const unregistered = testFiles.filter(
  (f) => !RUNNER.includes(f.slice(TEST_DIR.length + 1)),
);
check(
  "every suite in tests/ is registered in tests/run.js",
  unregistered.length === 0,
  unregistered.length ? `not in SUITES: ${unregistered.join(", ")}` : "",
);

const integersIn = (s) => (s.match(/\d+/g) ?? []).map(Number);

// `// MEASURED: key = 6 of 8 runs compromised`  ->  key => [6, 8]
const MEASURED_LINE =
  /^[ \t]*\/\/[ \t]*MEASURED:[ \t]*([a-z0-9-]+)[ \t]*=[ \t]*(.+)$/gm;

const measured = new Map();
for (const file of testFiles) {
  for (const [, key, value] of read(file).matchAll(MEASURED_LINE)) {
    measured.set(key, { file, value: value.trim(), numbers: integersIn(value) });
  }
}

/**
 * Every measured claim the documents are allowed to make.
 *
 * `quotes` are the exact phrasings, and they are deliberately specific: a
 * pattern loose enough to survive a rewrite is loose enough to match the wrong
 * sentence. If a rewrite breaks one of these, that is the check working — the
 * sentence carrying the number changed, so somebody should confirm the number
 * still belongs in it.
 *
 * Every doc must state each claim at least once, and EVERY occurrence of one
 * in either doc must agree with the MEASURED line.
 */
const MEASURED_CLAIMS = [
  {
    key: "injection-rule-before-slot-only",
    what: "runs compromised with the containment rule stated only before the slot",
    quotes: [
      /\*\*(\d+) of (\d+) runs compromised\*\*/g,
      /and (\d+) of (\d+) got through/g,
    ],
  },
  {
    key: "injection-rule-restated-after-slot",
    what: "runs compromised once the rule is restated after the closing marker",
    quotes: [/\*\*(\d+) of (\d+)\s+compromised\*\*/g],
  },
  {
    key: "edit-truncation-off-by-one",
    what: "failing checks when edit truncation is mutated off by one",
    quotes: [/produced \*{0,2}(\d+) failures?\*{0,2}/g],
  },
];

// Ranges of each doc that a registered claim accounts for, so the sweep below
// can tell a checked number from an unchecked one.
const covered = new Map(DOCS.map(([name]) => [name, []]));

for (const claim of MEASURED_CLAIMS) {
  const record = measured.get(claim.key);

  check(
    `tests/ records a measurement for "${claim.key}"`,
    !!record,
    record
      ? ""
      : `no "// MEASURED: ${claim.key} = …" line in ${testFiles.join(", ") || "tests/"}`,
  );
  if (!record) continue;

  check(
    `  ${claim.key} = ${record.value} (${record.file})`,
    record.numbers.length > 0,
    "a MEASURED line with no number in it records nothing",
  );

  for (const [name, text] of DOCS) {
    const found = [];
    for (const quote of claim.quotes) {
      for (const m of text.matchAll(quote)) {
        found.push(m);
        covered.get(name).push([m.index, m.index + m[0].length]);
      }
    }

    check(
      `${name} states ${claim.what}`,
      found.length > 0,
      `expected one of: ${claim.quotes.map((q) => q.source).join("  |  ")}`,
    );

    for (const m of found) {
      const quoted = m.slice(1).map(Number);
      check(
        `${name}: "${m[0].replace(/\s+/g, " ")}" agrees with ${record.file}`,
        quoted.length === record.numbers.length &&
          quoted.every((n, i) => n === record.numbers[i]),
        `doc says ${quoted.join("/")}, ${record.file} records ${record.numbers.join("/")} — ` +
          "re-measure and update both, or the number is fiction",
      );
    }
  }
}

// A MEASURED line nothing quotes is not a failure: a suite is allowed to record
// more than the prose uses. Worth naming, though, because it is usually a claim
// that got deleted from the docs instead of corrected.
const quotedKeys = new Set(MEASURED_CLAIMS.map((c) => c.key));
for (const [key, record] of measured) {
  if (quotedKeys.has(key)) continue;
  console.log(`  note  ${record.file} records "${key}" (${record.value}), which no doc quotes`);
}

// The sweep: measurement-shaped text in either document that no claim above
// accounts for. This is what stops the next number from being added to the
// prose alone.
const MEASUREMENT_SHAPES = [
  /\b\d+\s*\/\s*\d+\b/g,
  /\b\d+ of \d+\b/g,
  /\b\d+ (?:failures?|runs?|trials?)\b/g,
];

for (const [name, text] of DOCS) {
  const ranges = covered.get(name);
  const loose = new Set();

  for (const shape of MEASUREMENT_SHAPES) {
    for (const m of text.matchAll(shape)) {
      const start = m.index;
      const end = start + m[0].length;
      if (ranges.some(([from, to]) => start >= from && end <= to)) continue;
      const context = text.slice(Math.max(0, start - 44), end).replace(/\s+/g, " ").trim();
      loose.add(`"${m[0]}"  …${context}`);
    }
  }

  check(
    `${name} quotes no measured number the suite does not record`,
    loose.size === 0,
    loose.size ? [...loose].join("\n          ") : "",
  );
}

// ---------------------------------------------------------------------------
// 8. The screenshot.
//
// A README screenshot fails in a particular way: the file goes missing, or is
// never committed, and GitHub renders a broken-image icon to everybody except
// the person who has it on disk. `existsSync` alone does not catch that — this
// file was added as a 0-BYTE PLACEHOLDER, which exists, is referenced, and
// renders as nothing at all. So the check reads the magic bytes.
//
// The alt text is checked too, because an image in a README is documentation
// and alt text is the part of it that has to work without eyes.
//
// Proven to bite (§10), each applied against a temporary real PNG and reverted:
//
//   the file deleted ..................................... RED
//   the file truncated to 0 bytes ........................ RED
//   a JPEG renamed .png .................................. RED
//   the embed removed from the README .................... RED
//   alt text reduced to "screenshot" ..................... RED
//   the embed moved below the first section heading ...... RED
// ---------------------------------------------------------------------------

group("Screenshot");

const SCREENSHOT = "client/public/screenshot.png";
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const screenshotBytes = existsSync(SCREENSHOT) ? readFileSync(SCREENSHOT) : null;

check(
  `${SCREENSHOT} exists`,
  screenshotBytes !== null,
  "the README embeds it; without the file GitHub renders a broken image",
);

check(
  `${SCREENSHOT} is a real PNG, not an empty placeholder`,
  screenshotBytes !== null &&
    screenshotBytes.length > PNG_MAGIC.length &&
    screenshotBytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC),
  screenshotBytes === null
    ? "file is missing"
    : `${screenshotBytes.length} bytes, and the PNG signature is ${
        screenshotBytes.length ? "wrong" : "absent"
      } — replace the placeholder with a real capture`,
);

// Matched on the path rather than on `![`, so moving the image to a different
// place in the README does not break the check — only removing it does.
const embed = README.match(
  new RegExp(`!\\[([^\\]]*)\\]\\(${SCREENSHOT.replace(/[.]/g, "\\.")}\\)`),
);

check("README.md embeds the screenshot", !!embed, `expected ![alt](${SCREENSHOT})`);

if (embed) {
  const alt = embed[1].replace(/\s+/g, " ").trim();
  check(
    "the screenshot has alt text that describes it",
    alt.length >= 40,
    `alt is ${alt.length} chars: "${alt}" — say what is IN the image, not "screenshot"`,
  );

  // Placement: below the live link, above the first section heading. Asked for
  // explicitly, and it is the one thing about an image that a diff makes hard
  // to see going wrong.
  const liveLink = README.indexOf("**Live:");
  const firstHeading = README.indexOf("\n## ");
  check(
    "the screenshot sits between the live link and the first section",
    liveLink !== -1 &&
      firstHeading !== -1 &&
      embed.index > liveLink &&
      embed.index < firstHeading,
    `live link at ${liveLink}, image at ${embed.index}, first heading at ${firstHeading}`,
  );
}

// ---------------------------------------------------------------------------
// 9. Every path the docs name should exist.
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
