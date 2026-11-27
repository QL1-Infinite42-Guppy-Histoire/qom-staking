// i18n completeness + wording-rule checks (run: node test/i18n-check.mjs).
// - All 20 language tables exist and carry exactly the en key set.
// - Function-valued keys are functions everywhere, strings elsewhere.
// - No table entry is identical to the en string for prose keys where a
//   translation is expected (proper-noun-only values are exempted).
// - No invented APY figure anywhere; no delegation wording in ja/en.
import assert from "node:assert";
import { STRINGS } from "../src/i18n.js";

export const LANGS20 = ["en", "ja", "zh", "ko", "es", "tr", "fa", "id", "vi", "th", "it", "pt", "nl", "pl", "uk", "de", "ru", "ar", "hi", "fr"];

const enKeys = Object.keys(STRINGS.en).sort();
assert.strictEqual(Object.keys(STRINGS).length, 20, "exactly 20 tables");
for (const lang of LANGS20) {
  const table = STRINGS[lang];
  assert.ok(table, `missing table ${lang}`);
  assert.deepStrictEqual(Object.keys(table).sort(), enKeys, `${lang}: key set differs from en`);
  for (const k of enKeys) {
    assert.strictEqual(typeof table[k], typeof STRINGS.en[k], `${lang}.${k}: type differs from en`);
    if (typeof table[k] === "function") {
      const out = table[k]("X", "Y");
      assert.strictEqual(typeof out, "string", `${lang}.${k}: fn must return string`);
      assert.ok(!out.includes("undefined"), `${lang}.${k}: fn output has undefined`);
    }
  }
}

// Prose keys that must not remain English in any non-en table
// (short labels that legitimately coincide are excluded).
const MUST_DIFFER = [
  "errAmountFormat", "errAmountPositive", "gasPriceNote", "noDelegations",
  "partialReadWarn", "cancelUnbondingNote", "undelegateNote", "redelegateNote",
  "loading", "readFailed", "accountNotFound", "unexpectedSignature",
];
for (const lang of LANGS20) {
  if (lang === "en") continue;
  for (const k of MUST_DIFFER) {
    assert.notStrictEqual(STRINGS[lang][k], STRINGS.en[k], `${lang}.${k}: still English`);
  }
}

// Wording rules: no APY figures, no "APY"/"APR" promises anywhere;
// ja must never use 委任 (delegation); en must not say "delegate" to the user.
for (const lang of LANGS20) {
  for (const k of enKeys) {
    const v = STRINGS[lang][k];
    const s = typeof v === "function" ? v("1", "2") : v;
    assert.ok(!/(?<![\p{L}])(APY|APR)(?![\p{L}])/u.test(s), `${lang}.${k}: yield-rate acronym present`);
    assert.ok(!/\d+(\.\d+)?\s?%[^)]{0,40}(yield|reward|return)/i.test(s) || k === "optionCommission", `${lang}.${k}: invented rate figure?`);
  }
}
for (const k of enKeys) {
  const v = STRINGS.ja[k];
  const s = typeof v === "function" ? v("1", "2") : v;
  assert.ok(!s.includes("委任"), `ja.${k}: contains 委任`);
  const e = STRINGS.en[k];
  const es = typeof e === "function" ? e("1", "2") : e;
  assert.ok(!/delegat/i.test(es), `en.${k}: contains delegat*`);
}
console.log(`i18n-check OK: 20 languages × ${enKeys.length} keys`);
