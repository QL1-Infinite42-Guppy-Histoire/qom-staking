import { fromBech32, toBech32 } from "@cosmjs/encoding";
import { fetchValidators, fetchMyState, fetchAccount, fetchStakingParams } from "../src/cosmos.js";

const vals = await fetchValidators();
console.log("validators total:", vals.length);
const bonded = vals.filter(v => v.status === 3);
console.log("bonded:", bonded.length);

const params = await fetchStakingParams();
console.log("unbonding days:", Number(params.unbondingTime.seconds) / 86400, "| bondDenom:", params.bondDenom);

// FoxxOne validator's own account (same bytes as the operator address)
const { data } = fromBech32(bonded[1].operatorAddress);
const account = toBech32("qom", data);
console.log("test account:", account, "| moniker:", bonded[1].description.moniker);

const acc = await fetchAccount(account);
console.log("EthAccount decoded -> accountNumber:", acc.accountNumber.toString(), "sequence:", acc.sequence.toString(), "address match:", acc.address === account);

const state = await fetchMyState(account);
console.log("available QOM:", Number(state.availableAqom) / 1e18);
console.log("delegations:", state.delegations.length);
for (const d of state.delegations) {
  console.log("  -", d.validatorAddress.slice(0, 20) + "…", "delegated:", Number(d.balanceAqom) / 1e18, "QOM | reward (raw Dec):", d.rewardAqom.slice(0, 24));
}
console.log("unbonding entries:", state.unbonding.length);
process.exit(0);
