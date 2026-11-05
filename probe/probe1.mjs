import { StargateClient } from "@cosmjs/stargate";
import { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx.js";
import { decodeTxRaw } from "@cosmjs/proto-signing";

const RPC = "https://rpc.foxxone.one";
const client = await StargateClient.connect(RPC);
console.log("chainId:", await client.getChainId());
console.log("height:", await client.getHeight());

// 1) Bonded validators via RPC query client (no LCD)
const vals = await client.queryClient.staking.validators("BOND_STATUS_BONDED");
console.log("bonded validators:", vals.validators.length);
for (const v of vals.validators.slice(0, 5)) {
  console.log(" -", v.operatorAddress, v.description.moniker, "tokens:", v.tokens, "commission:", v.commission.commissionRates.rate);
}

// 2) Scan recent blocks for signed txs -> inspect pubkey type_url + msg types
let found = 0;
const height = await client.getHeight();
for (let h = height; h > height - 400 && found < 6; h--) {
  const block = await client.getBlock(h);
  for (const raw of block.txs) {
    try {
      const decoded = decodeTxRaw(raw);
      const pk = decoded.authInfo.signerInfos[0]?.publicKey;
      const msgs = decoded.body.messages.map((m) => m.typeUrl).join(",");
      console.log(`block ${h}: msgs=[${msgs}] pubkeyType=${pk?.typeUrl}`);
      found++;
      if (found >= 6) break;
    } catch (e) {
      // not a standard cosmos tx (could be eth tx), skip
    }
  }
}
console.log("scanned txs:", found);
client.disconnect();
