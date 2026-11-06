// Self-consistency test for the pubkey-recovery path, using the site's
// own eip712.js exports: sign our EIP-712 digest with a fresh key and
// confirm the recovered compressed pubkey maps back to the signer.
// (Digest correctness vs the node is covered by probe14, which recovers
// a real on-chain delegator with this same encoder.)
import { Wallet, computeAddress } from "ethers";
import { buildTypes, typedDataDigest, recoverPubkeyBytes, aminoSend, aminoDelegate, BURN_QOM_ADDRESS, REGISTER_AMOUNT_AQOM, qomAddressFromEth } from "../src/eip712.js";

const wallet = Wallet.createRandom();
const eth = wallet.address;
const qom = qomAddressFromEth(eth);
console.log("fresh wallet:", eth, "->", qom);
console.log("burn address:", BURN_QOM_ADDRESS);
const domain = { name: "Cosmos Web3", version: "1.0.0", chainId: 766, verifyingContract: "cosmos", salt: "0" };
function check(label, aminoMsg, gasLimit, gasPriceQom) {
  const feeAmount = (BigInt(gasLimit) * BigInt(gasPriceQom) * 10n ** 18n).toString();
  const txData = {
    account_number: "999999", chain_id: "qom_766-1",
    fee: { amount: [{ amount: feeAmount, denom: "aqom" }], gas: String(gasLimit), feePayer: qom },
    memo: "", msgs: [aminoMsg], sequence: "0",
  };
  const types = buildTypes(aminoMsg);
  const digest = typedDataDigest(domain, types, txData);
  const rawSig = wallet.signingKey.sign(digest).serialized;
  const pub = recoverPubkeyBytes(digest, rawSig, eth); // throws if address mismatch
  const derived = computeAddress("0x" + Buffer.from(pub).toString("hex"));
  console.log(label, "| pubkey bytes:", pub.length, "| address from recovered pubkey == wallet:", derived.toLowerCase() === eth.toLowerCase());
}
check("MsgSend(register)", aminoSend(qom, BURN_QOM_ADDRESS, REGISTER_AMOUNT_AQOM), 150000, 22);
check("MsgDelegate", aminoDelegate(qom, "qomvaloper19u828cx84wdqrp085td3stcwlpqpecdeklvpv6", "1000000000000000000"), 400000, 22);
console.log("OK");
