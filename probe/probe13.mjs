import { decodeTxRaw } from "@cosmjs/proto-signing";
import { fromBase64, toHex, fromHex } from "@cosmjs/encoding";

const RPC = "https://rpc.foxxone.one";
async function rpc(method, params) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return (await r.json()).result;
}
const res = await rpc("tx_search", { query: "tx.height=10776359", page: "1", per_page: "50" });
let t = null, d = null;
for (const cand of res.txs) {
  const dd = decodeTxRaw(fromBase64(cand.tx));
  if ((dd.body.extensionOptions || []).some((e) => e.typeUrl.includes("Web3"))) { t = cand; d = dd; break; }
}
if (!t) { console.log("no web3 tx at height"); process.exit(1); }
const raw = fromBase64(t.tx);
console.log("txhash:", t.hash);
const si = d.authInfo.signerInfos[0];
console.log("signerInfo:", JSON.stringify({ modeInfo: si.modeInfo, sequence: si.sequence.toString() }));
console.log("pubkey typeUrl:", si.publicKey.typeUrl, "value len:", si.publicKey.value.length, "value hex:", toHex(si.publicKey.value));
console.log("signatures:", d.signatures.map((s) => `len=${s.length} hex=${toHex(s).slice(0, 20)}`));
console.log("fee:", JSON.stringify(d.authInfo.fee, (k, v) => typeof v === "bigint" ? v.toString() : v));
console.log("memo:", JSON.stringify(d.body.memo), "timeoutHeight:", d.body.timeoutHeight?.toString());
console.log("msg:", JSON.stringify(d.body.messages.map(m => m.typeUrl)));
// decode the extension option by hand
const ext = d.body.extensionOptions[0];
console.log("ext typeUrl:", ext.typeUrl);
const buf = ext.value; let i = 0;
const rd = () => { let v = 0n, s = 0n; while (true) { const b = buf[i++]; v |= BigInt(b & 0x7f) << s; if (!(b & 0x80)) break; s += 7n; } return v; };
while (i < buf.length) {
  const tag = Number(rd()); const fn = tag >> 3, wt = tag & 7;
  if (wt === 0) console.log(`  field ${fn} varint = ${rd()}`);
  else { const len = Number(rd()); const bytes = buf.slice(i, i + len); i += len;
    console.log(`  field ${fn} len=${len} = ${fn === 2 ? new TextDecoder().decode(bytes) : toHex(bytes).slice(0, 40) + "..."}`); }
}
console.log("raw tx len:", raw.length);
import { writeFileSync } from "node:fs";
writeFileSync("probe/real-web3-tx.b64", t.tx);
console.log("saved probe/real-web3-tx.b64");
