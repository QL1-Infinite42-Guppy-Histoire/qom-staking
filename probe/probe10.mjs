import { decodeTxRaw } from "@cosmjs/proto-signing";
import { fromBase64 } from "@cosmjs/encoding";
import { Tendermint34Client } from "@cosmjs/tendermint-rpc";
import { QueryClient } from "@cosmjs/stargate";
import { TxBody, AuthInfo, TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx.js";
import { Any } from "cosmjs-types/google/protobuf/any.js";
import { MsgDelegate } from "cosmjs-types/cosmos/staking/v1beta1/tx.js";

const RPC = "https://rpc.foxxone.one";
const FOXX_QOM = "qom19u828cx84wdqrp085td3stcwlpqpecdesmjsh0";
const FOXX_VAL = "qomvaloper19u828cx84wdqrp085td3stcwlpqpecdeklvpv6";
async function rpc(method, params) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return (await r.json()).result;
}
// account + pubkey via hand parser (same as probe9)
const tm = await Tendermint34Client.connect(RPC);
const qc = new QueryClient(tm);
function fields(buf) { const out = []; let i = 0;
  const rd = () => { let v = 0n, s = 0n; while (true) { const b = buf[i++]; v |= BigInt(b & 0x7f) << s; if (!(b & 0x80)) break; s += 7n; } return v; };
  while (i < buf.length) { const tag = Number(rd()); const fn = tag >> 3, wt = tag & 7;
    if (wt === 0) out.push([fn, rd()]); else if (wt === 2) { const len = Number(rd()); out.push([fn, buf.slice(i, i + len)]); i += len; } else break; }
  return out; }
const addrBytes = new TextEncoder().encode(FOXX_QOM);
const res2 = await qc.queryAbci("/cosmos.auth.v1beta1.Query/Account", new Uint8Array([0x0a, addrBytes.length, ...addrBytes]));
const anyMsg = fields(fields(res2.value).find(([f]) => f === 1)[1]);
const ethAcct = fields(anyMsg.find(([f]) => f === 2)[1]);
const base = fields(ethAcct.find(([f]) => f === 1)[1]);
const accNum = Number(base.find(([f]) => f === 3)[1]);
const seq = Number(base.find(([f]) => f === 4)[1]);
const pubAnyMsg = fields(base.find(([f]) => f === 2)[1]);
const foxxPubAny = { typeUrl: new TextDecoder().decode(pubAnyMsg.find(([f]) => f === 1)[1]), value: pubAnyMsg.find(([f]) => f === 2)[1] };
console.log("acct", accNum, "seq", seq);

function encWeb3Ext(chainId, feePayer, sig) {
  const parts = []; const varint = (v) => { const b = []; let x = BigInt(v); do { let byte = Number(x & 0x7fn); x >>= 7n; if (x) byte |= 0x80; b.push(byte); } while (x); return b; };
  parts.push(0x08, ...varint(chainId));
  if (feePayer) { const s = new TextEncoder().encode(feePayer); parts.push(0x12, ...varint(s.length), ...s); }
  if (sig) { parts.push(0x1a, ...varint(sig.length), ...sig); }
  return new Uint8Array(parts);
}
function buildTx(mode) {
  const body = TxBody.encode(TxBody.fromPartial({
    messages: [{ typeUrl: "/cosmos.staking.v1beta1.MsgDelegate",
      value: MsgDelegate.encode(MsgDelegate.fromPartial({ delegatorAddress: FOXX_QOM, validatorAddress: FOXX_VAL,
        amount: { denom: "aqom", amount: "1000000000000000000" } })).finish() }],
    memo: "",
    extensionOptions: [Any.fromPartial({ typeUrl: "/ethermint.types.v1.ExtensionOptionsWeb3Tx",
      value: encWeb3Ext(766, FOXX_QOM, new Uint8Array(65).fill(7)) })],
  })).finish();
  const auth = AuthInfo.encode(AuthInfo.fromPartial({
    signerInfos: [{ publicKey: foxxPubAny, modeInfo: { single: { mode } }, sequence: BigInt(seq) }],
    fee: { amount: [{ denom: "aqom", amount: "7200000000000000000000000" }], gasLimit: 400000n },
  })).finish();
  return TxRaw.encode(TxRaw.fromPartial({ bodyBytes: body, authInfoBytes: auth, signatures: [new Uint8Array()] })).finish();
}
// local decode sanity check for mode 4
const chk = decodeTxRaw(buildTx(4));
console.log("local decode modeInfo:", JSON.stringify(chk.authInfo.signerInfos[0].modeInfo), "ext:", chk.body.extensionOptions?.map(e=>e.typeUrl));

for (const mode of [1, 2, 3, 4, 5, 6, 7]) {
  const res = await rpc("broadcast_tx_sync", { tx: Buffer.from(buildTx(mode)).toString("base64") });
  console.log(`mode=${mode} code=${res?.code} log=${(res?.log || "").slice(0, 190)}`);
}
process.exit(0);
