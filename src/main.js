import { CHAIN_ID, KEPLR_CHAIN_INFO, GAS, GAS_PRICE, GAS_PRICE_STEPS, MIN_GAS_PRICE, EXPLORER_TX } from "./chain.js";
import {
  fetchValidators, fetchMyState, fetchStakingParams, signAndSend,
  msgDelegate, msgUndelegate, msgRedelegate, msgWithdrawReward,
} from "./cosmos.js";
import {
  signAndSendEvm, qomAddressFromEth,
  aminoDelegate, aminoUndelegate, aminoRedelegate, aminoWithdrawReward,
} from "./eip712.js";
import { t, LANG, LOCALE } from "./i18n.js";

// Language selector (header, top right): persist the choice for the
// gate page and jump to the matching page, like the DEX aggregator.
function initLangSelector() {
  const sel = document.getElementById("langSel");
  if (!sel) return;
  sel.value = LANG;
  sel.addEventListener("change", () => {
    const v = sel.value === "ja" ? "ja" : "en";
    try { localStorage.setItem("qomstaking_lang", v); } catch { /* ignore */ }
    location.href = v === "ja" ? "ja.html" : "en.html";
  });
}

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));

// ---- number formatting (all amounts are aqom integer strings) -------------
const E18 = 10n ** 18n;
function fmtQom(aqom, maxDp = 4) {
  let v = BigInt(aqom || "0");
  const neg = v < 0n; if (neg) v = -v;
  const whole = v / E18;
  const frac = (v % E18).toString().padStart(18, "0").slice(0, maxDp).replace(/0+$/, "");
  return (neg ? "-" : "") + whole.toLocaleString("en-US") + (frac ? "." + frac : "");
}
// Distribution rewards come back as cosmos Dec strings (value x 10^18, in aqom).
function fmtDecQom(rawDec, maxDp = 4) {
  if (!rawDec) return "0";
  return fmtQom((BigInt(rawDec) / E18).toString(), maxDp);
}
function decToAqom(rawDec) { return rawDec ? BigInt(rawDec) / E18 : 0n; }
function fmtCompactQom(aqom) {
  const qom = Number(BigInt(aqom || "0") / E18);
  if (LANG === "ja") {
    if (qom >= 1e8) return (qom / 1e8).toLocaleString("ja-JP", { maximumFractionDigits: 2 }) + "億";
    if (qom >= 1e4) return (qom / 1e4).toLocaleString("ja-JP", { maximumFractionDigits: 2 }) + "万";
    return qom.toLocaleString("ja-JP");
  }
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(qom);
}
function parseQomToAqom(input) {
  const s = String(input).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(t("errAmountFormat"));
  const [w, f = ""] = s.split(".");
  if (f.length > 18) throw new Error(t("errAmountDecimals"));
  const v = BigInt(w) * E18 + BigInt(f.padEnd(18, "0") || "0");
  if (v <= 0n) throw new Error(t("errAmountPositive"));
  return v;
}
function fmtFee(gasLimit, price = gasPriceAqom) {
  const fee = BigInt(gasLimit) * BigInt(price);
  return fmtQom(fee.toString(), 6) + " QOM";
}

// Gas price is adjustable in the UI, denominated in QOM per gas.
// QL1's floor is 18 QOM/gas (measured on-chain); below it txs are rejected.
let gasPriceAqom = GAS_PRICE;
try {
  const saved = localStorage.getItem("qom-staking-gas-price-v2");
  if (saved && /^\d+$/.test(saved) && BigInt(saved) >= MIN_GAS_PRICE) gasPriceAqom = BigInt(saved);
} catch { /* storage unavailable */ }

function priceQomLabel(aqom) { return fmtQom(aqom.toString(), 18); }

function feeEditorHtml(gasLimit) {
  const step = (v) => (v / E18).toString();
  return `
    <div class="kv"><span>${t("feeLabel")}</span><b id="feeTotal">${fmtFee(gasLimit)}</b></div>
    <div class="chips" id="feeChips">
      <button data-priceqom="${step(GAS_PRICE_STEPS.low)}">${t("feeLow")} ${step(GAS_PRICE_STEPS.low)}</button>
      <button data-priceqom="${step(GAS_PRICE_STEPS.average)}">${t("feeAverage")} ${step(GAS_PRICE_STEPS.average)}</button>
      <button data-priceqom="${step(GAS_PRICE_STEPS.high)}">${t("feeHigh")} ${step(GAS_PRICE_STEPS.high)}</button>
    </div>
    <label>${t("gasPriceLabel")}</label>
    <input class="amount" id="gasPriceInput" inputmode="decimal" value="${priceQomLabel(gasPriceAqom)}" />
    <p class="note">${t("gasPriceNote")}</p>`;
}
function bindFeeEditor(gasLimit, onChange) {
  const input = $("gasPriceInput");
  const update = () => {
    try {
      gasPriceAqom = parseQomToAqom(input.value);
      try { localStorage.setItem("qom-staking-gas-price-v2", gasPriceAqom.toString()); } catch {}
      $("feeTotal").textContent = fmtFee(gasLimit);
    } catch {
      $("feeTotal").textContent = "—";
    }
    if (onChange) onChange();
  };
  input.addEventListener("input", update);
  document.querySelectorAll("#feeChips [data-priceqom]").forEach((b) =>
    b.addEventListener("click", () => { input.value = b.dataset.priceqom; update(); }));
}
function readGasPrice() {
  let v;
  try { v = parseQomToAqom($("gasPriceInput")?.value ?? ""); }
  catch { throw new Error(t("errGasFormat")); }
  if (v < MIN_GAS_PRICE) throw new Error(t("errGasBelowFloor"));
  return v;
}
function commissionPct(rateDec) {
  const pct = Number(BigInt(rateDec || "0")) / 1e16;
  return (Math.round(pct * 100) / 100).toString() + "%";
}

// ---- state ------------------------------------------------------------------
let myAddress = null;
let myPubKey = null;
let myProvider = null; // active Keplr-protocol provider (Keplr / FoxWallet)
let signerKind = "cosmos"; // "cosmos" (Keplr/FoxWallet) or "evm" (MetaMask, EIP-712)
let myEthAddress = null;
let myWalletName = "";
let validators = [];
let valByAddr = new Map();
let myState = null;
let unbondDays = 21;

const STATUS_LABEL = {
  BOND_STATUS_BONDED: [t("statusBonded"), "on"],
  BOND_STATUS_UNBONDING: [t("statusUnbonding"), "warn"],
  BOND_STATUS_UNBONDED: [t("statusUnbonded"), ""],
};
function valName(addr) {
  const v = valByAddr.get(addr);
  return v ? v.description.moniker || t("noName") : addr;
}

// ---- wallets (Keplr-protocol providers: Keplr / FoxWallet) ------------------
function detectProviders() {
  const out = [];
  if (window.keplr) out.push({ kind: "keplr", label: "Keplr", provider: window.keplr });
  const fox = window.foxwallet?.cosmos ?? window.foxwallet?.keplr;
  if (fox && fox !== window.keplr) out.push({ kind: "fox", label: "FoxWallet", provider: fox });
  if (window.ethereum) out.push({ kind: "evm", label: t("evmLabel"), provider: window.ethereum });
  return out;
}

async function connect(entry, btn) {
  if (entry.kind === "evm") return connectEvm(entry, btn);
  const provider = entry.provider;
  btn.disabled = true; btn.textContent = t("connecting");
  try {
    // Keplr supports both calls; FoxWallet's Cosmos provider implements
    // the same protocol but may not expose suggest/enable — call only
    // what exists. Suggest errors are NOT swallowed: when the chain is
    // refused, the wallet's own message is the only way to know why.
    if (provider.enable) {
      try { await provider.enable(CHAIN_ID); } catch { /* not added yet */ }
    }
    if (!myAddress && provider.experimentalSuggestChain) {
      try {
        await provider.experimentalSuggestChain(KEPLR_CHAIN_INFO);
      } catch (e) {
        throw new Error(t("chainSuggestError") + (e?.message ?? e));
      }
    }
    if (provider.enable) await provider.enable(CHAIN_ID);
    const key = await provider.getKey(CHAIN_ID);
    signerKind = "cosmos";
    myProvider = provider;
    myWalletName = entry.label;
    myAddress = key.bech32Address;
    myPubKey = key.pubKey;
    $("accountBox").innerHTML =
      `<div class="addr">${t("connectedAs", entry.label)}${esc(myAddress)}</div>`;
    $("myPanel").classList.remove("hidden");
    await reloadAll();
  } catch (e) {
    btn.disabled = false; btn.textContent = t("connectWith", entry.label);
    alert(t("connectFailed", entry.label) + (e?.message ?? e) +
      (entry.kind === "fox" ? t("foxHint") : ""));
  }
}

async function connectEvm(entry, btn) {
  const eth = window.ethereum;
  btn.disabled = true; btn.textContent = t("connecting");
  try {
    const accounts = await eth.request({ method: "eth_requestAccounts" });
    if (!accounts?.length) throw new Error(t("evmNoAccount"));
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2FE" }] });
    } catch (e) {
      if (e?.code === 4902) {
        await eth.request({ method: "wallet_addEthereumChain", params: [{
          chainId: "0x2FE", chainName: "QL1 (QOM)",
          nativeCurrency: { name: "QOM", symbol: "QOM", decimals: 18 },
          rpcUrls: ["https://evm-rpc-ql1.mschihuahua.org"],
          blockExplorerUrls: ["https://scan.qom.network"],
        }] });
      }
    }
    signerKind = "evm";
    myEthAddress = accounts[0];
    myAddress = qomAddressFromEth(myEthAddress);
    myWalletName = entry.label;
    myProvider = null;
    myPubKey = null;
    $("accountBox").innerHTML =
      `<div class="addr">${t("connectedAs", entry.label)}${esc(myAddress)}</div>`;
    $("myPanel").classList.remove("hidden");
    await reloadAll();
  } catch (e) {
    btn.disabled = false; btn.textContent = t("connectWith", entry.label);
    alert(t("connectFailed", entry.label) + (e?.message ?? e) + t("evmHint"));
  }
}

// Unified send: Cosmos wallets sign via signDirect; EVM wallets sign the
// same transaction through EIP-712 (MetaMask). pairs: [{proto, amino}]
async function dispatchTx(pairs, gasLimit, gasPrice) {
  if (signerKind === "evm") {
    return signAndSendEvm(window.ethereum, myEthAddress, myAddress, pairs, gasLimit, gasPrice);
  }
  return signAndSend(myProvider, myAddress, myPubKey, pairs.map((p) => p.proto), gasLimit, gasPrice);
}

function renderConnectButtons() {
  const found = detectProviders();
  const box = $("accountBox");
  if (!found.length) {
    box.innerHTML = "";
    $("keplrMissing").classList.remove("hidden");
    return;
  }
  $("keplrMissing").classList.add("hidden");
  box.innerHTML = "";
  for (const entry of found) {
    const b = document.createElement("button");
    b.className = "primary";
    b.textContent = t("connectWith", entry.label);
    b.addEventListener("click", () => connect(entry, b));
    box.appendChild(b);
  }
}

async function reloadAll() {
  setStatus("myStatus", t("loading"));
  try {
    const [vals, params] = await Promise.all([fetchValidators(), fetchStakingParams()]);
    validators = vals;
    valByAddr = new Map(vals.map((v) => [v.operatorAddress, v]));
    if (params?.unbondingTime?.seconds) {
      unbondDays = Math.round(Number(params.unbondingTime.seconds) / 86400);
      $("unbondDays").textContent = String(unbondDays);
    }
    renderValidators();
    if (myAddress) {
      myState = await fetchMyState(myAddress);
      renderMine();
    }
    setStatus("myStatus", "");
  } catch (e) {
    setStatus("myStatus", t("readFailed") + (e?.message ?? e), true);
  }
}

function setStatus(id, msg, isErr = false) {
  const el = $(id);
  el.textContent = msg;
  el.classList.toggle("err", isErr);
}

// ---- rendering ---------------------------------------------------------------
function renderMine() {
  const s = myState;
  const totalDelegated = s.delegations.reduce((a, d) => a + BigInt(d.balanceAqom), 0n);
  const totalRewardAqom = s.delegations.reduce((a, d) => a + decToAqom(d.rewardAqom), 0n);
  $("stAvailable").textContent = fmtQom(s.availableAqom) + " QOM";
  $("stDelegated").textContent = fmtQom(totalDelegated.toString()) + " QOM";
  $("stRewards").textContent = fmtQom(totalRewardAqom.toString()) + " QOM";
  $("claimAllBtn").disabled = !s.delegations.some((d) => decToAqom(d.rewardAqom) > 0n);

  const box = $("myDelegations");
  if (!s.delegations.length) {
    box.innerHTML = `<p class="note">${t("noDelegations")}</p>`;
  } else {
    box.innerHTML = s.delegations.map((d) => `
      <div class="deleg">
        <div class="head">
          <b>${esc(valName(d.validatorAddress))}</b>
          <span>${t("delegatedLine", fmtQom(d.balanceAqom), fmtDecQom(d.rewardAqom))}</span>
        </div>
        <div class="row">
          <button data-act="more" data-val="${esc(d.validatorAddress)}">${t("actMore")}</button>
          <button data-act="undelegate" data-val="${esc(d.validatorAddress)}">${t("actUndelegate")}</button>
          <button data-act="redelegate" data-val="${esc(d.validatorAddress)}">${t("actRedelegate")}</button>
          <button data-act="withdraw" data-val="${esc(d.validatorAddress)}" ${decToAqom(d.rewardAqom) > 0n ? "" : "disabled"}>${t("actWithdraw")}</button>
        </div>
      </div>`).join("");
  }
  const ub = $("myUnbonding");
  if (s.unbonding.length) {
    ub.innerHTML = `<h3 style="margin:14px 0 6px;font-size:15px;">${t("unbondingTitle", unbondDays)}</h3>` +
      s.unbonding.map((u) => `
        <div class="kv"><span>${esc(valName(u.validatorAddress))}</span>
        <b>${fmtQom(u.balanceAqom)} QOM${LANG === "ja" ? " ／ " : " · "}${esc(t("unbondingCompletes", new Date(u.completionTime).toLocaleString(LOCALE)))}</b></div>`).join("");
  } else ub.innerHTML = "";
  bindDelegationButtons();
  renderValidators(); // refresh "my delegation" badges
}

function renderValidators() {
  const myByVal = new Map((myState?.delegations ?? []).map((d) => [d.validatorAddress, d]));
  const sorted = [...validators].sort((a, b) => {
    const rank = (v) => (v.status === "BOND_STATUS_BONDED" ? 0 : v.status === "BOND_STATUS_UNBONDING" ? 1 : 2);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return (BigInt(b.tokens) > BigInt(a.tokens)) ? 1 : -1;
  });
  $("validatorList").innerHTML = `
    <table>
      <tr><th>${t("thName")}</th><th>${t("thStatus")}</th><th>${t("thCommission")}</th><th>${t("thTotalStaked")}</th><th></th></tr>
      ${sorted.map((v) => {
        const [label, cls] = STATUS_LABEL[v.status] ?? [v.status, ""];
        const mine = myByVal.get(v.operatorAddress);
        return `<tr>
          <td><b>${esc(v.description.moniker || t("noName"))}</b>${v.jailed ? '<span class="badge warn">' + t("jailedBadge") + '</span>' : ""}${mine ? `<div class="mine">${t("youLabel")}${fmtQom(mine.balanceAqom)} QOM</div>` : ""}</td>
          <td><span class="badge ${cls}">${label}</span></td>
          <td>${commissionPct(v.commission.commissionRates.rate)}</td>
          <td>${fmtCompactQom(v.tokens)} QOM</td>
          <td>${v.status === "BOND_STATUS_BONDED" && !v.jailed
            ? `<button data-act="delegate" data-val="${esc(v.operatorAddress)}" ${myAddress ? "" : "disabled"}>${t("delegateBtn")}</button>` : ""}</td>
        </tr>`;
      }).join("")}
    </table>`;
  document.querySelectorAll('[data-act="delegate"]').forEach((b) =>
    b.addEventListener("click", () => openDelegate(b.dataset.val)));
}

function bindDelegationButtons() {
  document.querySelectorAll("#myDelegations [data-act]").forEach((b) => {
    b.addEventListener("click", () => {
      const val = b.dataset.val;
      if (b.dataset.act === "more") openDelegate(val);
      else if (b.dataset.act === "undelegate") openUndelegate(val);
      else if (b.dataset.act === "redelegate") openRedelegate(val);
      else if (b.dataset.act === "withdraw") doWithdraw([val]);
    });
  });
}

// ---- modal -------------------------------------------------------------------
let modalSubmit = null;
function openModal(title, bodyHtml, okLabel, onSubmit) {
  $("modalTitle").textContent = title;
  $("modalBody").innerHTML = bodyHtml;
  $("modalOk").textContent = okLabel;
  $("modalOk").classList.remove("hidden");
  $("modalOk").disabled = false;
  $("modalCancel").textContent = t("cancel");
  setStatus("modalStatus", "");
  modalSubmit = onSubmit;
  $("modalBack").classList.remove("hidden");
}
function closeModal() { $("modalBack").classList.add("hidden"); modalSubmit = null; }

function amountField(maxAqom, hintId) {
  return `
    <label>${t("amountLabel")}</label>
    <input class="amount" id="amtInput" inputmode="decimal" placeholder="0.0" />
    <div class="chips">
      ${[25, 50, 75].map((p) => `<button data-pct="${p}">${p}%</button>`).join("")}
      <button data-pct="100">MAX</button>
    </div>
    <div class="kv"><span>${t("maxLabel")}</span><b id="maxValue">${fmtQom(maxAqom.toString())} QOM</b></div>
    <div id="${hintId}"></div>`;
}
function bindChips(maxAqom) {
  const getMax = () => (typeof maxAqom === "function" ? maxAqom() : maxAqom);
  document.querySelectorAll(".chips [data-pct]").forEach((b) =>
    b.addEventListener("click", () => {
      const pct = BigInt(b.dataset.pct);
      const v = (getMax() * pct) / 100n;
      const whole = v / E18;
      const frac = (v % E18).toString().padStart(18, "0").replace(/0+$/, "");
      $("amtInput").value = whole.toString() + (frac ? "." + frac : "");
    }));
}
function readAmount(maxAqom) {
  const max = typeof maxAqom === "function" ? maxAqom() : maxAqom;
  const v = parseQomToAqom($("amtInput").value);
  if (v > max) throw new Error(t("errOverMax"));
  return v;
}

function openDelegate(validatorAddr) {
  const v = valByAddr.get(validatorAddr);
  const avail = BigInt(myState.availableAqom);
  const buffer = 10n ** 18n; // keep 1 QOM aside on top of the fee
  const computeMax = (price) => {
    const fee = GAS.delegate * price;
    return avail > fee + buffer ? avail - fee - buffer : 0n;
  };
  let max = computeMax(gasPriceAqom);
  openModal(t("titleDelegate"), `
    <div class="kv"><span>${t("kvDelegateTo")}</span><b>${esc(v.description.moniker || "")}</b></div>
    <div class="kv"><span>${t("kvCommission")}</span><b>${commissionPct(v.commission.commissionRates.rate)}</b></div>
    ${amountField(max, "h")}
    ${feeEditorHtml(GAS.delegate)}
    <p class="note">${t("delegateNote", unbondDays)}</p>
  `, t("confirmInWallet"), async () => {
    const price = readGasPrice();
    const amt = readAmount(computeMax(price));
    return dispatchTx([{ proto: msgDelegate(myAddress, validatorAddr, amt.toString()), amino: aminoDelegate(myAddress, validatorAddr, amt.toString()) }], GAS.delegate, price);
  });
  bindChips(() => max);
  bindFeeEditor(GAS.delegate, () => {
    max = computeMax(gasPriceAqom);
    const el = $("maxValue");
    if (el) el.textContent = fmtQom(max.toString()) + " QOM";
  });
}

function openUndelegate(validatorAddr) {
  const d = myState.delegations.find((x) => x.validatorAddress === validatorAddr);
  const max = BigInt(d.balanceAqom);
  openModal(t("titleUndelegate"), `
    <div class="kv"><span>${t("kvUndelegateFrom")}</span><b>${esc(valName(validatorAddr))}</b></div>
    ${amountField(max, "h")}
    ${feeEditorHtml(GAS.undelegate)}
    <p class="note">${t("undelegateNote", unbondDays)}</p>
  `, t("confirmInWallet"), async () => {
    const amt = readAmount(max);
    const price = readGasPrice();
    if (GAS.undelegate * price > BigInt(myState.availableAqom)) throw new Error(t("errFeeInsufficient"));
    return dispatchTx([{ proto: msgUndelegate(myAddress, validatorAddr, amt.toString()), amino: aminoUndelegate(myAddress, validatorAddr, amt.toString()) }], GAS.undelegate, price);
  });
  bindChips(max);
  bindFeeEditor(GAS.undelegate);
}

function openRedelegate(srcAddr) {
  const d = myState.delegations.find((x) => x.validatorAddress === srcAddr);
  const max = BigInt(d.balanceAqom);
  const targets = validators.filter((v) =>
    v.status === "BOND_STATUS_BONDED" && !v.jailed && v.operatorAddress !== srcAddr);
  openModal(t("titleRedelegate"), `
    <div class="kv"><span>${t("kvMoveFrom")}</span><b>${esc(valName(srcAddr))}</b></div>
    <label>${t("moveToLabel")}</label>
    <select class="target" id="dstSelect">
      ${targets.map((v) => `<option value="${esc(v.operatorAddress)}">${esc(v.description.moniker || t("noName"))}${t("optionCommission", commissionPct(v.commission.commissionRates.rate))}</option>`).join("")}
    </select>
    ${amountField(max, "h")}
    ${feeEditorHtml(GAS.redelegate)}
    <p class="note">${t("redelegateNote", unbondDays)}</p>
  `, t("confirmInWallet"), async () => {
    const amt = readAmount(max);
    const dst = $("dstSelect").value;
    const price = readGasPrice();
    if (GAS.redelegate * price > BigInt(myState.availableAqom)) throw new Error(t("errFeeInsufficient"));
    return dispatchTx([{ proto: msgRedelegate(myAddress, srcAddr, dst, amt.toString()), amino: aminoRedelegate(myAddress, srcAddr, dst, amt.toString()) }], GAS.redelegate, price);
  });
  bindChips(max);
  bindFeeEditor(GAS.redelegate);
}

async function doWithdraw(addrs) {
  if (!addrs.length) return;
  const gas = GAS.withdrawBase + GAS.withdrawPerValidator * BigInt(addrs.length);
  openModal(t("titleWithdraw"), `
    <p>${t("withdrawBody", addrs.length)}</p>
    ${feeEditorHtml(gas)}
  `, t("confirmInWallet"), async () =>
    dispatchTx(addrs.map((a) => ({ proto: msgWithdrawReward(myAddress, a), amino: aminoWithdrawReward(myAddress, a) })), gas, readGasPrice()));
  bindFeeEditor(gas);
}

// ---- wiring ------------------------------------------------------------------

$("reloadBtn").addEventListener("click", reloadAll);
$("claimAllBtn").addEventListener("click", () => {
  const addrs = myState.delegations.filter((d) => decToAqom(d.rewardAqom) > 0n).map((d) => d.validatorAddress);
  doWithdraw(addrs);
});
$("modalCancel").addEventListener("click", closeModal);
$("modalOk").addEventListener("click", async () => {
  if (!modalSubmit) return;
  const ok = $("modalOk");
  ok.disabled = true;
  setStatus("modalStatus", t("approveInWallet"));
  try {
    const res = await modalSubmit();
    setStatus("modalStatus", "");
    $("modalBody").innerHTML = `
      <p>${t("doneMsg")}</p>
      <p class="addr">${t("txLabel")}<a href="${EXPLORER_TX}${esc(res.hash)}" target="_blank" rel="noreferrer">${esc(res.hash)}</a></p>`;
    ok.classList.add("hidden");
    $("modalCancel").textContent = t("close");
    await reloadAll();
  } catch (e) {
    const msg = String(e?.message ?? e);
    setStatus("modalStatus", msg.includes("rejected") || msg.includes("denied")
      ? t("cancelledInWallet") : t("failedPrefix") + msg, true);
  } finally {
    ok.disabled = false;
  }
});
window.addEventListener("load", () => {
  initLangSelector();
  renderConnectButtons();
  // Validator list is public data: show it even before connecting.
  reloadAll().catch(() => {});
  window.addEventListener("keplr_keystorechange", () => location.reload());
});
