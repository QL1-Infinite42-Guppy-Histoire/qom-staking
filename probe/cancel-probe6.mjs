// Regression probe for the 2026-11-15 cancel-unbonding signature
// failure. Root cause: the node rebuilds the EIP-712 typed data from
// the message's GO STRUCT (cosmos-evm LegacyWrapTxToTypedData), where
// creation_height is an int64 field -> typed "int64". The site's
// buildTypes inferred "string" from the amino JSON value (amino JSON
// carries int64 as a string), so the digest differed and the node
// rejected the signature.
//
// This probe pins the fixed behaviour:
//  1) the site's encoder (buildTypes + typedDataDigest) must type
//     creation_height as "int64";
//  2) its digest must equal the node-side digest, computed with
//     go-ethereum's apitypes from the node's exact inputs (struct-walk
//     types + amino JSON message, creation_height as a string):
//     2d197901dc71131a... MetaMask's eth-sig-util produces the same
//     digest for the fixed typed data (checked 2026-11-15).
//     (ethers' TypedDataEncoder can't be used as the cross-check
//     here: it insists verifyingContract is an address, while this
//     legacy flow types it as string — hence the site's own encoder.)
// The pre-fix digest was 44c62a386c83625a... (string typing).
import { aminoCancelUnbonding, buildTypes, typedDataDigest } from "../src/eip712.js";

const delegator = "qom14qx5z3whmu6d35xgmmeezer7ctfwtxmrnprgfs";
const validator = "qomvaloper14qx5z3whmu6d35xgmmeezer7ctfwtxmr49aej9";
const amino = aminoCancelUnbonding(delegator, validator, "821531357023410886681938601294", "13492374");
const types = buildTypes(amino);
const field = types.MsgValue.find((f) => f.name === "creation_height");
if (field?.type !== "int64") throw new Error("creation_height not typed int64: " + JSON.stringify(types.MsgValue));

const DOMAIN = { name: "Cosmos Web3", version: "1.0.0", chainId: 766, verifyingContract: "cosmos", salt: "0" };
const txData = {
  account_number: "4859", chain_id: "qom_766-1",
  fee: { amount: [{ amount: "7200000000000000000000000", denom: "aqom" }], gas: "400000", feePayer: delegator },
  memo: "", msgs: [amino], sequence: "316",
};

const siteDigest = typedDataDigest(DOMAIN, types, txData);
const NODE_DIGEST = "0x2d197901dc71131a6a28faf5244cffc21b8fb374294b15ff01ed5f1dcd33c154";
const BROKEN_DIGEST = "0x44c62a386c83625af88b592ff7d3c71af584102eeb9445f879c4ce1112a0505f";

console.log("site digest: ", siteDigest);
console.log("node (geth): ", NODE_DIGEST);
if (siteDigest !== NODE_DIGEST) throw new Error("digest mismatch with node");
if (siteDigest === BROKEN_DIGEST) throw new Error("still producing the broken string-typed digest");
console.log("ALL OK — digest matches the node's");
