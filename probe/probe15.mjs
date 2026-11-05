// Structural test of the site's real EVM signing path (junk signature).
import { signAndSendEvm, aminoDelegate } from "../src/eip712.js";
import { msgDelegate } from "../src/cosmos.js";

const FOXX_QOM = "qom19u828cx84wdqrp085td3stcwlpqpecdesmjsh0";
const FOXX_VAL = "qomvaloper19u828cx84wdqrp085td3stcwlpqpecdeklvpv6";
const FOXX_ETH = "0x" + Buffer.from("todo").toString("hex"); // not used for recovery by the site
const fakeEth = {
  request: async ({ method }) => {
    if (method === "eth_signTypedData_v4") return "0x" + "07".repeat(65);
    throw new Error("unexpected " + method);
  },
};
try {
  await signAndSendEvm(fakeEth, "0x0000000000000000000000000000000000000000", FOXX_QOM,
    [{ proto: msgDelegate(FOXX_QOM, FOXX_VAL, "1000000000000000000"), amino: aminoDelegate(FOXX_QOM, FOXX_VAL, "1000000000000000000") }],
    400000n, 18000000000000000000n);
  console.log("UNEXPECTED SUCCESS");
} catch (e) {
  console.log("error:", String(e.message || e).slice(0, 320));
}
process.exit(0);
