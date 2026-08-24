// ===========================================================================
// TEST HARNESS
//
// There is no test framework here on purpose (CLAUDE.md §10). Tests are plain
// Node scripts run against a SECOND server instance, on port 3100 with
// DB_PATH=data/test.db, so a run can never touch the real conversations in
// data/history.db.
//
// Two processes share that database file: this one seeds and inspects rows
// directly, the server under test reads and writes them over HTTP. SQLite is
// in WAL mode, so that is fine — but keep the writes on either side short and
// sequential rather than interleaved.
// ===========================================================================

import "dotenv/config";
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PORT = Number(process.env.TEST_PORT || 3100);
export const BASE = `http://127.0.0.1:${PORT}`;
export const TEST_DB = resolve(ROOT, "data/test.db");

/** Stands in for a real key so the validation-only checks can still import. */
const PLACEHOLDER_KEY = "test-key-no-model-calls";

// Start from an empty database every run, so a test can never pass because of
// a row an earlier run left behind. The -wal and -shm siblings are part of the
// database, not scratch files: deleting the .db alone leaves the tail of the
// last run's writes sitting in the WAL, waiting to be replayed.
for (const suffix of ["", "-wal", "-shm"]) {
  rmSync(TEST_DB + suffix, { force: true });
}

// lib/db.js resolves DB_PATH at import time, so this has to be set before the
// import below — which is why that import is dynamic and this file has a
// top-level await. Everything importing these helpers gets the test database.
process.env.DB_PATH = TEST_DB;

// lib/chat.js constructs the Groq client at import time and throws without a
// key, and lib/customEras.js imports it. The validation checks need neither a
// key nor a network, so a placeholder keeps them runnable; the checks that
// genuinely call the model detect the placeholder and skip.
export const HAS_MODEL_KEY =
  !!process.env.GROQ_API_KEY &&
  process.env.GROQ_API_KEY !== PLACEHOLDER_KEY &&
  process.env.GROQ_API_KEY !== "your_groq_key_here";

process.env.GROQ_API_KEY ||= PLACEHOLDER_KEY;

/** Direct database access, on data/test.db. */
export const store = await import("../lib/db.js");

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

/**
 * True only when `list` has entries AND every one satisfies `predicate`.
 *
 * `[].every(fn)` is `true`, so a bare `.every()` reports success when the
 * thing being checked never arrived at all. That vacuous pass once hid a
 * completely broken pipeline behind a green run (CLAUDE.md §10). Never call
 * `.every()` on an array that might be empty — call this instead.
 */
export function allOf(list, predicate) {
  const items = Array.isArray(list) ? list : [];
  if (items.length === 0) return false;

  for (let i = 0; i < items.length; i++) {
    if (!predicate(items[i], i)) return false;
  }
  return true;
}

/** Collects the results of one suite and prints them as it goes. */
export class Suite {
  constructor(name) {
    this.name = name;
    this.passed = 0;
    this.failures = [];
    this.skipped = [];
    console.log(`\n${name}`);
  }

  group(label) {
    console.log(`\n  ${label}`);
  }

  ok(label, condition, detail = "") {
    if (condition) {
      this.passed++;
      console.log(`    ok    ${label}`);
    } else {
      this.failures.push(label);
      console.log(`    FAIL  ${label}${detail ? `\n            ${detail}` : ""}`);
    }
    return !!condition;
  }

  equal(label, actual, expected) {
    return this.ok(
      label,
      Object.is(actual, expected),
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }

  skip(label, reason) {
    this.skipped.push(label);
    console.log(`    skip  ${label} — ${reason}`);
  }
}

// ---------------------------------------------------------------------------
// The server under test
// ---------------------------------------------------------------------------

let child = null;

export async function startServer() {
  child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    // dotenv does not overwrite variables that are already set, so the
    // server's own `import "dotenv/config"` cannot pull this back to :3000 and
    // the real database.
    env: { ...process.env, PORT: String(PORT), DB_PATH: TEST_DB },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const log = [];
  child.stdout.on("data", (d) => log.push(String(d)));
  child.stderr.on("data", (d) => log.push(String(d)));

  let exited = null;
  child.on("exit", (code) => {
    exited = code;
  });

  for (let attempt = 0; attempt < 120; attempt++) {
    if (exited !== null) {
      throw new Error(
        `server exited with code ${exited} before it was ready:\n${log.join("")}`,
      );
    }
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) {
        // The startup line prints a route count and the database path. Both
        // are worth seeing in the test output: a stale process or a run
        // pointed at data/history.db is obvious here and nowhere else.
        console.log(log.join("").trim());
        return;
      }
    } catch {
      // not listening yet
    }
    await sleep(150);
  }

  throw new Error(`server did not answer /healthz on ${PORT}:\n${log.join("")}`);
}

export async function stopServer() {
  if (!child) return;
  const ended = new Promise((r) => child.once("exit", r));
  child.kill();
  child = null;
  await Promise.race([ended, sleep(3000)]);
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/**
 * A visitor. The server accepts any cookie value matching /^[\w-]{10,64}$/ and
 * mints one otherwise, so a test can name its own sessions instead of having
 * to read Set-Cookie back out.
 */
export function newSession() {
  return crypto.randomUUID();
}

export async function api(path, { method = "GET", body, session } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(session ? { cookie: `hb_session=${session}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // an SSE body or a static file — the caller checks `status` instead
  }
  return { status: res.status, json, text };
}

/**
 * POST to one of the streaming endpoints and collect the SSE events.
 *
 * Stops reading at `done` (or `error`) rather than at end of body: artifacts
 * are deliberately delivered in a later event, so the stream outlives the
 * reply by up to the museum lookup's timeout and nothing here should wait for
 * it.
 */
export async function stream(path, { session, body, timeoutMs = 60_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(BASE + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(session ? { cookie: `hb_session=${session}` } : {}),
      },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });

    const events = [];
    let text = "";

    const isStream = String(res.headers.get("content-type")).includes("event-stream");
    if (!res.body || !isStream) {
      const raw = await res.text();
      let json = null;
      try {
        json = JSON.parse(raw);
      } catch {
        // non-JSON error body
      }
      return { status: res.status, events, text, json };
    }

    const decoder = new TextDecoder();
    let buffer = "";

    reading: for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });

      let split;
      while ((split = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);

        const line = frame.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;

        let event;
        try {
          event = JSON.parse(line.slice(6));
        } catch {
          continue;
        }

        events.push(event);
        if (event.type === "delta") text += event.text;
        if (event.type === "done" || event.type === "error") break reading;
      }
    }

    controller.abort(); // release the connection; the server finishes on its own
    return { status: res.status, events, text, json: null };
  } finally {
    clearTimeout(timer);
  }
}

/** The last event of a stream, which is what says how the turn ended. */
export function finalEvent(result) {
  return result.events.at(-1)?.type ?? "none";
}
