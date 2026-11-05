import { JsonRpcProvider } from "ethers";
const provider = new JsonRpcProvider("https://evm-rpc-ql1.mschihuahua.org", 766);
// raw eth_call to 0x0800 validators() selector area: use delegation() selector call and a nonsense selector
for (const [name, data] of [
  ["getCode 0x0800", null],
]) {}
console.log("code @0x0800:", await provider.getCode("0x0000000000000000000000000000000000000800"));
console.log("code @0x0801:", await provider.getCode("0x0000000000000000000000000000000000000801"));
// compare: a known contract (WQOM) has code
console.log("code @WQOM:", (await provider.getCode("0xa26dfBF98Dd1A32FAe56A3D2B2D60A8a41b0bDF0")).slice(0, 20), "…");
