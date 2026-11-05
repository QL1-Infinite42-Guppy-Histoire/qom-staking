import { JsonRpcProvider, Contract, Interface } from "ethers";
import { fromBech32 } from "@cosmjs/encoding";
import { toHex } from "@cosmjs/encoding";

const RPC = "https://evm-rpc-ql1.mschihuahua.org";
const provider = new JsonRpcProvider(RPC, 766);
console.log("chainId:", (await provider.getNetwork()).chainId.toString());

const STAKING = "0x0000000000000000000000000000000000000800";
const DISTR = "0x0000000000000000000000000000000000000801";
const STAKING_ABI = [
  "function validators(string status, tuple(bytes key, uint64 offset, uint64 limit, bool countTotal, bool reverse) pageRequest) view returns (tuple(string operatorAddress, string consensusPubkey, bool jailed, uint8 status, uint256 tokens, uint256 delegatorShares, tuple(string moniker, string identity, string website, string securityContact, string details) description, int64 unbondingHeight, int64 unbondingTime, uint256 commission, uint256 minSelfDelegation)[] validators, tuple(bytes nextKey, uint64 total) pageResponse)",
  "function delegation(address delegatorAddress, string validatorAddress) view returns (tuple(uint256 shares, tuple(string denom, uint256 amount) balance) delegation)",
  "function unbondingDelegation(address delegatorAddress, string validatorAddress) view returns (tuple(string delegatorAddress, string validatorAddress, tuple(uint256 creationHeight, int64 completionTime, uint256 initialBalance, uint256 balance, uint64 unbondingId, int64 unbondingOnHoldRefCount)[] entries) unbondingDelegation)",
];
const DISTR_ABI = [
  "function delegationTotalRewards(address delegatorAddress) view returns (tuple(string validatorAddress, tuple(string denom, uint256 amount, uint256 precision)[] reward)[] rewards, tuple(string denom, uint256 amount, uint256 precision)[] total)",
  "function delegationRewards(address delegatorAddress, string validatorAddress) view returns (tuple(string denom, uint256 amount, uint256 precision)[] rewards)",
];

const staking = new Contract(STAKING, STAKING_ABI, provider);
try {
  const [list, page] = await staking.validators("BOND_STATUS_BONDED", { key: "0x", offset: 0, limit: 100, countTotal: true, reverse: false });
  console.log("PRECOMPILE ALIVE — bonded validators:", list.length, "total:", page.total.toString());
  for (const v of list.slice(0, 3)) console.log("  -", v.operatorAddress, v.description.moniker, "tokens:", v.tokens.toString().slice(0, 12) + "…");
} catch (e) {
  console.log("validators() FAILED:", e.message?.slice(0, 200));
  process.exit(0);
}

// FoxxOne account: qom1... -> 0x
const { data } = fromBech32("qom19u828cx84wdqrp085td3stcwlpqpecdesmjsh0");
const evmAddr = "0x" + toHex(data);
const valoper = "qomvaloper19u828cx84wdqrp085td3stcwlpqpecdeklvpv6";
console.log("evm addr:", evmAddr, "| native balance:", (await provider.getBalance(evmAddr)).toString());
try {
  const d = await staking.delegation(evmAddr, valoper);
  console.log("delegation shares:", d.shares.toString(), "balance:", d.balance.amount.toString(), d.balance.denom);
} catch (e) { console.log("delegation() FAILED:", e.message?.slice(0, 160)); }
try {
  const u = await staking.unbondingDelegation(evmAddr, valoper);
  console.log("unbonding entries:", u.entries.length);
} catch (e) { console.log("unbondingDelegation() FAILED:", e.message?.slice(0, 160)); }
const distr = new Contract(DISTR, DISTR_ABI, provider);
try {
  const r = await distr.delegationRewards(evmAddr, valoper);
  console.log("rewards:", r.map((c) => `${c.denom} ${c.amount.toString()} (prec ${c.precision})`).join(", "));
} catch (e) { console.log("delegationRewards() FAILED:", e.message?.slice(0, 160)); }
try {
  const t = await distr.delegationTotalRewards(evmAddr);
  console.log("total rewards entries:", t.rewards.length, "| total:", t.total.map((c) => `${c.denom} ${c.amount.toString()}`).join(", "));
} catch (e) { console.log("delegationTotalRewards() FAILED:", e.message?.slice(0, 160)); }
