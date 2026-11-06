// Structural broadcast test (no funds move): a web3-mode MsgSend-to-burn
// tx with a dummy recovered-pubkey slot and a junk extension signature.
// Success criterion = the node routes it into the EIP-712 handler and
// fails at signature recovery (same stage as probe15), i.e. the shape
// (MsgSend + mode 127 + pubkey-in-signer-info) is accepted structurally.
import { StargateClient } from "@cosmjs/stargate";
import { TxBody, AuthInfo, TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx.js";
import { Any } from "cosmjs-types/google/protobuf/any.js";
import { PubKey } from "cosmjs-types/cosmos/crypto/secp256k1/keys.js";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx.js";
import Long from "long";

const FOXX = "qom19u828cx84wdqrp085td3stcwlpqpecdesmjsh0";
const BURN = "qom1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqp2y6ye";
function encExt(chainId, feePayer, sig) {
  const parts = []; const varint = (v) => { const b = []; let x = BigInt(v);
    do { let byte = Number(x & 0x7fn); x >>= 7n; if (x) byte |= 0x80; b.push(byte); } while (x); return b; };
  parts.push(0x08, ...varint(chainId));
  const fp = new TextEncoder().encode(feePayer); parts.push(0x12, ...varint(fp.length), ...fp);
  parts.push(0x1a, ...varint(sig.length), ...sig);
  return Any.fromPartial({ typeUrl: "/ethermint.types.v1.ExtensionOptionsWeb3Tx", value: new Uint8Array(parts) });
}
const bodyBytes = TxBody.encode(TxBody.fromPartial({
  messages: [Any.fromPartial({ typeUrl: "/cosmos.bank.v1beta1.MsgSend",
    value: MsgSend.encode(MsgSend.fromPartial({ fromAddress: FOXX, toAddress: BURN, amount: [{ denom: "aqom", amount: "100000000000000000000" }] })).finish() })],
  memo: "", extensionOptions: [encExt(766, FOXX, new Uint8Array(65).fill(7))],
})).finish();
const dummyPub = new Uint8Array(33); dummyPub[0] = 2; dummyPub.fill(9, 1);
const authInfoBytes = AuthInfo.encode(AuthInfo.fromPartial({
  signerInfos: [{ publicKey: { typeUrl: "/ethermint.crypto.v1.ethsecp256k1.PubKey",
      value: PubKey.encode(PubKey.fromPartial({ key: dummyPub })).finish() },
    modeInfo: { single: { mode: 127 } }, sequence: 25 }],
  fee: { amount: [{ denom: "aqom", amount: "3300000000000000000000000" }], gasLimit: Long.fromNumber(150000), payer: FOXX, granter: "" },
})).finish();
const txBytes = TxRaw.encode(TxRaw.fromPartial({ bodyBytes, authInfoBytes, signatures: [new Uint8Array()] })).finish();
const client = await StargateClient.connect("https://rpc.foxxone.one");
try {
  const res = await client.broadcastTx(txBytes);
  console.log("broadcast result code:", res.code, "| rawLog:", (res.rawLog || "").slice(0, 300));
} catch (e) {
  console.log("broadcast threw:", String(e?.message ?? e).slice(0, 300));
}
