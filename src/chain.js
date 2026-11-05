// QL1 (QOM) chain definition for Keplr + CosmJS.
// Values verified on-chain / from the official QL1 validator guide:
// chainId qom_766-1, denom aqom, 18 decimals, bech32 qom / qomvaloper.
export const CHAIN_ID = "qom_766-1";
export const DENOM = "aqom";
export const DECIMALS = 18;

// CometBFT RPC (CORS-enabled, verified live). LCD/REST is not published
// for QL1, so every read goes through this RPC's ABCI query path.
export const RPC_URL = "https://rpc.foxxone.one";
export const RPC_FALLBACK = "https://comet-rpc-ql1.mschihuahua.org";

export const EXPLORER_TX = "https://scan.qom.network/tx/";

// Gas price (aqom per gas unit) used to compute the fee shown in Keplr.
// QL1 accepts very low fees (the official validator guide's
// create-validator example pays 10,000,000 aqom in total); this leaves a
// wide safety margin while still costing a fraction of a cent.
export const GAS_PRICE = 100000n; // default (average)
export const GAS_PRICE_STEPS = { low: 50000n, average: 100000n, high: 200000n };
export const GAS = {
  delegate: 280000n,
  undelegate: 280000n,
  redelegate: 320000n,
  withdrawOne: 220000n,
  withdrawPerValidator: 200000n,
  withdrawBase: 60000n,
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
      gasPriceStep: { low: 50000, average: 100000, high: 200000 },
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
