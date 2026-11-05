// MetaMask / EVM-wallet support via ethermint's legacy EIP-712 "web3 tx"
// flow. QL1 has no staking precompile, but its node accepts Cosmos txs
// signed with MetaMask through EIP-712 typed data (signer mode 127 +
// ExtensionOptionsWeb3Tx). PROVEN 2026-11-05: 111 such txs exist on
// QL1 (delegates and reward claims, all code 0), and reconstructing
// one real delegation's typed data locally recovers its delegator.
import { TxBody, AuthInfo, TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx.js";
import { Any } from "cosmjs-types/google/protobuf/any.js";
import { PubKey } from "cosmjs-types/cosmos/crypto/secp256k1/keys.js";
import { MsgDelegate } from "cosmjs-types/cosmos/staking/v1beta1/tx.js";
import { MsgUndelegate } from "cosmjs-types/cosmos/staking/v1beta1/tx.js";
import { MsgBeginRedelegate } from "cosmjs-types/cosmos/staking/v1beta1/tx.js";
import { MsgWithdrawDelegatorReward } from "cosmjs-types/cosmos/distribution/v1beta1/tx.js";
import { toBech32, fromHex } from "@cosmjs/encoding";
import Long from "long";
import { CHAIN_ID, DENOM, EVM_CHAIN_ID } from "./chain.js";
import { getClient, fetchAccount, ETH_PUBKEY_TYPE } from "./cosmos.js";

export const WEB3_SIGN_MODE = 127;
const WEB3_EXT_TYPE = "/ethermint.types.v1.ExtensionOptionsWeb3Tx";

export function qomAddressFromEth(ethAddress) {
  return toBech32("qom", fromHex(ethAddress.replace(/^0x/i, "").toLowerCase()));
}

// ---- amino representations (what the legacy sign doc carries) -----------

export const aminoDelegate = (delegator, validator, amountAqom) => ({
  type: "cosmos-sdk/MsgDelegate",
  value: { delegator_address: delegator, validator_address: validator,
           amount: { denom: DENOM, amount: amountAqom } },
});
export const aminoUndelegate = (delegator, validator, amountAqom) => ({
  type: "cosmos-sdk/MsgUndelegate",
  value: { delegator_address: delegator, validator_address: validator,
           amount: { denom: DENOM, amount: amountAqom } },
});
export const aminoRedelegate = (delegator, src, dst, amountAqom) => ({
  type: "cosmos-sdk/MsgBeginRedelegate",
  value: { delegator_address: delegator, validator_src_address: src, validator_dst_address: dst,
           amount: { denom: DENOM, amount: amountAqom } },
});
export const aminoWithdrawReward = (delegator, validator) => ({
  type: "cosmos-sdk/MsgWithdrawDelegatorReward",
  value: { delegator_address: delegator, validator_address: validator },
});

// Field order follows the Go structs; the legacy type builder walks the
// fields in this order.
const MSG_VALUE_FIELDS = {
  "cosmos-sdk/MsgDelegate": ["delegator_address", "validator_address", "amount"],
  "cosmos-sdk/MsgUndelegate": ["delegator_address", "validator_address", "amount"],
  "cosmos-sdk/MsgBeginRedelegate": ["delegator_address", "validator_src_address", "validator_dst_address", "amount"],
  "cosmos-sdk/MsgWithdrawDelegatorReward": ["delegator_address", "validator_address"],
};
const COIN_FIELDS = ["denom", "amount"];

// ethermint sanitizeTypedef: "_.amount" -> "TypeAmount"
function sanitizeTypedef(prefix) {
  return prefix.split(".").map((part) => {
    if (part === "_") return "Type";
    return part.split("_").map((s) => (s ? s[0].toUpperCase() + s.slice(1) : s)).join("");
  }).join("");
}

function buildTypes(firstAminoMsg) {
  const types = {
    EIP712Domain: [
      { name: "name", type: "string" }, { name: "version", type: "string" },
      { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "string" },
      { name: "salt", type: "string" },
    ],
    Tx: [
      { name: "account_number", type: "string" }, { name: "chain_id", type: "string" },
      { name: "fee", type: "Fee" }, { name: "memo", type: "string" },
      { name: "msgs", type: "Msg[]" }, { name: "sequence", type: "string" },
    ],
    Fee: [
      { name: "feePayer", type: "string" }, { name: "amount", type: "Coin[]" },
      { name: "gas", type: "string" },
    ],
    Coin: COIN_FIELDS.map((n) => ({ name: n, type: "string" })),
    Msg: [
      { name: "type", type: "string" }, { name: "value", type: "MsgValue" },
    ],
    MsgValue: [],
  };
  const fields = MSG_VALUE_FIELDS[firstAminoMsg.type];
  if (!fields) throw new Error("対応していない取引です: " + firstAminoMsg.type);
  for (const name of fields) {
    const v = firstAminoMsg.value[name];
    if (v !== null && typeof v === "object") {
      const typeName = sanitizeTypedef("_." + name);
      types.MsgValue.push({ name, type: typeName });
      types[typeName] = COIN_FIELDS.map((n) => ({ name: n, type: "string" }));
    } else {
      types.MsgValue.push({ name, type: "string" });
    }
  }
  return types;
}

// ---- extension option protobuf (3 fields, hand-encoded) -----------------

function encodeWeb3Extension(chainId, feePayer, sigBytes) {
  const parts = [];
  const varint = (v) => {
    const b = []; let x = BigInt(v);
    do { let byte = Number(x & 0x7fn); x >>= 7n; if (x) byte |= 0x80; b.push(byte); } while (x);
    return b;
  };
  parts.push(0x08, ...varint(chainId));
  const fp = new TextEncoder().encode(feePayer);
  parts.push(0x12, ...varint(fp.length), ...fp);
  parts.push(0x1a, ...varint(sigBytes.length), ...sigBytes);
  return Any.fromPartial({ typeUrl: WEB3_EXT_TYPE, value: new Uint8Array(parts) });
}

const PROTO_ENCODERS = {
  "/cosmos.staking.v1beta1.MsgDelegate": (v) => MsgDelegate.encode(MsgDelegate.fromPartial(v)).finish(),
  "/cosmos.staking.v1beta1.MsgUndelegate": (v) => MsgUndelegate.encode(MsgUndelegate.fromPartial(v)).finish(),
  "/cosmos.staking.v1beta1.MsgBeginRedelegate": (v) => MsgBeginRedelegate.encode(MsgBeginRedelegate.fromPartial(v)).finish(),
  "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward": (v) => MsgWithdrawDelegatorReward.encode(MsgWithdrawDelegatorReward.fromPartial(v)).finish(),
};

// messages: [{ proto: {typeUrl, value(plain)}, amino: {type, value} }]
export async function signAndSendEvm(ethProvider, ethAddress, qomAddress, messages, gasLimit, gasPrice) {
  const client = await getClient();
  const account = await fetchAccount(qomAddress);
  if (!account.pubKey) {
    throw new Error("このアドレスの公開鍵がまだチェーンに登録されていません。先に Keplr などで一度取引してからお試しください");
  }
  const pubkeyBytes = PubKey.decode(account.pubKey.value).key;
  const feeAmount = (BigInt(gasLimit) * BigInt(gasPrice)).toString();
  const aminoMsgs = messages.map((m) => m.amino);

  const txData = {
    account_number: account.accountNumber.toString(),
    chain_id: CHAIN_ID,
    fee: {
      amount: [{ amount: feeAmount, denom: DENOM }],
      gas: String(gasLimit),
      feePayer: qomAddress,
    },
    memo: "",
    msgs: aminoMsgs,
    sequence: account.sequence.toString(),
  };
  const typedData = {
    types: buildTypes(aminoMsgs[0]),
    primaryType: "Tx",
    domain: {
      name: "Cosmos Web3", version: "1.0.0", chainId: EVM_CHAIN_ID,
      verifyingContract: "cosmos", salt: "0",
    },
    message: txData,
  };
  const sigHex = await ethProvider.request({
    method: "eth_signTypedData_v4",
    params: [ethAddress, JSON.stringify(typedData)],
  });
  const sigBytes = fromHex(sigHex.replace(/^0x/i, ""));
  if (sigBytes.length !== 65) throw new Error("ウォレットから想定外の署名が返りました");

  const bodyBytes = TxBody.encode(
    TxBody.fromPartial({
      messages: messages.map((m) => Any.fromPartial({
        typeUrl: m.proto.typeUrl,
        value: PROTO_ENCODERS[m.proto.typeUrl](m.proto.value),
      })),
      memo: "",
      extensionOptions: [encodeWeb3Extension(EVM_CHAIN_ID, qomAddress, sigBytes)],
    }),
  ).finish();
  const authInfoBytes = AuthInfo.encode(
    AuthInfo.fromPartial({
      signerInfos: [{
        publicKey: {
          typeUrl: ETH_PUBKEY_TYPE,
          value: PubKey.encode(PubKey.fromPartial({ key: pubkeyBytes })).finish(),
        },
        modeInfo: { single: { mode: WEB3_SIGN_MODE } },
        sequence: account.sequence,
      }],
      fee: {
        amount: [{ denom: DENOM, amount: feeAmount }],
        gasLimit: Long.fromString(String(gasLimit)),
        payer: qomAddress,
        granter: "",
      },
    }),
  ).finish();
  const txBytes = TxRaw.encode(
    TxRaw.fromPartial({ bodyBytes, authInfoBytes, signatures: [new Uint8Array()] }),
  ).finish();
  const result = await client.broadcastTx(txBytes);
  if (result.code !== 0) {
    throw new Error(`チェーン側で失敗しました (code ${result.code}): ${result.rawLog ?? ""}`);
  }
  return { hash: result.transactionHash, height: result.height };
}
