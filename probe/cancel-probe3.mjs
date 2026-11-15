// Probe 3 (redo of probe2 with the site's own transport — CosmJS):
// (a) read side: decode a recent MsgUndelegate tx to get a real
//     delegator, then query their unbonding entries and check that
//     creation_height is populated.
// (b) write side: web3tx EIP-712 txs (mode 127 + ExtensionOptionsWeb3Tx,
//     garbage signature — can never pass CheckTx, nothing can commit)
//     broadcast via broadcastTxSync. Compare error shapes:
//     cancel (target) vs delegate (known-good) vs bogus type.
import { StargateClient, createProtobufRpcClient } from "@cosmjs/stargate";
import { Tendermint34Client } from "@cosmjs/tendermint-rpc";
import { TxBody, AuthInfo, TxRaw, Tx } from "cosmjs-types/cosmos/tx/v1beta1/tx.js";
import { Any } from "cosmjs-types/google/protobuf/any.js";
import { PubKey } from "cosmjs-types/cosmos/crypto/secp256k1/keys.js";
import { MsgCancelUnbondingDelegation, MsgDelegate, MsgUndelegate } from "cosmjs-types/cosmos/staking/v1beta1/tx.js";
import { BaseAccount } from "cosmjs-types/cosmos/auth/v1beta1/auth.js";
import { QueryClientImpl as AuthQueryClient } from "cosmjs-types/cosmos/auth/v1beta1/query.js";
import protobuf from "protobufjs/minimal.js";
const { Reader } = protobuf;
import Long from "long";

const RPC = "https://rpc.foxxone.one";
const DENOM = "aqom";
const ETH_PUBKEY_TYPE = "/ethermint.crypto.v1.ethsecp256k1.PubKey";
const WEB3_EXT_TYPE = "/ethermint.types.v1.ExtensionOptionsWeb3Tx";
const EVM_CHAIN_ID = 766;

const client = await StargateClient.connect(RPC);
const tm = await Tendermint34Client.connect(RPC);

// ---- (a) read side ---------------------------------------------------------
const search = await (await fetch(`${RPC}/tx_search?query=%22message.action%3D'%2Fcosmos.staking.v1beta1.MsgUndelegate'%22&per_page=5&order_by=%22desc%22`)).json();
let found = 0;
for (const t of search.result.txs) {
  const tx = Tx.decode(Buffer.from(t.tx, "base64"));
  for (const m of tx.body.messages) {
    if (m.typeUrl !== "/cosmos.staking.v1beta1.MsgUndelegate") continue;
    const msg = MsgUndelegate.decode(m.value);
    const ub = await client.queryClient.staking.delegatorUnbondingDelegations(msg.delegatorAddress);
    for (const u of ub.unbondingResponses) {
      for (const e of u.entries) {
        console.log("READ OK delegator:", msg.delegatorAddress,
          "| validator:", u.validatorAddress,
          "| creationHeight:", e.creationHeight?.toString(),
          "| balance:", e.balance, "| completion:", e.completionTime);
        found++;
      }
    }
  }
  if (found >= 2) break;
}
if (!found) console.log("READ: no live unbonding entries found among recent undelegators");

// ---- account info for the real cancel-tx delegator -------------------------
const delegator = "qom14qx5z3whmu6d35xgmmeezer7ctfwtxmrnprgfs";
const validator = "qomvaloper14qx5z3whmu6d35xgmmeezer7ctfwtxmr49aej9";
const auth = new AuthQueryClient(createProtobufRpcClient(client.queryClient));
const accRes = await auth.Account({ address: delegator });
let account;
{
  const reader = Reader.create(accRes.account.value);
  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    if (tag >>> 3 === 1 && (tag & 7) === 2) { account = BaseAccount.decode(reader.bytes()); break; }
    reader.skipType(tag & 7);
  }
}
const realTxJson = await (await fetch(`${RPC}/tx?hash=0xF9B4DD32608CD18D94B9EBBA622DB6AE5A34A764DAD20D98C1478A8429777116`)).json();
const realTx = Tx.decode(Buffer.from(realTxJson.result.tx, "base64"));
const realPubkey = PubKey.decode(realTx.authInfo.signerInfos[0].publicKey.value).key;
console.log("== account sequence:", account.sequence.toString(), "| pubkey reused from real tx");

// ---- (b) web3tx CheckTx probes ---------------------------------------------
function encodeWeb3Extension(chainId, feePayer, sigBytes) {
  const parts = [];
  const varint = (v) => { const b = []; let x = BigInt(v); do { let byte = Number(x & 0x7fn); x >>= 7n; if (x) byte |= 0x80; b.push(byte); } while (x); return b; };
  parts.push(0x08, ...varint(chainId));
  const fp = new TextEncoder().encode(feePayer);
  parts.push(0x12, ...varint(fp.length), ...fp);
  parts.push(0x1a, ...varint(sigBytes.length), ...sigBytes);
  return Any.fromPartial({ typeUrl: WEB3_EXT_TYPE, value: new Uint8Array(parts) });
}

function buildWeb3Tx(msgAny) {
  const garbageSig = new Uint8Array(65).fill(7);
  const bodyBytes = TxBody.encode(TxBody.fromPartial({
    messages: [msgAny], memo: "",
    extensionOptions: [encodeWeb3Extension(EVM_CHAIN_ID, delegator, garbageSig)],
  })).finish();
  const gasLimit = 400000;
  const feeAmount = (BigInt(gasLimit) * 18000000000000000000n).toString();
  const authInfoBytes = AuthInfo.encode(AuthInfo.fromPartial({
    signerInfos: [{
      publicKey: { typeUrl: ETH_PUBKEY_TYPE, value: PubKey.encode(PubKey.fromPartial({ key: realPubkey })).finish() },
      modeInfo: { single: { mode: 127 } },
      sequence: account.sequence,
    }],
    fee: { amount: [{ denom: DENOM, amount: feeAmount }], gasLimit: Long.fromNumber(gasLimit), payer: delegator, granter: "" },
  })).finish();
  return TxRaw.encode(TxRaw.fromPartial({ bodyBytes, authInfoBytes, signatures: [new Uint8Array()] })).finish();
}

async function checkTx(label, txBytes) {
  const r = await tm.broadcastTxSync({ tx: txBytes });
  console.log(`CheckTx [${label}] code:`, r.code, "| log:", String(r.log ?? "").slice(0, 300));
}

const cancelMsg = Any.fromPartial({
  typeUrl: "/cosmos.staking.v1beta1.MsgCancelUnbondingDelegation",
  value: MsgCancelUnbondingDelegation.encode(MsgCancelUnbondingDelegation.fromPartial({
    delegatorAddress: delegator, validatorAddress: validator,
    amount: { denom: DENOM, amount: "1000000000000000000" },
    creationHeight: Long.fromNumber(8233941),
  })).finish(),
});
const delegateMsg = Any.fromPartial({
  typeUrl: "/cosmos.staking.v1beta1.MsgDelegate",
  value: MsgDelegate.encode(MsgDelegate.fromPartial({
    delegatorAddress: delegator, validatorAddress: validator,
    amount: { denom: DENOM, amount: "1000000000000000000" },
  })).finish(),
});
const bogusMsg = Any.fromPartial({ typeUrl: "/cosmos.staking.v1beta1.MsgBogus", value: new Uint8Array([1, 2, 3]) });

await checkTx("cancel-unbonding (target)", buildWeb3Tx(cancelMsg));
await checkTx("delegate (known-good control)", buildWeb3Tx(delegateMsg));
await checkTx("bogus type (unregistered control)", buildWeb3Tx(bogusMsg));
tm.disconnect();
