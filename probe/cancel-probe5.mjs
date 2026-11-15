// Diagnose the user's failed cancel attempt (2026-11-15 ~19:06 JST):
// did any cancel tx from the user's accounts reach the chain?
// - list ALL MsgCancelUnbondingDelegation txs (was 4 known) newest first
// - list recent txs sent by the user's two known accounts (EVM -> qom)
import { toBech32, fromHex } from "@cosmjs/encoding";

const RPC = "https://rpc.foxxone.one";
const qomOf = (eth) => toBech32("qom", fromHex(eth.replace(/^0x/i, "").toLowerCase()));
const userAddrs = [
  qomOf("0xa33e223bcf1bb82d475ea29a11f3add9c2e73a23"), // main ...3a23
  qomOf("0x90359C6913915B9824b9ce8Abf4b85B30A5cF8cC"), // f8cc
];
console.log("user qom addresses:", userAddrs);

async function search(q, perPage = 10) {
  const url = `${RPC}/tx_search?query=${encodeURIComponent(q)}&per_page=${perPage}&order_by=%22desc%22`;
  const j = await (await fetch(url)).json();
  return j.result ?? j.error;
}

const cancels = await search(`"message.action='/cosmos.staking.v1beta1.MsgCancelUnbondingDelegation'"`);
console.log("== all cancel txs, total:", cancels.total_count);
for (const t of cancels.txs ?? []) {
  console.log(" height:", t.height, "code:", t.tx_result.code, "hash:", t.hash);
  if (Number(t.height) > 13000000) {
    console.log("  log:", String(t.tx_result.log ?? "").slice(0, 500));
  }
}

for (const a of userAddrs) {
  const r = await search(`"message.sender='${a}'"`, 8);
  console.log(`== recent txs from ${a}: total ${r.total_count}`);
  for (const t of r.txs ?? []) {
    const actions = [...String(t.tx_result.log ?? "").matchAll(/"action","value":"([^"]+)"/g)].map((m) => m[1]);
    console.log(" height:", t.height, "code:", t.tx_result.code, "actions:", actions.join(",") || "(log parse empty)", "hash:", t.hash);
    if (t.tx_result.code !== 0) console.log("  log:", String(t.tx_result.log ?? "").slice(0, 600));
  }
}
