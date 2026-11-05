import { JsonRpcProvider } from "ethers";
import { decodeTxRaw } from "@cosmjs/proto-signing";
import { fromBase64 } from "@cosmjs/encoding";

// 1) EVM-side gas price (ethermint exposes the chain's base fee here)
const evm = new JsonRpcProvider("https://evm-rpc-ql1.mschihuahua.org", 766);
const gp = await evm.send("eth_gasPrice", []);
console.log("eth_gasPrice:", BigInt(gp).toString(), "aqom/gas =", Number(BigInt(gp)) / 1e18, "QOM/gas");

// 2) Real Cosmos txs: fee / gas_wanted / gas_used
const RPC = "https://rpc.foxxone.one";
async function rpc(method, params) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return (await r.json()).result;
}
let page = 1, samples = 0;
while (page <= 30 && samples < 12) {
  const res = await rpc("tx_search", { query: "tx.height>12000000", page: String(page), per_page: "100", order_by: "desc" });
  if (!res?.txs?.length) break;
  for (const t of res.txs) {
    try {
      const d = decodeTxRaw(fromBase64(t.tx));
      const types = d.body.messages.map((m) => m.typeUrl);
      if (types.some((x) => x.includes("MsgEthereumTx"))) continue;
      const fee = d.authInfo.fee;
      const amt = fee?.amount?.find((c) => c.denom === "aqom");
      if (!amt || !fee.gasLimit) continue;
      const price = Number(BigInt(amt.amount)) / Number(fee.gasLimit);
      console.log(`h=${t.height} msgs=${types.map(x=>x.split(".").pop()).join("+")} fee=${(Number(BigInt(amt.amount))/1e18).toFixed(4)} QOM gasWanted=${fee.gasLimit} gasUsed=${t.tx_result.gas_used} price=${price.toExponential(2)} aqom/gas`);
      samples++;
      if (samples >= 12) break;
    } catch {}
  }
  page++;
}
console.log("samples:", samples);
