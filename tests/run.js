/**
 * Test runner.
 *
 * Starts one server on port 3100 against data/test.db, runs every suite in
 * tests/, prints a summary, and exits 1 if anything failed — so CI, or a
 * pre-push hook, can use it.
 *
 *   npm test              # everything
 *   npm test -- edit      # only suites whose filename matches "edit"
 *
 * The rules for what goes in here are in CLAUDE.md §10: assertions must be
 * strict enough to fail, and you prove one bites by breaking the code and
 * watching the suite go red before you trust a green run.
 */

import { PORT, TEST_DB, Suite, startServer, stopServer } from "./helpers.js";

const SUITES = ["./edit-messages.test.js", "./custom-eras.test.js"];

const filters = process.argv.slice(2);
const selected = filters.length
  ? SUITES.filter((path) => filters.some((f) => path.includes(f)))
  : SUITES;

if (selected.length === 0) {
  console.error(`No suite matches ${filters.join(", ")}. Available:\n  ${SUITES.join("\n  ")}`);
  process.exit(1);
}

console.log(`Vestige tests — port ${PORT}, database ${TEST_DB}\n`);

let failures = 0;
let passed = 0;
let skipped = 0;
const red = [];

try {
  await startServer();

  for (const path of selected) {
    const suite = await import(path);
    const t = new Suite(suite.name ?? path);

    try {
      await suite.run(t);
    } catch (error) {
      // A suite that throws is a failure, not a crash that hides the others.
      t.ok(`suite ran to completion`, false, `${error?.stack ?? error}`);
    }

    passed += t.passed;
    failures += t.failures.length;
    skipped += t.skipped.length;
    if (t.failures.length) red.push([t.name, t.failures]);
  }
} finally {
  await stopServer();
}

console.log("\n" + "-".repeat(70));

if (red.length) {
  console.log("\nFailed checks:");
  for (const [name, labels] of red) {
    console.log(`\n  ${name}`);
    for (const label of labels) console.log(`    - ${label}`);
  }
}

console.log(
  `\n${failures ? "FAILED" : "PASSED"} — ${passed}/${passed + failures} checks` +
    (skipped ? `, ${skipped} skipped` : "") +
    "\n",
);

process.exit(failures ? 1 : 0);
