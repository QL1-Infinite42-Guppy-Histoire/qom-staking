// Offline structural test: build a delegate tx exactly as signAndSend does
// (minus Keplr), then decode it back and compare with the on-chain format.
import { Registry } from "@cosmjs/proto-signing";
import { defaultRegistryTypes } from "@cosmjs/stargate";
import { decodeTxRaw } from "@cosmjs/proto-signing";
import { PubKey } from "cosmjs-types/cosmos/crypto/secp256k1/keys.js";
import { TxBody, AuthInfo, TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx.js";
import { SignMode } from "cosmjs-types/cosmos/tx/signing/v1beta1/signing.js";
import { MsgDelegate } from "cosmjs-types/cosmos/staking/v1beta1/tx.js";
import Long from "long";

const ETH = "/ethermint.crypto.v1.ethsecp256k1.PubKey";
const registry = new Registry([...defaultRegistryTypes, [ETH, PubKey],
  ["/cosmos.staking.v1beta1.MsgDelegate", MsgDelegate]]);

const delegator = "qom19u828cx84wdqrp085td3stcwlpqpecdesmjsh0";
const validator = "qomvaloper19u828cx84wdqrp085td3stcwlpqpecdeklvpv6";
const fakePubkey = new Uint8Array(33).fill(7); fakePubkey[0] = 2;

const bodyBytes = TxBody.encode(TxBody.fromPartial({
  messages: [registry.encodeAsAny({
    typeUrl: "/cosmos.staking.v1beta1.MsgDelegate",
    value: MsgDelegate.fromPartial({ delegatorAddress: delegator, validatorAddress: validator,
      amount: { denom: "aqom", amount: "1000000000000000000" } }),
  })], memo: "",
})).finish();

const authInfoBytes = AuthInfo.encode(AuthInfo.fromPartial({
  signerInfos: [{ publicKey: { typeUrl: ETH, value: PubKey.encode(PubKey.fromPartial({ key: fakePubkey })).finish() },
    modeInfo: { single: { mode: SignMode.SIGN_MODE_DIRECT } }, sequence: 25n }],
  fee: { amount: [{ denom: "aqom", amount: "28000000000" }], gasLimit: Long.fromNumber(280000), payer: "", granter: "" },
})).finish();

const raw = TxRaw.encode(TxRaw.fromPartial({ bodyBytes, authInfoBytes, signatures: [new Uint8Array(64)] })).finish();
const back = decodeTxRaw(raw);
console.log("msg type:", back.body.messages[0].typeUrl);
console.log("decoded msg:", JSON.stringify(back.body.messages[0].value));
console.log("pubkey type:", back.authInfo.signerInfos[0].publicKey.typeUrl);
console.log("sign mode:", back.authInfo.signerInfos[0].modeInfo.single.mode, "(1 = SIGN_MODE_DIRECT)");
console.log("fee:", JSON.stringify(back.authInfo.fee.amount), "gas:", back.authInfo.fee.gasLimit.toString());
console.log("sequence:", back.authInfo.signerInfos[0].sequence.toString());
console.log("STRUCTURE OK");
