import { Registry, decodeTxRaw } from "@cosmjs/proto-signing";
import { fromBase64, toHex } from "@cosmjs/encoding";
import { StargateClient } from "@cosmjs/stargate";
import { Tendermint34Client } from "@cosmjs/tendermint-rpc";
import { TxBody, AuthInfo, TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx.js";
import { Any } from "cosmjs-types/google/protobuf/any.js";
import { MsgDelegate } from "cosmjs-types/cosmos/staking/v1beta1/tx.js";

const RPC = "https://rpc.foxxone.one";
const FOXX_QOM = "qom19u828cx84wdqrp085td3stcwlpqpecdesmjsh0";
const FOXX_VAL = "qomvaloper19u828cx84wdqrp085td3stcwlpqpecdeklvpv6";

// FoxxOne's real pubkey + current sequence, from the chain
const tm = await Tendermint34Client.connect(RPC);
import { QueryClient } from "@cosmjs/stargate";
import { fromBech32 } from "@cosmjs/encoding";
const qc = new QueryClient(tm);
// build the query bytes by hand: QueryAccountRequest{ address } = field1 string
const addrBytes = new TextEncoder().encode(FOXX_QOM);
const req = new Uint8Array([0x0a, addrBytes.length, ...addrBytes]);
const res2 = await qc.queryAbci("/cosmos.auth.v1beta1.Query/Account", req);
// response: field1 = Any(EthAccount); EthAccount field1 = BaseAccount{ address, pubkey, account_number(f3 varint), sequence(f4 varint) }
function fields(buf) { const out = []; let i = 0;
  const rd = () => { let v = 0n, s = 0n; while (true) { const b = buf[i++]; v |= BigInt(b & 0x7f) << s; if (!(b & 0x80)) break; s += 7n; } return v; };
  while (i < buf.length) { const tag = Number(rd()); const fn = tag >> 3, wt = tag & 7;
    if (wt === 0) out.push([fn, rd()]); else if (wt === 2) { const len = Number(rd()); out.push([fn, buf.slice(i, i + len)]); i += len; } else break; }
  return out; }
const anyBytes = fields(res2.value).find(([f]) => f === 1)[1];
const anyMsg = fields(anyBytes);
const ethAcct = fields(anyMsg.find(([f]) => f === 2)[1]);
const base = fields(ethAcct.find(([f]) => f === 1)[1]);
console.log("resp fields:", fields(res2.value).map(([f,v]) => [f, typeof v === "object" ? v.length : v]));
console.log("ethacct fields:", ethAcct.map(([f,v]) => [f, typeof v === "object" ? v.length : v]));
console.log("base fields:", base.map(([f,v]) => [f, typeof v === "object" ? v.length : String(v)]));
const acct = { accountNumber: Number(base.find(([f]) => f === 3)[1]), sequence: Number(base.find(([f]) => f === 4)[1]) };
console.log("account:", acct.accountNumber, "seq:", acct.sequence);
// FoxxOne's pubkey Any comes from the account itself (BaseAccount field 2)
const pubAnyMsg = fields(base.find(([f]) => f === 2)[1]);
const foxxPubAny = { typeUrl: new TextDecoder().decode(pubAnyMsg.find(([f]) => f === 1)[1]),
                     value: pubAnyMsg.find(([f]) => f === 2)[1] };
console.log("pubkey type:", foxxPubAny.typeUrl, "key bytes:", foxxPubAny.value.length);

// manual protobuf for ExtensionOptionsWeb3Tx
function encWeb3Ext(chainId, feePayer, sig) {
  const parts = [];
  const varint = (v) => { const b = []; let x = BigInt(v); do { let byte = Number(x & 0x7fn); x >>= 7n; if (x) byte |= 0x80; b.push(byte); } while (x); return b; };
  parts.push(0x08, ...varint(chainId));
  if (feePayer) { const s = new TextEncoder().encode(feePayer); parts.push(0x12, ...varint(s.length), ...s); }
  if (sig) { parts.push(0x1a, ...varint(sig.length), ...sig); }
  return new Uint8Array(parts);
}

function buildTx({ feePayer, sigInExt, signatures }) {
  const body = TxBody.encode(TxBody.fromPartial({
    messages: [{ typeUrl: "/cosmos.staking.v1beta1.MsgDelegate",
      value: MsgDelegate.encode(MsgDelegate.fromPartial({
        delegatorAddress: FOXX_QOM, validatorAddress: FOXX_VAL,
        amount: { denom: "aqom", amount: "1000000000000000000" } })).finish() }],
    memo: "",
    extensionOptions: [Any.fromPartial({ typeUrl: "/ethermint.types.v1.ExtensionOptionsWeb3Tx",
      value: encWeb3Ext(766, feePayer, sigInExt) })],
  })).finish();
  const auth = AuthInfo.encode(AuthInfo.fromPartial({
    signerInfos: [{ publicKey: foxxPubAny, modeInfo: { single: { mode: 4 } }, sequence: BigInt(acct.sequence) }],
    fee: { amount: [{ denom: "aqom", amount: "7200000000000000000000000" }], gasLimit: 400000n },
  })).finish();
  return TxRaw.encode(TxRaw.fromPartial({ bodyBytes: body, authInfoBytes: auth, signatures })).finish();
}

async function rpc(method, params) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return (await r.json()).result;
}
async function bcast(label, bytes) {
  const res = await rpc("broadcast_tx_sync", { tx: Buffer.from(bytes).toString("base64") });
  console.log(`\n[${label}] code=${res?.code} log=${(res?.log || "").slice(0, 300)}`);
}

// Variant A: feePayer EMPTY -> ethermint decorator fingerprints "no feePayer"
await bcast("A feePayer empty", buildTx({ feePayer: "", sigInExt: new Uint8Array(65), signatures: [new Uint8Array()] }));
// Variant B: feePayer set, signatures[] NON-empty -> fingerprints "signature must be empty"
await bcast("B sig in signatures[]", buildTx({ feePayer: FOXX_QOM, sigInExt: new Uint8Array(65), signatures: [new Uint8Array(65)] }));
// Variant C: plausible shape, junk fee_payer_sig
await bcast("C normal shape junk sig", buildTx({ feePayer: FOXX_QOM, sigInExt: new Uint8Array(65).fill(7), signatures: [new Uint8Array()] }));
process.exit(0);
