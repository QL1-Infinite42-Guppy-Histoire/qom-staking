// Pure amount helpers for the QOM staking site (all amounts are aqom
// integer strings; 1 QOM = 10^18 aqom). Kept in their own module — with
// no DOM access — so they can be unit-tested (test/unit.mjs).
import { t } from "./i18n.js";

export const E18 = 10n ** 18n;

export function fmtQom(aqom, maxDp = 4) {
  let v = BigInt(aqom || "0");
  const neg = v < 0n; if (neg) v = -v;
  const whole = v / E18;
  const frac = (v % E18).toString().padStart(18, "0").slice(0, maxDp).replace(/0+$/, "");
  return (neg ? "-" : "") + whole.toLocaleString("en-US") + (frac ? "." + frac : "");
}

// Distribution rewards come back as cosmos Dec strings (value x 10^18, in aqom).
export function fmtDecQom(rawDec, maxDp = 4) {
  if (!rawDec) return "0";
  return fmtQom((BigInt(rawDec) / E18).toString(), maxDp);
}
export function decToAqom(rawDec) { return rawDec ? BigInt(rawDec) / E18 : 0n; }

// Display-only integer variants (2026-11-25): the status card and the
// per-validator rows show whole QOM only — the fractional part is
// truncated (BigInt division in fmtQom already floors toward zero),
// never rounded. Internal values and amounts actually sent keep full
// precision; only these rendered strings drop the decimals.
export function fmtQomInt(aqom) { return fmtQom(aqom, 0); }
export function fmtDecQomInt(rawDec) { return fmtDecQom(rawDec, 0); }

// Personal-amount display (2026-11-26): the status card and the user's own
// per-validator rows show up to 3 decimal places, trailing zeros trimmed —
// the integer-only rendering crushed sub-1 rewards to "0", hiding whether
// anything was accumulating. Truncation, never rounding up (same rule as
// fmtQom): 12.3456 -> "12.345". Exception: a positive amount below 0.001
// would still render as "0", so its precision is extended until the first
// significant digit (plus up to 2 more) is visible: 0.0004 -> "0.0004".
// Display only — amounts actually sent keep full precision.
export function fmtQomPersonal(aqom) {
  let v = BigInt(aqom || "0");
  const neg = v < 0n; if (neg) v = -v;
  const whole = v / E18;
  const frac18 = (v % E18).toString().padStart(18, "0");
  let frac;
  if (whole > 0n || frac18.slice(0, 3) !== "000") {
    frac = frac18.slice(0, 3).replace(/0+$/, "");
  } else if (v > 0n) {
    const first = frac18.search(/[1-9]/);
    frac = frac18.slice(0, first + 3).replace(/0+$/, "");
  } else {
    frac = "";
  }
  return (neg ? "-" : "") + whole.toLocaleString("en-US") + (frac ? "." + frac : "");
}
export function fmtDecQomPersonal(rawDec) {
  if (!rawDec) return "0";
  return fmtQomPersonal((BigInt(rawDec) / E18).toString());
}

// Compact total for validator rows (2026-11-26): abbreviated, but always
// with at least 3 significant digits so rows stay distinguishable — the
// previous version floored to the unit (10,850 -> "1万", 1.05億 -> "1億"),
// making different validators look identical. Truncated, never rounded up.
// Below the smallest unit the exact integer is shown.
const COMPACT_UNITS = {
  ja: [[12, "兆"], [8, "億"], [4, "万"]],
  en: [[12, "T"], [9, "B"], [6, "M"], [3, "K"]],
};
export function fmtQomCompact(aqom, lang) {
  let v = BigInt(aqom || "0");
  const neg = v < 0n; if (neg) v = -v;
  const whole = v / E18;
  const digits = whole.toString().length;
  const unit = (COMPACT_UNITS[lang] || COMPACT_UNITS.en).find(([e]) => digits - e >= 1);
  if (!unit) return (neg ? "-" : "") + whole.toLocaleString("en-US");
  const [exp, label] = unit;
  const intLen = digits - exp;
  const fracDigits = Math.max(0, 3 - intLen); // total significant digits >= 3
  const scaled = (whole * 10n ** BigInt(fracDigits)) / 10n ** BigInt(exp);
  const intPart = scaled / 10n ** BigInt(fracDigits);
  const fracPart = (scaled % 10n ** BigInt(fracDigits)).toString().padStart(fracDigits, "0").replace(/0+$/, "");
  return (neg ? "-" : "") + intPart.toLocaleString("en-US") + (fracPart ? "." + fracPart : "") + label;
}

export function parseQomToAqom(input) {
  const s = String(input).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(t("errAmountFormat"));
  const [w, f = ""] = s.split(".");
  if (f.length > 18) throw new Error(t("errAmountDecimals"));
  const v = BigInt(w) * E18 + BigInt(f.padEnd(18, "0") || "0");
  if (v <= 0n) throw new Error(t("errAmountPositive"));
  return v;
}
