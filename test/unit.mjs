// Unit tests: amount conversions, validator pagination merge,
// fetchMyState response mappers, cancel-unbonding creation height.
import assert from "node:assert";
import { E18, fmtQom, fmtDecQom, fmtQomInt, fmtDecQomInt, fmtQomPersonal, fmtDecQomPersonal, fmtQomCompact, decToAqom, parseQomToAqom } from "../src/amounts.js";
import {
  BOND_STATUS_NAME, normalizeValidatorStatus, mergeValidatorPages,
  buildRewardByValidator, mapDelegationResponses, mapUnbondingResponses,
  timestampToIso, msgDelegate, msgUndelegate, msgCancelUnbonding,
} from "../src/cosmos.js";

// ---- amounts ---------------------------------------------------------------
assert.strictEqual(fmtQom("0"), "0");
assert.strictEqual(fmtQom("1500000000000000000"), "1.5");
assert.strictEqual(fmtQom("401139878041663617428"), "401.1398");
assert.strictEqual(fmtQom("10868000000000000000000"), "10,868");
assert.strictEqual(fmtQom("-1500000000000000000"), "-1.5");
assert.strictEqual(fmtQom(undefined), "0");
// Dec strings are (aqom value x 10^18): 1.5 QOM of rewards is 1.5e36 raw.
assert.strictEqual(decToAqom("1500000000000000000000000000000000000"), 15n * E18 / 10n);
assert.strictEqual(decToAqom(""), 0n);
assert.strictEqual(decToAqom(undefined), 0n);
assert.strictEqual(fmtDecQom("1500000000000000000000000000000000000"), "1.5");
assert.strictEqual(fmtDecQom(""), "0");
// Integer-only display variants: fraction truncated (floored), never rounded.
const trillionAqom = (1000048951521n * E18 + 52n * E18 / 100n).toString(); // 1,000,048,951,521.52 QOM
assert.strictEqual(fmtQomInt(trillionAqom), "1,000,048,951,521");
assert.strictEqual(fmtQomInt("1999999999999999999"), "1"); // 1.999… -> 1, not 2
assert.strictEqual(fmtQomInt("999999999999999999"), "0"); // 0.999… -> 0
assert.strictEqual(fmtQomInt("-1500000000000000000"), "-1");
assert.strictEqual(fmtDecQomInt("1500000000000000000000000000000000000"), "1");
assert.strictEqual(fmtDecQomInt(""), "0");
// Personal display (2026-11-26): up to 3 decimals, trailing zeros trimmed,
// truncated never rounded; sub-0.001 positives stay visible.
assert.strictEqual(fmtQomPersonal("0"), "0");
assert.strictEqual(fmtQomPersonal((42n * E18 / 1000n).toString()), "0.042");
assert.strictEqual(fmtQomPersonal((15n * E18 / 10n).toString()), "1.5");
assert.strictEqual(fmtQomPersonal((123456n * E18 / 10000n).toString()), "12.345"); // 12.3456 -> truncated
assert.strictEqual(fmtQomPersonal((4n * E18 / 10000n).toString()), "0.0004"); // not crushed to "0"
assert.strictEqual(fmtDecQomPersonal("1500000000000000000000000000000000000"), "1.5");
assert.strictEqual(fmtDecQomPersonal(""), "0");
// Compact validator totals (2026-11-26): >= 3 significant digits, truncated.
const q = (n) => (n * E18).toString();
assert.strictEqual(fmtQomCompact(q(1360000000000n), "ja"), "1.36兆");
assert.strictEqual(fmtQomCompact(q(1360000000000n), "en"), "1.36T");
assert.strictEqual(fmtQomCompact(q(961448951521n), "ja"), "9,614億");
assert.strictEqual(fmtQomCompact(q(105000000n), "ja"), "1.05億"); // was "1億"
assert.strictEqual(fmtQomCompact(q(10850n), "ja"), "1.08万");
assert.strictEqual(fmtQomCompact(q(10850n), "en"), "10.8K");
assert.strictEqual(fmtQomCompact(q(999n), "ja"), "999");
assert.strictEqual(fmtQomCompact("0", "ja"), "0");
assert.strictEqual(parseQomToAqom("1.5"), 15n * E18 / 10n);
assert.strictEqual(parseQomToAqom("18"), 18n * E18);
assert.throws(() => parseQomToAqom("abc"));
assert.throws(() => parseQomToAqom("0"));
assert.throws(() => parseQomToAqom("1.1234567890123456789")); // > 18 decimals
console.log("amounts: OK");

// ---- validator pagination merge ---------------------------------------------
const v = (addr, status) => ({ operatorAddress: addr, status });
const merged = mergeValidatorPages([
  [v("valA", 3), v("valB", 3)],
  [v("valC", 3)],                    // second page of the same status
  [v("valB", 2), v("valD", 1)],      // valB again (status changed mid-fetch)
  [v("valE", "BOND_STATUS_UNBONDED")],
]);
assert.deepStrictEqual(merged.map((x) => x.operatorAddress),
  ["valA", "valB", "valC", "valD", "valE"], "order + dedup");
assert.strictEqual(merged[1].status, "BOND_STATUS_BONDED", "first occurrence wins");
assert.strictEqual(merged[3].status, "BOND_STATUS_UNBONDED", "numeric status normalized");
assert.strictEqual(merged[4].status, "BOND_STATUS_UNBONDED", "string status untouched");
assert.strictEqual(normalizeValidatorStatus(v("valX", 99)).status, "BOND_STATUS_UNSPECIFIED");
assert.strictEqual(normalizeValidatorStatus(v("valY", 0)).status, BOND_STATUS_NAME[0]);
assert.deepStrictEqual(mergeValidatorPages([]), []);
assert.deepStrictEqual(mergeValidatorPages([[], undefined]), []);
console.log("mergeValidatorPages: OK");

// ---- fetchMyState mappers -----------------------------------------------------
const rewardMap = buildRewardByValidator([
  { validatorAddress: "valA", reward: [{ denom: "aqom", amount: "500" }, { denom: "other", amount: "9" }] },
  { validatorAddress: "valB", reward: [{ denom: "other", amount: "9" }] },
]);
assert.strictEqual(rewardMap.get("valA"), "500", "aqom denom picked");
assert.strictEqual(rewardMap.get("valB"), "0", "no aqom coin -> 0");
assert.strictEqual(buildRewardByValidator(undefined).size, 0);

const dels = mapDelegationResponses([
  { delegation: { validatorAddress: "valA", shares: "1.5" }, balance: { amount: "123", denom: "aqom" } },
  { delegation: { validatorAddress: "valB", shares: "2.5" }, balance: undefined },
], rewardMap);
assert.deepStrictEqual(dels, [
  { validatorAddress: "valA", shares: "1.5", balanceAqom: "123", rewardAqom: "500" },
  { validatorAddress: "valB", shares: "2.5", balanceAqom: "0", rewardAqom: "0" },
]);
assert.deepStrictEqual(mapDelegationResponses(undefined, rewardMap), []);
console.log("delegation mappers: OK");

// ---- unbonding mapper: completion time + creation height ----------------------
assert.strictEqual(timestampToIso(null), null);
assert.strictEqual(timestampToIso("2026-01-01T00:00:00.000Z"), "2026-01-01T00:00:00.000Z");
assert.strictEqual(
  timestampToIso({ seconds: 1700000000n, nanos: 500000000 }),
  "2023-11-14T22:13:20.500Z");
const ub = mapUnbondingResponses([
  {
    validatorAddress: "valA",
    entries: [
      { balance: "777", completionTime: { seconds: 1700000000n, nanos: 0 }, creationHeight: 8297275n },
      { balance: "1", completionTime: null, creationHeight: undefined },
    ],
  },
]);
assert.strictEqual(ub.length, 2);
assert.strictEqual(ub[0].creationHeight, "8297275", "creation height -> string");
assert.strictEqual(ub[0].completionTime, "2023-11-14T22:13:20.000Z");
assert.strictEqual(ub[1].creationHeight, "0", "missing creation height -> 0");
assert.strictEqual(ub[1].completionTime, null);
assert.deepStrictEqual(mapUnbondingResponses(undefined), []);
console.log("unbonding mapper: OK");

// ---- message builders (proto shapes stay stable) ------------------------------
const del = msgDelegate("qom1delegator", "qomvaloper1val", "1000");
assert.strictEqual(del.typeUrl, "/cosmos.staking.v1beta1.MsgDelegate");
assert.strictEqual(del.value.amount.amount, "1000");
assert.strictEqual(del.value.amount.denom, "aqom");
const undel = msgUndelegate("qom1delegator", "qomvaloper1val", "5");
assert.strictEqual(undel.typeUrl, "/cosmos.staking.v1beta1.MsgUndelegate");
// Cancel identifies the entry by creation height, carried as a Long.
const cancel = msgCancelUnbonding("qom1delegator", "qomvaloper1val", "777", "8297275");
assert.strictEqual(cancel.typeUrl, "/cosmos.staking.v1beta1.MsgCancelUnbondingDelegation");
assert.strictEqual(cancel.value.creationHeight.toString(), "8297275");
const cancelNum = msgCancelUnbonding("qom1delegator", "qomvaloper1val", "777", 8297275);
assert.strictEqual(cancelNum.value.creationHeight.toString(), "8297275");
console.log("msg builders: OK");

console.log("ALL UNIT TESTS PASSED");
