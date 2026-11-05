import { decodeTxRaw } from "@cosmjs/proto-signing";
import { fromBase64 } from "@cosmjs/encoding";

const RPC = "https://rpc.foxxone.one";
async function rpc(method, params) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return (await r.json()).result;
}
const st = await rpc("status", {});
const latest = Number(st.sync_info.latest_block_height);
console.log("latest height:", latest);

let scanned = 0, web3 = 0, eth = 0, cosmos = 0;
const heights = [];
for (let h = latest; h > latest - 120; h--) heights.push(h);
for (let i = 0; i < 200; i++) heights.push(100000 + Math.floor(Math.random() * (latest - 200000)));
for (const h of heights) {
  const b = await rpc("block", { height: String(h) });
  const txs = b?.block?.data?.txs || [];
  for (const raw of txs) {
    try {
      const d = decodeTxRaw(fromBase64(raw));
      scanned++;
      const types = d.body.messages.map((m) => m.typeUrl);
      if (d.body.extensionOptions?.length) {
        web3++;
        console.log(`WEB3-EXT tx at h=${h}: ext=${d.body.extensionOptions.map(e=>e.typeUrl).join(",")} msgs=${types.join(",")}`);
      } else if (types.some((t) => t.includes("MsgEthereumTx"))) eth++;
      else cosmos++;
    } catch {}
  }
}
console.log(`scanned=${scanned} web3ext=${web3} ethereumtx=${eth} cosmostx=${cosmos}`);
