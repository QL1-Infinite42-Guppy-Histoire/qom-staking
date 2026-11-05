import { Registry, decodeTxRaw } from "@cosmjs/proto-signing";
import { fromBase64, toHex, fromBech32 } from "@cosmjs/encoding";
import { Tendermint34Client } from "@cosmjs/tendermint-rpc";
import { QueryClient } from "@cosmjs/stargate";
import { MsgDelegate } from "cosmjs-types/cosmos/staking/v1beta1/tx.js";
import { keccak256, toUtf8Bytes, recoverAddress, getAddress, AbiCoder } from "ethers";

// Minimal EIP-712 encoder (geth apitypes semantics)
const coder = AbiCoder.defaultAbiCoder();
function collectDeps(types, primary, found = new Set()) {
  if (found.has(primary) || !types[primary]) return found;
  found.add(primary);
  for (const f of types[primary]) {
    const base = f.type.replace(/\[\]$/, "");
    if (types[base]) collectDeps(types, base, found);
  }
  return found;
}
function encodeType(types, primary) {
  const deps = [...collectDeps(types, primary)].filter((t) => t !== primary).sort();
  const all = [primary, ...deps];
  return all.map((t) => `${t}(${types[t].map((f) => `${f.type} ${f.name}`).join(",")})`).join("");
}
function encodeValue(types, type, value) {
  if (types[type]) return hashStruct(types, type, value);
  if (type.endsWith("[]")) {
    const base = type.slice(0, -2);
    const parts = value.map((v) => types[base] || base === "string" || base === "bytes"
      ? (types[base] ? hashStruct(types, base, v) : keccak256(toUtf8Bytes(v)))
      : encodeValue(types, base, v));
    return keccak256("0x" + parts.map((p) => p.slice(2)).join(""));
  }
  if (type === "string") return keccak256(toUtf8Bytes(value));
  if (type === "bytes") return keccak256(value);
  if (type === "address") return coder.encode(["address"], [value]);
  if (type.startsWith("uint") || type.startsWith("int")) return coder.encode([type], [BigInt(value)]);
  if (type === "bool") return coder.encode(["bool"], [value]);
  throw new Error("unsupported type " + type);
}
function hashStruct(types, primary, value) {
  const typeHash = keccak256(toUtf8Bytes(encodeType(types, primary)));
  const fields = types[primary].map((f) => encodeValue(types, f.type, value[f.name]));
  return keccak256("0x" + typeHash.slice(2) + fields.map((p) => p.slice(2)).join(""));
}
function typedDataHash(domain, types, value) {
  const ds = hashStruct(types, "EIP712Domain", domain);
  const ms = hashStruct(types, "Tx", value);
  return keccak256("0x1901" + ds.slice(2) + ms.slice(2));
}
import { readFileSync } from "node:fs";

const RPC = "https://rpc.foxxone.one";
const b64 = readFileSync("probe/real-web3-tx.b64", "utf8").trim();
const d = decodeTxRaw(fromBase64(b64));
const msgAny = d.body.messages[0];
const msg = MsgDelegate.decode(msgAny.value);
console.log("msg:", JSON.stringify(msg));
const delegator = msg.delegatorAddress;
const si = d.authInfo.signerInfos[0];

// account number of the delegator
const tm = await Tendermint34Client.connect(RPC);
const qc = new QueryClient(tm);
function fields(buf) { const out = []; let i = 0;
  const rd = () => { let v = 0n, s = 0n; while (true) { const b = buf[i++]; v |= BigInt(b & 0x7f) << s; if (!(b & 0x80)) break; s += 7n; } return v; };
  while (i < buf.length) { const tag = Number(rd()); const fn = tag >> 3, wt = tag & 7;
    if (wt === 0) out.push([fn, rd()]); else if (wt === 2) { const len = Number(rd()); out.push([fn, buf.slice(i, i + len)]); i += len; } else break; }
  return out; }
const addrBytes = new TextEncoder().encode(delegator);
const res2 = await qc.queryAbci("/cosmos.auth.v1beta1.Query/Account", new Uint8Array([0x0a, addrBytes.length, ...addrBytes]));
const anyMsg = fields(fields(res2.value).find(([f]) => f === 1)[1]);
const ethAcct = fields(anyMsg.find(([f]) => f === 2)[1]);
const baseF = fields(ethAcct.find(([f]) => f === 1)[1]);
const accNum = String(baseF.find(([f]) => f === 3)[1]);
console.log("delegator account number:", accNum, "| tx sequence:", si.sequence.toString());

// amino sign doc (what legacytx.StdSignBytes produces, parsed back to JSON)
const fee = d.authInfo.fee;
const txData = {
  account_number: accNum,
  chain_id: "qom_766-1",
  fee: {
    amount: fee.amount.map((c) => ({ amount: c.amount, denom: c.denom })),
    gas: fee.gasLimit.toString(),
    feePayer: delegator,
  },
  memo: d.body.memo || "",
  msgs: [{
    type: "cosmos-sdk/MsgDelegate",
    value: {
      amount: { amount: msg.amount.amount, denom: msg.amount.denom },
      delegator_address: msg.delegatorAddress,
      validator_address: msg.validatorAddress,
    },
  }],
  sequence: si.sequence.toString(),
};
const types = {
  EIP712Domain: [
    { name: "name", type: "string" }, { name: "version", type: "string" },
    { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "string" },
    { name: "salt", type: "string" },
  ],
  Tx: [
    { name: "account_number", type: "string" }, { name: "chain_id", type: "string" },
    { name: "fee", type: "Fee" }, { name: "memo", type: "string" },
    { name: "msgs", type: "Msg[]" }, { name: "sequence", type: "string" },
  ],
  Fee: [
    { name: "feePayer", type: "string" }, { name: "amount", type: "Coin[]" }, { name: "gas", type: "string" },
  ],
  Coin: [ { name: "denom", type: "string" }, { name: "amount", type: "string" } ],
  Msg: [ { name: "type", type: "string" }, { name: "value", type: "MsgValue" } ],
  MsgValue: [
    { name: "delegator_address", type: "string" },
    { name: "validator_address", type: "string" },
    { name: "amount", type: "TypeAmount" },
  ],
  TypeAmount: [ { name: "denom", type: "string" }, { name: "amount", type: "string" } ],
};
const domain = { name: "Cosmos Web3", version: "1.0.0", chainId: 766, verifyingContract: "cosmos", salt: "0" };
const digest = typedDataHash(domain, types, txData);
console.log("digest:", digest);

// fee_payer_sig from the extension option
const ext = d.body.extensionOptions[0];
const ebuf = ext.value; let i = 0;
const rd2 = () => { let v = 0n, s = 0n; while (true) { const b = ebuf[i++]; v |= BigInt(b & 0x7f) << s; if (!(b & 0x80)) break; s += 7n; } return v; };
let sigHex = null;
while (i < ebuf.length) { const tag = Number(rd2()); const fn = tag >> 3, wt = tag & 7;
  if (wt === 0) { rd2(); } else { const len = Number(rd2()); const bytes = ebuf.slice(i, i + len); i += len; if (fn === 3) sigHex = "0x" + toHex(bytes); } }
console.log("feePayerSig:", sigHex);
const recovered = recoverAddress(digest, sigHex);
const expected = getAddress("0x" + toHex(fromBech32(delegator).data));
console.log("recovered:", recovered);
console.log("expected :", expected);
console.log(recovered === expected ? "*** MATCH — legacy EIP-712 reconstruction PROVEN ***" : "*** MISMATCH ***");
process.exit(0);
