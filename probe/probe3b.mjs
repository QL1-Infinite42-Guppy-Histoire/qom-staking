import { fetchStakingParams } from "../src/cosmos.js";
const params = await fetchStakingParams();
console.log(JSON.stringify(params, (k, v) => (typeof v === "bigint" ? v.toString() : v), 2).slice(0, 600));
process.exit(0);
