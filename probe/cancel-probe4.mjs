// Unit check of the new cancel-unbonding code paths (no chain writes):
// 1) cosmos.js builder -> proto encode -> decode round-trip keeps
//    creationHeight / amount / addresses intact.
// 2) eip712.js amino builder + buildTypes + typedDataDigest run and
//    produce the expected MsgValue shape (creation_height as string).
import { MsgCancelUnbondingDelegation } from "cosmjs-types/cosmos/staking/v1beta1/tx.js";
import { msgCancelUnbonding } from "../src/cosmos.js";
import { aminoCancelUnbonding, buildTypes, typedDataDigest } from "../src/eip712.js";

const delegator = "qom14qx5z3whmu6d35xgmmeezer7ctfwtxmrnprgfs";
const validator = "qomvaloper14qx5z3whmu6d35xgmmeezer7ctfwtxmr49aej9";
const amount = "821531357023410886681938601294";
const height = "13492374";

const m = msgCancelUnbonding(delegator, validator, amount, height);
const bytes = MsgCancelUnbondingDelegation.encode(MsgCancelUnbondingDelegation.fromPartial(m.value)).finish();
const back = MsgCancelUnbondingDelegation.decode(bytes);
console.log("proto round-trip:", JSON.stringify({
  delegatorAddress: back.delegatorAddress,
  validatorAddress: back.validatorAddress,
  amount: back.amount,
  creationHeight: back.creationHeight?.toString(),
}, null, 1));
if (back.creationHeight?.toString() !== height) throw new Error("creationHeight mismatch");
if (back.amount?.amount !== amount) throw new Error("amount mismatch");

const amino = aminoCancelUnbonding(delegator, validator, amount, height);
console.log("amino:", JSON.stringify(amino));
const types = buildTypes(amino);
console.log("MsgValue typedef:", JSON.stringify(types.MsgValue));
const digest = typedDataDigest(
  { name: "Cosmos Web3", version: "1.0.0", chainId: 766, verifyingContract: "cosmos", salt: "0" },
  types,
  {
    account_number: "4859", chain_id: "qom_766-1",
    fee: { amount: [{ amount: "7200000000000000000000000", denom: "aqom" }], gas: "400000", feePayer: delegator },
    memo: "", msgs: [amino], sequence: "316",
  },
);
console.log("typedDataDigest:", digest);
console.log("ALL OK");
