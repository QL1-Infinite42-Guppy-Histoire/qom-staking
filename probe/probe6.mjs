import { fetchValidators } from "../src/cosmos.js";
const vals = await fetchValidators();
const byStatus = {};
for (const v of vals) byStatus[v.status] = (byStatus[v.status] || 0) + 1;
console.log("status values after fix:", JSON.stringify(byStatus));
console.log("sample bonded:", vals.find(v => v.status === "BOND_STATUS_BONDED")?.description.moniker);
process.exit(0);
