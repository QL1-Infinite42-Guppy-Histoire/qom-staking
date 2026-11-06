import { Tx } from "cosmjs-types/cosmos/tx/v1beta1/tx.js";
const RPC = "https://rpc.foxxone.one";
async function rpc(method, params) {
  const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(method + ": " + JSON.stringify(j.error));
  return j.result;
}
for (const action of ["/cosmos.staking.v1beta1.MsgDelegate", "/cosmos.bank.v1beta1.MsgSend", "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward"]) {
  const res = await rpc("tx_search", { query: `message.action='${action}'`, page: "1", per_page: "8", order_by: "desc" });
  const txs = res.txs ?? [];
  console.log("\n==", action, "total:", res.total_count);
  for (const t of txs.slice(0, 5)) {
    try {
      const tx = Tx.decode(Buffer.from(t.tx, "base64"));
      const fee = tx.authInfo?.fee; const amt = fee?.amount?.[0];
      if (!amt || !fee?.gasLimit) { console.log(t.height, "no fee"); continue; }
      const price = Number(BigInt(amt.amount) / BigInt(fee.gasLimit)) / 1e18;
      console.log(t.height, "code", t.tx_result.code, "gas", Number(fee.gasLimit), "fee", (Number(BigInt(amt.amount)) / 1e18).toFixed(1), "QOM | price", price.toFixed(4));
    } catch (e) { console.log(t.height, "decode fail"); }
  }
}
