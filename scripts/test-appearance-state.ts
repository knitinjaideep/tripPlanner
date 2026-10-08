/**
 * The appearance state machine (src/lib/appearance-state.ts) and the background
 * registry, with no browser or database: draft / saved / effective, save and
 * cancel, failed saves, save races, conflicts, remote updates and the registry.
 *
 *   npm run test:appearance
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  appearanceReducer,
  changedFields,
  effectiveOf,
  initialAppearanceState,
  isDirty,
  saveBasis,
  type AppearanceAction,
  type AppearanceState,
} from "../src/lib/appearance-state";
import { BACKGROUND_IDS, BACKGROUND_REGISTRY, IVORY, backgroundFiles, parseBackgroundId } from "../src/lib/backgrounds";
import { defaultAppearance, effectiveAppearance, parseAppearance, type Appearance } from "../src/lib/settings";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}
const run = (s: AppearanceState, ...actions: AppearanceAction[]) => actions.reduce(appearanceReducer, s);
const A: Appearance = { background: "explorers-map", intensity: "subtle", density: "comfortable", mascot: "show" };
const start = () => initialAppearanceState(A, 3, true);

console.log("Registry");
check("eleven stable ids, one entry each, in the documented order", () => {
  assert.deepEqual([...BACKGROUND_IDS], ["plain-ivory", "forest-mist", "coastal-linen", "explorers-map", "botanical-light", "alpine-dawn", "desert-silk", "island-breeze", "meadow-haze", "riverstone", "golden-hour"]);
  for (const id of BACKGROUND_IDS) assert.equal(BACKGROUND_REGISTRY[id].id, id);
});
check("every picture entry has a webp url + thumbnail, a base colour, positions and overlays (subtle washes more than standard)", () => {
  for (const id of BACKGROUND_IDS) {
    const e = BACKGROUND_REGISTRY[id];
    assert.match(e.baseColor, /^#[0-9a-f]{6}$/i);
    assert.ok(e.position.wide && e.position.narrow);
    if (id === "plain-ivory") {
      assert.equal(e.url, null);
      assert.equal(e.thumbUrl, null);
      assert.equal(e.baseColor, IVORY);
      assert.deepEqual(backgroundFiles(id), []);
      continue;
    }
    assert.equal(e.url, `/backgrounds/${id}.webp`);
    assert.equal(e.thumbUrl, `/backgrounds/${id}-thumb.webp`);
    assert.ok(e.overlay.subtle > e.overlay.standard && e.overlay.standard > 0 && e.overlay.subtle < 0.9);
  }
});
check("every registered picture file exists in public/ and really is WebP (RIFF…WEBP), not a renamed image", () => {
  for (const id of BACKGROUND_IDS) {
    for (const file of backgroundFiles(id)) {
      const full = path.join(process.cwd(), "public", "backgrounds", file);
      assert.ok(existsSync(full), `missing ${file}`);
      const head = readFileSync(full).subarray(0, 12);
      assert.equal(head.subarray(0, 4).toString("ascii"), "RIFF", file);
      assert.equal(head.subarray(8, 12).toString("ascii"), "WEBP", file);
    }
  }
});
check("ids parse strictly; the retired underscore spelling still maps; junk does not", () => {
  assert.equal(parseBackgroundId("forest-mist"), "forest-mist");
  assert.equal(parseBackgroundId("forest_mist"), "forest-mist");
  assert.equal(parseBackgroundId("../../etc/passwd"), null);
  assert.equal(parseBackgroundId(7), null);
  assert.equal(parseAppearance({ background: "retired-theme" }, [...BACKGROUND_IDS]).background, "explorers-map");
});
check("an unavailable picture paints Plain Ivory without rewriting the stored choice", () => {
  const saved = { ...A, background: "golden-hour" as const };
  assert.equal(effectiveAppearance(saved, ["plain-ivory"]).background, "plain-ivory");
  assert.equal(saved.background, "golden-hour");
  assert.equal(defaultAppearance(["plain-ivory"]).background, "plain-ivory");
});

console.log("Selection, effective appearance");
check("selecting updates the draft only; effective = draft; saved is untouched", () => {
  const s = run(start(), { type: "edit", patch: { background: "forest-mist" } });
  assert.equal(s.saved.background, "explorers-map");
  assert.equal(effectiveOf(s).background, "forest-mist");
  assert.ok(isDirty(s));
});
check("changing back to the saved values clears the unsaved state", () => {
  const s = run(start(), { type: "edit", patch: { density: "compact" } }, { type: "edit", patch: { density: "comfortable" } });
  assert.equal(s.draft, null);
  assert.ok(!isDirty(s));
});
check("restore defaults changes the draft only (needs Save), and clears it if it equals saved", () => {
  const saved = { ...A, background: "riverstone" as const };
  const s = run(initialAppearanceState(saved, 1, true), { type: "replace", next: defaultAppearance([...BACKGROUND_IDS]) });
  assert.ok(isDirty(s));
  assert.equal(s.saved.background, "riverstone");
  assert.equal(run(start(), { type: "replace", next: defaultAppearance([...BACKGROUND_IDS]) }).draft, null);
});

console.log("Save / Cancel");
check("cancel clears the draft and restores saved (no save involved)", () => {
  const s = run(start(), { type: "edit", patch: { background: "island-breeze" } }, { type: "cancel" });
  assert.equal(s.draft, null);
  assert.equal(effectiveOf(s).background, "explorers-map");
  assert.equal(s.phase, "idle");
});
check("a save sends only changed fields, on the saved version", () => {
  const s = run(start(), { type: "edit", patch: { background: "forest-mist" } });
  const b = saveBasis(s);
  assert.deepEqual(b.patch, { background: "forest-mist" });
  assert.equal(b.version, 3);
  assert.deepEqual(changedFields(A, { ...A, mascot: "hide", density: "compact" }), { density: "compact", mascot: "hide" });
});
check("success: saved becomes the server's value, draft clears, version advances, “Saved” shows only now", () => {
  let s = run(start(), { type: "edit", patch: { background: "forest-mist" } }, { type: "save-start" });
  assert.equal(s.phase, "saving");
  assert.notEqual(s.message, "Appearance saved.");
  s = run(s, { type: "save-ok", appearance: { ...A, background: "forest-mist" }, version: 4 });
  assert.equal(s.phase, "saved");
  assert.equal(s.saved.background, "forest-mist");
  assert.equal(s.version, 4);
  assert.equal(s.draft, null);
  assert.equal(effectiveOf(s).background, "forest-mist", "visually stable");
});
check("failed save keeps the draft and says why; Cancel and retry both remain possible", () => {
  const s = run(start(), { type: "edit", patch: { background: "forest-mist" } }, { type: "save-start" }, { type: "save-failed", message: "No connection." });
  assert.equal(s.phase, "error");
  assert.equal(s.draft?.background, "forest-mist");
  assert.equal(s.saved.background, "explorers-map");
  const retry = run(s, { type: "save-start" });
  assert.equal(retry.phase, "saving");
  assert.equal(run(s, { type: "cancel" }).draft, null);
});
check("editing and cancelling are refused while a save is pending (no lost newer choice)", () => {
  const saving = run(start(), { type: "edit", patch: { background: "forest-mist" } }, { type: "save-start" });
  assert.equal(run(saving, { type: "edit", patch: { background: "riverstone" } }), saving);
  assert.equal(run(saving, { type: "cancel" }), saving);
  assert.equal(run(saving, { type: "save-start" }), saving, "no double submit");
});
check("a newer draft is never discarded by an older save completing", () => {
  const saving = run(start(), { type: "edit", patch: { background: "forest-mist" } }, { type: "save-start" });
  // Forced race: a different draft exists when the result lands.
  const raced: AppearanceState = { ...saving, draft: { ...A, background: "riverstone" } };
  const done = run(raced, { type: "save-ok", appearance: { ...A, background: "forest-mist" }, version: 4 });
  assert.equal(done.draft?.background, "riverstone");
  assert.equal(done.saved.background, "forest-mist");
});

console.log("Other devices");
check("a remote update with no draft refreshes saved; an older one is ignored", () => {
  const newer = { ...A, background: "golden-hour" as const };
  assert.equal(run(start(), { type: "remote", appearance: newer, version: 5 }).saved.background, "golden-hour");
  assert.equal(run(start(), { type: "remote", appearance: newer, version: 3 }).saved.background, "explorers-map");
});
check("a remote update never replaces an active draft; it is parked for review", () => {
  const s = run(start(), { type: "edit", patch: { background: "forest-mist" } }, { type: "remote", appearance: { ...A, background: "golden-hour" }, version: 5 });
  assert.equal(effectiveOf(s).background, "forest-mist");
  assert.equal(s.saved.background, "explorers-map");
  assert.equal(s.remote?.appearance.background, "golden-hour");
});
check("a stale save (conflict) keeps the draft, parks the other device's choice, and Save-anyway rebases onto its version", () => {
  let s = run(start(), { type: "edit", patch: { background: "forest-mist" } }, { type: "save-start" }, { type: "save-conflict", appearance: { ...A, background: "golden-hour", density: "compact" }, version: 6, message: "changed elsewhere" });
  assert.equal(s.phase, "conflict");
  assert.equal(s.draft?.background, "forest-mist");
  assert.equal(s.remote?.version, 6);
  const basis = saveBasis(s);
  assert.equal(basis.version, 6);
  assert.deepEqual(basis.patch, { background: "forest-mist", density: "comfortable" }, "relative to the other device's values");
  s = run(s, { type: "save-start" });
  assert.equal(s.phase, "saving");
  assert.equal(s.version, 6);
});
check("“use theirs” (cancel with a parked remote) adopts the other device's appearance", () => {
  const s = run(start(), { type: "edit", patch: { background: "forest-mist" } }, { type: "remote", appearance: { ...A, background: "golden-hour" }, version: 5 }, { type: "cancel" });
  assert.equal(s.saved.background, "golden-hour");
  assert.equal(s.version, 5);
  assert.equal(s.draft, null);
});
check("if the other device saved exactly the preview, the conflict resolves itself", () => {
  const mine = { ...A, background: "forest-mist" as const };
  const s = run(start(), { type: "edit", patch: { background: "forest-mist" } }, { type: "save-start" }, { type: "save-conflict", appearance: mine, version: 4, message: "x" });
  assert.equal(s.draft, null);
  assert.equal(s.phase, "saved");
});

console.log(`\n${passed} checks passed.`);
