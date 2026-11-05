import { decodeTxRaw } from "@cosmjs/proto-signing";
import { fromBase64 } from "@cosmjs/encoding";

const RPC = "https://rpc.foxxone.one";
async function rpc(method, params) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  return j.result;
}
// tx_search for recent txs (any kind), decode and inspect
let page = 1, inspected = 0, cosmosSigned = 0;
const seen = {};
while (page <= 10 && cosmosSigned < 8) {
  const res = await rpc("tx_search", { query: "tx.height>13300000", page: String(page), per_page: "100", order_by: "desc" });
  if (!res || !res.txs?.length) { console.log("no more txs at page", page); break; }
  for (const t of res.txs) {
    inspected++;
    try {
      const decoded = decodeTxRaw(fromBase64(t.tx));
      const types = decoded.body.messages.map((m) => m.typeUrl);
      const pk = decoded.authInfo.signerInfos[0]?.publicKey;
      const key = types.join(",") + " | pk=" + (pk?.typeUrl ?? "(none)");
      seen[key] = (seen[key] || 0) + 1;
      if (pk) { cosmosSigned++; if (cosmosSigned <= 8) console.log("height", t.height, key, "fee:", JSON.stringify(decoded.authInfo.fee?.amount)); }
    } catch { /* unparseable */ }
  }
  page++;
}
console.log("inspected:", inspected, "with pubkey:", cosmosSigned);
console.log("breakdown:", seen);
