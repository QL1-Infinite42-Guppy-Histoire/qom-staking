// Probe: decode the real on-chain MsgCancelUnbondingDelegation tx
// (height 8297275) to see its sign mode / extension options, i.e.
// whether it arrived via SIGN_MODE_DIRECT or the web3tx EIP-712 flow.
import { Tx } from "cosmjs-types/cosmos/tx/v1beta1/tx.js";

const RPC = "https://rpc.foxxone.one";
const HASH = "F9B4DD32608CD18D94B9EBBA622DB6AE5A34A764DAD20D98C1478A8429777116";

const res = await fetch(`${RPC}/tx?hash=0x${HASH}`);
const j = await res.json();
const b64 = j.result.tx;
const bytes = Buffer.from(b64, "base64");
const tx = Tx.decode(bytes);

console.log("code:", j.result.tx_result.code);
for (const m of tx.body.messages) {
  console.log("msg typeUrl:", m.typeUrl);
  if (m.typeUrl === "/cosmos.staking.v1beta1.MsgCancelUnbondingDelegation") {
    // fields: 1 delegator(string), 2 validator(string), 3 amount(Coin), 4 creation_height(int64)
    console.log("msg raw bytes len:", m.value.length);
  }
}
console.log("extensionOptions:", tx.body.extensionOptions.map((o) => o.typeUrl));
for (const si of tx.authInfo.signerInfos) {
  console.log("signer pubkey type:", si.publicKey?.typeUrl);
  const mode = si.modeInfo?.single?.mode ?? si.modeInfo;
  console.log("signer mode:", JSON.stringify(mode));
  console.log("sequence:", si.sequence?.toString());
}
console.log("fee:", JSON.stringify(tx.authInfo.fee?.amount), "gas:", tx.authInfo.fee?.gasLimit?.toString());
console.log("signatures:", tx.signatures.map((s) => s.length));
