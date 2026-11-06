// QL1 Cosmos access: reads via CometBFT RPC (no LCD exists for QL1) and
// transaction signing through a Keplr-protocol wallet (Keplr or
// FoxWallet's Cosmos provider) with ethermint pubkey encoding.
import { StargateClient, createProtobufRpcClient, defaultRegistryTypes } from "@cosmjs/stargate";
import { t } from "./i18n.js";
import { Registry } from "@cosmjs/proto-signing";
import { fromBase64, toHex } from "@cosmjs/encoding";
import { QueryClientImpl as AuthQueryClient } from "cosmjs-types/cosmos/auth/v1beta1/query.js";
import { QueryClientImpl as DistrQueryClient } from "cosmjs-types/cosmos/distribution/v1beta1/query.js";
import { BaseAccount } from "cosmjs-types/cosmos/auth/v1beta1/auth.js";
import { PubKey } from "cosmjs-types/cosmos/crypto/secp256k1/keys.js";
import { TxBody, AuthInfo, TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx.js";
import { SignMode } from "cosmjs-types/cosmos/tx/signing/v1beta1/signing.js";
import { MsgDelegate } from "cosmjs-types/cosmos/staking/v1beta1/tx.js";
import { MsgUndelegate } from "cosmjs-types/cosmos/staking/v1beta1/tx.js";
import { MsgBeginRedelegate } from "cosmjs-types/cosmos/staking/v1beta1/tx.js";
import { MsgWithdrawDelegatorReward } from "cosmjs-types/cosmos/distribution/v1beta1/tx.js";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx.js";
import Long from "long";
import protobuf from "protobufjs/minimal.js";
const { Reader } = protobuf;
import { CHAIN_ID, DENOM, RPC_URL, RPC_FALLBACK, GAS_PRICE } from "./chain.js";

// QL1 accounts sign with ethermint's ethsecp256k1 pubkey type. Confirmed
// from a real on-chain QL1 staking transaction (2026-11-05): its signer
// pubkey type_url is exactly this, in a SIGN_MODE_DIRECT tx. The wire
// format is identical to cosmos secp256k1 (single bytes field), so the
// cosmos PubKey codec encodes it correctly.
export const ETH_PUBKEY_TYPE = "/ethermint.crypto.v1.ethsecp256k1.PubKey";
const ETH_ACCOUNT_TYPE = "/ethermint.types.v1.EthAccount";

const registry = new Registry([
  ...defaultRegistryTypes,
  [ETH_PUBKEY_TYPE, PubKey],
  ["/cosmos.staking.v1beta1.MsgDelegate", MsgDelegate],
  ["/cosmos.staking.v1beta1.MsgUndelegate", MsgUndelegate],
  ["/cosmos.staking.v1beta1.MsgBeginRedelegate", MsgBeginRedelegate],
  ["/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward", MsgWithdrawDelegatorReward],
]);

let clientPromise = null;
export function getClient() {
  if (!clientPromise) {
    clientPromise = StargateClient.connect(RPC_URL).catch(() =>
      StargateClient.connect(RPC_FALLBACK),
    );
  }
  return clientPromise;
}

// ---- reads ---------------------------------------------------------------

const BOND_STATUS_NAME = [
  "BOND_STATUS_UNSPECIFIED",
  "BOND_STATUS_UNBONDED",
  "BOND_STATUS_UNBONDING",
  "BOND_STATUS_BONDED",
];

export async function fetchValidators() {
  const client = await getClient();
  const q = client.queryClient;
  const [bonded, unbonding, unbonded] = await Promise.all([
    q.staking.validators("BOND_STATUS_BONDED"),
    q.staking.validators("BOND_STATUS_UNBONDING"),
    q.staking.validators("BOND_STATUS_UNBONDED"),
  ]);
  const all = [...bonded.validators, ...unbonding.validators, ...unbonded.validators];
  // The protobuf layer returns status as a NUMBER (3 = bonded); the UI
  // works with the string names, so normalize here.
  for (const v of all) {
    if (typeof v.status === "number") v.status = BOND_STATUS_NAME[v.status] ?? "BOND_STATUS_UNSPECIFIED";
  }
  return all;
}

export async function fetchStakingParams() {
  const client = await getClient();
  const res = await client.queryClient.staking.params();
  return res.params; // { unbondingTime (Duration), maxValidators, bondDenom, ... }
}

export async function fetchMyState(address) {
  const client = await getClient();
  const q = client.queryClient;
  const distr = new DistrQueryClient(createProtobufRpcClient(q));
  const [balance, delegations, rewards, unbonding] = await Promise.all([
    q.bank.balance(address, DENOM).catch(() => ({ amount: "0", denom: DENOM })),
    q.staking.delegatorDelegations(address).catch(() => ({ delegationResponses: [] })),
    distr
      .DelegationTotalRewards({ delegatorAddress: address })
      .catch(() => ({ rewards: [], total: [] })),
    q.staking
      .delegatorUnbondingDelegations(address)
      .catch(() => ({ unbondingResponses: [] })),
  ]);
  const rewardByValidator = new Map();
  for (const r of rewards.rewards) {
    const aqom = (r.reward || []).find((c) => c.denom === DENOM);
    rewardByValidator.set(r.validatorAddress, aqom ? aqom.amount : "0");
  }
  return {
    availableAqom: balance.amount,
    delegations: delegations.delegationResponses.map((d) => ({
      validatorAddress: d.delegation.validatorAddress,
      shares: d.delegation.shares,
      balanceAqom: d.balance?.amount ?? "0",
      rewardAqom: rewardByValidator.get(d.delegation.validatorAddress) ?? "0",
    })),
    unbonding: unbonding.unbondingResponses.flatMap((u) =>
      u.entries.map((e) => ({
        validatorAddress: u.validatorAddress,
        balanceAqom: e.balance,
        completionTime: e.completionTime,
      })),
    ),
  };
}

// Account number + sequence. QL1 accounts are EthAccount (wrapping a
// BaseAccount), which CosmJS's accountFromAny cannot unpack, so decode
// the wrapper by hand: EthAccount field 1 is the BaseAccount bytes.
export async function fetchAccount(address) {
  const client = await getClient();
  const rpc = createProtobufRpcClient(client.queryClient);
  const auth = new AuthQueryClient(rpc);
  const res = await auth.Account({ address });
  const any = res.account;
  if (!any) throw new Error(t("accountNotFound"));
  if (any.typeUrl === ETH_ACCOUNT_TYPE) {
    const reader = Reader.create(any.value);
    while (reader.pos < reader.len) {
      const tag = reader.uint32();
      if (tag >>> 3 === 1 && (tag & 7) === 2) {
        return BaseAccount.decode(reader.bytes());
      }
      reader.skipType(tag & 7);
    }
    throw new Error(t("accountReadFailed"));
  }
  return BaseAccount.decode(any.value);
}

// ---- message builders -----------------------------------------------------

export const msgDelegate = (delegator, validator, amountAqom) => ({
  typeUrl: "/cosmos.staking.v1beta1.MsgDelegate",
  value: MsgDelegate.fromPartial({
    delegatorAddress: delegator,
    validatorAddress: validator,
    amount: { denom: DENOM, amount: amountAqom },
  }),
});

export const msgSend = (fromAddress, toAddress, amountAqom) => ({
  typeUrl: "/cosmos.bank.v1beta1.MsgSend",
  value: MsgSend.fromPartial({
    fromAddress,
    toAddress,
    amount: [{ denom: DENOM, amount: amountAqom }],
  }),
});

export const msgUndelegate = (delegator, validator, amountAqom) => ({
  typeUrl: "/cosmos.staking.v1beta1.MsgUndelegate",
  value: MsgUndelegate.fromPartial({
    delegatorAddress: delegator,
    validatorAddress: validator,
    amount: { denom: DENOM, amount: amountAqom },
  }),
});

export const msgRedelegate = (delegator, srcValidator, dstValidator, amountAqom) => ({
  typeUrl: "/cosmos.staking.v1beta1.MsgBeginRedelegate",
  value: MsgBeginRedelegate.fromPartial({
    delegatorAddress: delegator,
    validatorSrcAddress: srcValidator,
    validatorDstAddress: dstValidator,
    amount: { denom: DENOM, amount: amountAqom },
  }),
});

export const msgWithdrawReward = (delegator, validator) => ({
  typeUrl: "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward",
  value: MsgWithdrawDelegatorReward.fromPartial({
    delegatorAddress: delegator,
    validatorAddress: validator,
  }),
});

// ---- signing ---------------------------------------------------------------

// Builds the tx by hand so the signer pubkey uses the ethermint type URL
// (SigningStargateClient would hard-code the cosmos secp256k1 URL, which
// QL1 rejects), then lets Keplr sign the SignDoc and broadcasts via RPC.
export async function signAndSend(provider, address, pubkeyBytes, messages, gasLimit, gasPrice = GAS_PRICE) {
  const client = await getClient();
  const account = await fetchAccount(address);

  const bodyBytes = TxBody.encode(
    TxBody.fromPartial({
      messages: messages.map((m) => registry.encodeAsAny(m)),
      memo: "",
    }),
  ).finish();

  const feeAmount = (BigInt(gasLimit) * BigInt(gasPrice)).toString();
  const authInfoBytes = AuthInfo.encode(
    AuthInfo.fromPartial({
      signerInfos: [
        {
          publicKey: {
            typeUrl: ETH_PUBKEY_TYPE,
            value: PubKey.encode(PubKey.fromPartial({ key: pubkeyBytes })).finish(),
          },
          modeInfo: { single: { mode: SignMode.SIGN_MODE_DIRECT } },
          sequence: account.sequence,
        },
      ],
      fee: {
        amount: [{ denom: DENOM, amount: feeAmount }],
        gasLimit: Long.fromString(String(gasLimit)),
        payer: "",
        granter: "",
      },
    }),
  ).finish();

  const signDoc = {
    bodyBytes,
    authInfoBytes,
    chainId: CHAIN_ID,
    accountNumber: Long.fromString(account.accountNumber.toString()),
  };
  const signed = await provider.signDirect(CHAIN_ID, address, signDoc);
  const signature = fromBase64(signed.signature.signature);
  const txRaw = TxRaw.fromPartial({
    bodyBytes: signed.signed.bodyBytes ?? bodyBytes,
    authInfoBytes: signed.signed.authInfoBytes ?? authInfoBytes,
    signatures: [signature],
  });
  const txBytes = TxRaw.encode(txRaw).finish();
  const result = await client.broadcastTx(txBytes);
  if (result.code !== 0) {
    throw new Error(t("chainFailed", result.code, result.rawLog ?? ""));
  }
  return { hash: result.transactionHash, height: result.height };
}

export { toHex };
