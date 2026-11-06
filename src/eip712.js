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
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx.js";
import { toBech32, fromHex } from "@cosmjs/encoding";
import { keccak256, toUtf8Bytes, AbiCoder, SigningKey, recoverAddress } from "ethers";
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
export const aminoSend = (fromAddress, toAddress, amountAqom) => ({
  type: "cosmos-sdk/MsgSend",
  value: { from_address: fromAddress, to_address: toAddress,
           amount: [{ denom: DENOM, amount: amountAqom }] },
});

// Pubkey registration: a first-time EVM account has no pubkey on chain,
// which the EIP-712 flow needs. Sending a small amount to the burn
// address (the all-zero address; nobody can ever spend from it) as a
// normal bank send registers the sender's pubkey with that one tx.
export const BURN_QOM_ADDRESS = toBech32("qom", new Uint8Array(20));
export const REGISTER_AMOUNT_AQOM = (100n * 10n ** 18n).toString(); // 100 QOM

// Field order follows the Go structs; the legacy type builder walks the
// fields in this order.
const MSG_VALUE_FIELDS = {
  "cosmos-sdk/MsgDelegate": ["delegator_address", "validator_address", "amount"],
  "cosmos-sdk/MsgUndelegate": ["delegator_address", "validator_address", "amount"],
  "cosmos-sdk/MsgBeginRedelegate": ["delegator_address", "validator_src_address", "validator_dst_address", "amount"],
  "cosmos-sdk/MsgWithdrawDelegatorReward": ["delegator_address", "validator_address"],
  "cosmos-sdk/MsgSend": ["from_address", "to_address", "amount"],
};
const COIN_FIELDS = ["denom", "amount"];

// ethermint sanitizeTypedef: "_.amount" -> "TypeAmount"
function sanitizeTypedef(prefix) {
  return prefix.split(".").map((part) => {
    if (part === "_") return "Type";
    return part.split("_").map((s) => (s ? s[0].toUpperCase() + s.slice(1) : s)).join("");
  }).join("");
}

export function buildTypes(firstAminoMsg) {
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
    if (Array.isArray(v)) {
      // e.g. MsgSend.amount is a Coin array: legacy typedef "TypeAmount[]"
      const typeName = sanitizeTypedef("_." + name);
      types.MsgValue.push({ name, type: typeName + "[]" });
      types[typeName] = COIN_FIELDS.map((n) => ({ name: n, type: "string" }));
    } else if (v !== null && typeof v === "object") {
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
  "/cosmos.bank.v1beta1.MsgSend": (v) => MsgSend.encode(MsgSend.fromPartial(v)).finish(),
};

// ---- EIP-712 digest + pubkey recovery ------------------------------------
// Minimal EIP-712 encoder (geth apitypes semantics). Needed when the
// account has no pubkey on chain yet: the pubkey is then recovered
// from the wallet's signature over this digest and carried in the tx
// itself, which is what registers it. PROVEN 2026-11-05 (probe14):
// this encoder's digest recovers a real on-chain delegator exactly.
const abiCoder = AbiCoder.defaultAbiCoder();
function collectDeps(types, primary, found = new Set()) {
  if (found.has(primary) || !types[primary]) return found;
  found.add(primary);
  for (const f of types[primary]) {
    const base = f.type.replace(/\[\]$/, "");
    if (types[base]) collectDeps(types, base, found);
  }
  return found;
}
function encodeType(types, primary) {
  const deps = [...collectDeps(types, primary)].filter((t) => t !== primary).sort();
  return [primary, ...deps]
    .map((t) => `${t}(${types[t].map((f) => `${f.type} ${f.name}`).join(",")})`).join("");
}
function encodeValue(types, type, value) {
  if (types[type]) return hashStruct(types, type, value);
  if (type.endsWith("[]")) {
    const base = type.slice(0, -2);
    const parts = value.map((v) => (types[base]
      ? hashStruct(types, base, v)
      : base === "string" || base === "bytes" ? keccak256(toUtf8Bytes(v)) : encodeValue(types, base, v)));
    return keccak256("0x" + parts.map((p) => p.slice(2)).join(""));
  }
  if (type === "string") return keccak256(toUtf8Bytes(value));
  if (type === "bytes") return keccak256(value);
  if (type === "address") return abiCoder.encode(["address"], [value]);
  if (type.startsWith("uint") || type.startsWith("int")) return abiCoder.encode([type], [BigInt(value)]);
  if (type === "bool") return abiCoder.encode(["bool"], [value]);
  throw new Error("unsupported type " + type);
}
function hashStruct(types, primary, value) {
  const typeHash = keccak256(toUtf8Bytes(encodeType(types, primary)));
  const fields = types[primary].map((f) => encodeValue(types, f.type, value[f.name]));
  return keccak256("0x" + typeHash.slice(2) + fields.map((p) => p.slice(2)).join(""));
}
export function typedDataDigest(domain, types, value) {
  const ds = hashStruct(types, "EIP712Domain", domain);
  const ms = hashStruct(types, "Tx", value);
  return keccak256("0x1901" + ds.slice(2) + ms.slice(2));
}
// Recover the signer's compressed secp256k1 pubkey from (digest, sig),
// verifying it belongs to the connected EVM address.
export function recoverPubkeyBytes(digest, sigHex, ethAddress) {
  const recovered = recoverAddress(digest, sigHex);
  if (recovered.toLowerCase() !== ethAddress.toLowerCase()) {
    throw new Error("署名から復元したアドレスが、接続中のウォレットと一致しませんでした");
  }
  const uncompressed = SigningKey.recoverPublicKey(digest, sigHex); // 0x04 || X || Y
  const raw = fromHex(uncompressed.replace(/^0x/i, ""));
  const prefix = raw[64] % 2 === 0 ? 0x02 : 0x03;
  return new Uint8Array([prefix, ...raw.slice(1, 33)]);
}

// messages: [{ proto: {typeUrl, value(plain)}, amino: {type, value} }]
export async function signAndSendEvm(ethProvider, ethAddress, qomAddress, messages, gasLimit, gasPrice) {
  const client = await getClient();
  const account = await fetchAccount(qomAddress);
  let pubkeyBytes = account.pubKey ? PubKey.decode(account.pubKey.value).key : null;
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
  if (!pubkeyBytes) {
    // First transaction from this account: recover the pubkey from the
    // signature and carry it in the tx itself. Broadcasting this tx is
    // what registers the pubkey on chain.
    const digest = typedDataDigest(typedData.domain, typedData.types, typedData.message);
    pubkeyBytes = recoverPubkeyBytes(digest, sigHex, ethAddress);
  }

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
