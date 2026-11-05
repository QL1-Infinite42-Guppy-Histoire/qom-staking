import { decodeTxRaw } from "@cosmjs/proto-signing";
import { fromBase64 } from "@cosmjs/encoding";

const RPC = "https://rpc.foxxone.one";
async function rpc(method, params) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return (await r.json()).result;
}
const queries = [
  "message.action='delegate'",
  "message.action='/cosmos.staking.v1beta1.MsgDelegate'",
  "message.action='begin_unbonding'",
  "message.action='withdraw_delegator_reward'",
  "message.action='/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward'",
];
let total = 0, web3 = 0; const modes = {};
for (const q of queries) {
  for (let page = 1; page <= 10; page++) {
    const res = await rpc("tx_search", { query: q, page: String(page), per_page: "100", order_by: "desc" });
    const txs = res?.txs || [];
    if (!txs.length) break;
    for (const t of txs) {
      try {
        const d = decodeTxRaw(fromBase64(t.tx));
        total++;
        const m = d.authInfo.signerInfos[0]?.modeInfo?.single?.mode;
        modes[m] = (modes[m] || 0) + 1;
        const exts = (d.body.extensionOptions || []).map((e) => e.typeUrl);
        if (exts.length) {
          web3++;
          console.log(`EXT h=${t.height} ext=${exts.join(",")} mode=${m} code=${t.tx_result.code} msgs=${d.body.messages.map(x=>x.typeUrl).join(",")}`);
        }
      } catch {}
    }
    if (txs.length < 100) break;
  }
}
console.log(`total cosmos staking/dist txs scanned: ${total}, with extensionOptions: ${web3}, signer modes seen:`, modes);
