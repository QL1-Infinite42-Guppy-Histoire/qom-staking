// QL1 (QOM) chain definition for Keplr + CosmJS.
// Values verified on-chain / from the official QL1 validator guide:
// chainId qom_766-1, denom aqom, 18 decimals, bech32 qom / qomvaloper.
export const CHAIN_ID = "qom_766-1";
export const EVM_CHAIN_ID = 766;
export const DENOM = "aqom";
export const DECIMALS = 18;

// CometBFT RPC (CORS-enabled, verified live). LCD/REST is not published
// for QL1, so every read goes through this RPC's ABCI query path.
export const RPC_URL = "https://rpc.foxxone.one";
export const RPC_FALLBACK = "https://comet-rpc-ql1.mschihuahua.org";

export const EXPLORER_TX = "https://scan.qom.network/tx/";

// Gas price on QL1 — MEASURED on-chain (2026-11-05): eth_gasPrice and
// every sampled Cosmos tx agree on 1.8e19 aqom = 18 QOM per gas unit.
// That is the chain's floor; below it the node rejects the tx with
// "insufficient fees". (QOM's unit value is tiny, so a delegation at
// 400k gas costs ~7.2M QOM ≈ a fraction of a cent.)
export const MIN_GAS_PRICE = 18000000000000000000n; // 18 QOM / gas
export const GAS_PRICE = MIN_GAS_PRICE; // default
export const GAS_PRICE_STEPS = {
  low: 18000000000000000000n, // 18 QOM — the chain floor
  average: 22000000000000000000n, // 22 QOM
  high: 30000000000000000000n, // 30 QOM
};
// Gas limits, aligned with observed on-chain usage (a real MsgDelegate
// used 211k of a 400k limit; a 9-validator reward claim used 679k of 750k).
export const GAS = {
  delegate: 400000n,
  undelegate: 400000n,
  redelegate: 450000n,
  withdrawOne: 170000n,
  withdrawPerValidator: 85000n,
  withdrawBase: 80000n,
};

export const KEPLR_CHAIN_INFO = {
  chainId: CHAIN_ID,
  chainName: "QL1 (QOM)",
  rpc: RPC_URL,
  // No public LCD exists for QL1; Keplr requires the field, so it points
  // at the RPC host. This site never queries it (all reads use the RPC).
  rest: RPC_URL,
  bip44: { coinType: 60 }, // ethermint-style keys, same as Evmos
  bech32Config: {
    bech32PrefixAccAddr: "qom",
    bech32PrefixAccPub: "qompub",
    bech32PrefixValAddr: "qomvaloper",
    bech32PrefixValPub: "qomvaloperpub",
    bech32PrefixConsAddr: "qomvalcons",
    bech32PrefixConsPub: "qomvalconspub",
  },
  currencies: [
    { coinDenom: "QOM", coinMinimalDenom: DENOM, coinDecimals: DECIMALS },
  ],
  feeCurrencies: [
    {
      coinDenom: "QOM",
      coinMinimalDenom: DENOM,
      coinDecimals: DECIMALS,
      gasPriceStep: { low: 18000000000000000000, average: 22000000000000000000, high: 30000000000000000000 },
    },
  ],
  stakeCurrency: {
    coinDenom: "QOM",
    coinMinimalDenom: DENOM,
    coinDecimals: DECIMALS,
  },
  // QL1 is an ethermint chain: Ethereum-style keys + ethsecp256k1 pubkeys.
  features: ["eth-address-gen", "eth-key-sign"],
};
