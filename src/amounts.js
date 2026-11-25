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

export function parseQomToAqom(input) {
  const s = String(input).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(t("errAmountFormat"));
  const [w, f = ""] = s.split(".");
  if (f.length > 18) throw new Error(t("errAmountDecimals"));
  const v = BigInt(w) * E18 + BigInt(f.padEnd(18, "0") || "0");
  if (v <= 0n) throw new Error(t("errAmountPositive"));
  return v;
}
