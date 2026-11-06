import { Tx } from "cosmjs-types/cosmos/tx/v1beta1/tx.js";
const RPC = "https://rpc.foxxone.one";
async function rpc(method, params) {
  const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(method + ": " + JSON.stringify(j.error));
  return j.result;
}
const st = await rpc("status", {});
const latest = parseInt(st.sync_info.latest_block_height, 10);
console.log("latest height:", latest);
const res = await rpc("tx_search", { query: `tx.height>${latest - 5000}`, page: "1", per_page: "80", order_by: "desc" });
const txs = res.txs ?? [];
console.log("sampled txs:", txs.length, "total_count:", res.total_count);
const rows = [];
for (const t of txs) {
  try {
    const tx = Tx.decode(Buffer.from(t.tx, "base64"));
    const fee = tx.authInfo?.fee;
    const amt = fee?.amount?.[0];
    if (!amt || !fee?.gasLimit) continue;
    const price = Number(BigInt(amt.amount) / BigInt(fee.gasLimit)) / 1e18;
    const types = tx.body.messages.map(m => m.typeUrl.split(".").pop()).join(",");
    rows.push({ h: t.height, types, gas: Number(fee.gasLimit), feeQOM: Number(BigInt(amt.amount)) / 1e18, price });
  } catch { /* skip */ }
}
for (const r of rows.slice(0, 20)) console.log(r.h, r.types, "gas", r.gas, "fee", r.feeQOM.toFixed(1), "QOM | price", r.price.toFixed(4));
console.log("distinct prices:", [...new Set(rows.map(r => r.price.toFixed(4)))].join(", "), "| decoded:", rows.length);
