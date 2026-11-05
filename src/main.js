import { CHAIN_ID, KEPLR_CHAIN_INFO, GAS, GAS_PRICE, GAS_PRICE_STEPS, EXPLORER_TX } from "./chain.js";
import {
  fetchValidators, fetchMyState, fetchStakingParams, signAndSend,
  msgDelegate, msgUndelegate, msgRedelegate, msgWithdrawReward,
} from "./cosmos.js";

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
  if (qom >= 1e8) return (qom / 1e8).toLocaleString("ja-JP", { maximumFractionDigits: 2 }) + "億";
  if (qom >= 1e4) return (qom / 1e4).toLocaleString("ja-JP", { maximumFractionDigits: 2 }) + "万";
  return qom.toLocaleString("ja-JP");
}
function parseQomToAqom(input) {
  const s = String(input).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("金額の書き方が違います");
  const [w, f = ""] = s.split(".");
  if (f.length > 18) throw new Error("小数点以下は18桁までです");
  const v = BigInt(w) * E18 + BigInt(f.padEnd(18, "0") || "0");
  if (v <= 0n) throw new Error("0より大きい金額を入れてください");
  return v;
}
function fmtFee(gasLimit, price = gasPriceAqom) {
  const fee = BigInt(gasLimit) * BigInt(price);
  return fmtQom(fee.toString(), 6) + " QOM";
}

// Gas price (aqom per gas) is adjustable in the UI and remembered.
let gasPriceAqom = GAS_PRICE;
try {
  const saved = localStorage.getItem("qom-staking-gas-price");
  if (saved && /^\d+$/.test(saved) && BigInt(saved) > 0n) gasPriceAqom = BigInt(saved);
} catch { /* storage unavailable */ }

function feeEditorHtml(gasLimit) {
  return `
    <div class="kv"><span>手数料（ガス代）</span><b id="feeTotal">${fmtFee(gasLimit)}</b></div>
    <div class="chips" id="feeChips">
      <button data-price="${GAS_PRICE_STEPS.low}">安い</button>
      <button data-price="${GAS_PRICE_STEPS.average}">ふつう</button>
      <button data-price="${GAS_PRICE_STEPS.high}">高い</button>
    </div>
    <label>ガス単価（aqom / ガス1単位）— 自由に変えられます</label>
    <input class="amount" id="gasPriceInput" inputmode="numeric" value="${gasPriceAqom.toString()}" />
    <p class="note">単価を上げると手数料が高くなります（通りやすさは変わりますが、QL1 は通常「ふつう」で十分です）。合計は Keplr の確認画面でも表示されます。</p>`;
}
function bindFeeEditor(gasLimit) {
  const input = $("gasPriceInput");
  const update = () => {
    const s = input.value.trim();
    if (/^\d+$/.test(s) && BigInt(s) > 0n) {
      gasPriceAqom = BigInt(s);
      try { localStorage.setItem("qom-staking-gas-price", s); } catch {}
      $("feeTotal").textContent = fmtFee(gasLimit);
    } else {
      $("feeTotal").textContent = "—";
    }
  };
  input.addEventListener("input", update);
  document.querySelectorAll("#feeChips [data-price]").forEach((b) =>
    b.addEventListener("click", () => { input.value = b.dataset.price; update(); }));
}
function readGasPrice() {
  const s = $("gasPriceInput")?.value.trim() ?? gasPriceAqom.toString();
  if (!/^\d+$/.test(s) || BigInt(s) <= 0n) throw new Error("ガス単価は1以上の整数（aqom）で入れてください");
  return BigInt(s);
}
function commissionPct(rateDec) {
  const pct = Number(BigInt(rateDec || "0")) / 1e16;
  return (Math.round(pct * 100) / 100).toString() + "%";
}

// ---- state ------------------------------------------------------------------
let myAddress = null;
let myPubKey = null;
let myProvider = null; // active Keplr-protocol provider (Keplr / FoxWallet)
let myWalletName = "";
let validators = [];
let valByAddr = new Map();
let myState = null;
let unbondDays = 21;

const STATUS_LABEL = {
  BOND_STATUS_BONDED: ["稼働中", "on"],
  BOND_STATUS_UNBONDING: ["終了手続き中", "warn"],
  BOND_STATUS_UNBONDED: ["停止中", ""],
};
function valName(addr) {
  const v = valByAddr.get(addr);
  return v ? v.description.moniker || "(名前なし)" : addr;
}

// ---- wallets (Keplr-protocol providers: Keplr / FoxWallet) ------------------
function detectProviders() {
  const out = [];
  if (window.keplr) out.push({ kind: "keplr", label: "Keplr", provider: window.keplr });
  const fox = window.foxwallet?.cosmos ?? window.foxwallet?.keplr;
  if (fox && fox !== window.keplr) out.push({ kind: "fox", label: "FoxWallet", provider: fox });
  return out;
}

async function connect(entry, btn) {
  const provider = entry.provider;
  btn.disabled = true; btn.textContent = "接続中…";
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
        throw new Error("チェーン追加でエラー: " + (e?.message ?? e));
      }
    }
    if (provider.enable) await provider.enable(CHAIN_ID);
    const key = await provider.getKey(CHAIN_ID);
    myProvider = provider;
    myWalletName = entry.label;
    myAddress = key.bech32Address;
    myPubKey = key.pubKey;
    $("accountBox").innerHTML =
      `<div class="addr">接続中 (${esc(entry.label)}): ${esc(myAddress)}</div>`;
    $("myPanel").classList.remove("hidden");
    await reloadAll();
  } catch (e) {
    btn.disabled = false; btn.textContent = entry.label + " で接続";
    alert(entry.label + " で接続できませんでした: " + (e?.message ?? e) +
      (entry.kind === "fox"
        ? "\nFoxWallet 側で QL1 (qom_766-1) が有効になっていない可能性があります。FoxWallet アプリ内のブラウザで開いているか確認してください。"
        : ""));
  }
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
    b.textContent = entry.label + " で接続";
    b.addEventListener("click", () => connect(entry, b));
    box.appendChild(b);
  }
}

async function reloadAll() {
  setStatus("myStatus", "読み込み中…");
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
    setStatus("myStatus", "読み取りに失敗しました: " + (e?.message ?? e), true);
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
    box.innerHTML = `<p class="note">まだ委任していません。下の一覧からバリデーターを選んでください。</p>`;
  } else {
    box.innerHTML = s.delegations.map((d) => `
      <div class="deleg">
        <div class="head">
          <b>${esc(valName(d.validatorAddress))}</b>
          <span>${fmtQom(d.balanceAqom)} QOM 委任中 ／ 報酬 ${fmtDecQom(d.rewardAqom)} QOM</span>
        </div>
        <div class="row">
          <button data-act="more" data-val="${esc(d.validatorAddress)}">増やす</button>
          <button data-act="undelegate" data-val="${esc(d.validatorAddress)}">解除する</button>
          <button data-act="redelegate" data-val="${esc(d.validatorAddress)}">別のところへ移す</button>
          <button data-act="withdraw" data-val="${esc(d.validatorAddress)}" ${decToAqom(d.rewardAqom) > 0n ? "" : "disabled"}>報酬を受け取る</button>
        </div>
      </div>`).join("");
  }
  const ub = $("myUnbonding");
  if (s.unbonding.length) {
    ub.innerHTML = `<h3 style="margin:14px 0 6px;font-size:15px;">解除手続き中（${unbondDays}日たつと戻ります）</h3>` +
      s.unbonding.map((u) => `
        <div class="kv"><span>${esc(valName(u.validatorAddress))}</span>
        <b>${fmtQom(u.balanceAqom)} QOM ／ ${esc(new Date(u.completionTime).toLocaleString("ja-JP"))} に完了</b></div>`).join("");
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
      <tr><th>名前</th><th>状態</th><th>手数料</th><th>預かっている合計</th><th></th></tr>
      ${sorted.map((v) => {
        const [label, cls] = STATUS_LABEL[v.status] ?? [v.status, ""];
        const mine = myByVal.get(v.operatorAddress);
        return `<tr>
          <td><b>${esc(v.description.moniker || "(名前なし)")}</b>${v.jailed ? '<span class="badge warn">ペナルティ中</span>' : ""}${mine ? `<div class="mine">あなた: ${fmtQom(mine.balanceAqom)} QOM</div>` : ""}</td>
          <td><span class="badge ${cls}">${label}</span></td>
          <td>${commissionPct(v.commission.commissionRates.rate)}</td>
          <td>${fmtCompactQom(v.tokens)} QOM</td>
          <td>${v.status === "BOND_STATUS_BONDED" && !v.jailed
            ? `<button data-act="delegate" data-val="${esc(v.operatorAddress)}" ${myAddress ? "" : "disabled"}>委任する</button>` : ""}</td>
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
  $("modalCancel").textContent = "やめる";
  setStatus("modalStatus", "");
  modalSubmit = onSubmit;
  $("modalBack").classList.remove("hidden");
}
function closeModal() { $("modalBack").classList.add("hidden"); modalSubmit = null; }

function amountField(maxAqom, hintId) {
  return `
    <label>金額 (QOM)</label>
    <input class="amount" id="amtInput" inputmode="decimal" placeholder="0.0" />
    <div class="chips">
      ${[25, 50, 75].map((p) => `<button data-pct="${p}">${p}%</button>`).join("")}
      <button data-pct="100">MAX</button>
    </div>
    <div class="kv"><span>指定できる上限</span><b>${fmtQom(maxAqom.toString())} QOM</b></div>
    <div id="${hintId}"></div>`;
}
function bindChips(maxAqom) {
  document.querySelectorAll(".chips [data-pct]").forEach((b) =>
    b.addEventListener("click", () => {
      const pct = BigInt(b.dataset.pct);
      const v = (maxAqom * pct) / 100n;
      const whole = v / E18;
      const frac = (v % E18).toString().padStart(18, "0").replace(/0+$/, "");
      $("amtInput").value = whole.toString() + (frac ? "." + frac : "");
    }));
}
function readAmount(maxAqom) {
  const v = parseQomToAqom($("amtInput").value);
  if (v > maxAqom) throw new Error("上限を超えています");
  return v;
}

function openDelegate(validatorAddr) {
  const v = valByAddr.get(validatorAddr);
  const feeReserve = 10n ** 16n; // keep 0.01 QOM aside for the fee
  const avail = BigInt(myState.availableAqom);
  const max = avail > feeReserve ? avail - feeReserve : 0n;
  openModal("委任する", `
    <div class="kv"><span>委任先</span><b>${esc(v.description.moniker || "")}</b></div>
    <div class="kv"><span>手数料率</span><b>${commissionPct(v.commission.commissionRates.rate)}</b></div>
    ${amountField(max, "h")}
    ${feeEditorHtml(GAS.delegate)}
    <p class="note">預けた QOM は、解除しても ${unbondDays} 日たたないと戻りません。</p>
  `, "ウォレットで確認する", async () => {
    const amt = readAmount(max);
    return signAndSend(myProvider, myAddress, myPubKey, [msgDelegate(myAddress, validatorAddr, amt.toString())], GAS.delegate, readGasPrice());
  });
  bindChips(max);
  bindFeeEditor(GAS.delegate);
}

function openUndelegate(validatorAddr) {
  const d = myState.delegations.find((x) => x.validatorAddress === validatorAddr);
  const max = BigInt(d.balanceAqom);
  openModal("委任を解除する", `
    <div class="kv"><span>解除元</span><b>${esc(valName(validatorAddr))}</b></div>
    ${amountField(max, "h")}
    ${feeEditorHtml(GAS.undelegate)}
    <p class="note">解除した分は ${unbondDays} 日後に「使える QOM」に戻ります。その間、報酬は付きません。たまっている報酬は別に受け取れます。</p>
  `, "ウォレットで確認する", async () => {
    const amt = readAmount(max);
    return signAndSend(myProvider, myAddress, myPubKey, [msgUndelegate(myAddress, validatorAddr, amt.toString())], GAS.undelegate, readGasPrice());
  });
  bindChips(max);
  bindFeeEditor(GAS.undelegate);
}

function openRedelegate(srcAddr) {
  const d = myState.delegations.find((x) => x.validatorAddress === srcAddr);
  const max = BigInt(d.balanceAqom);
  const targets = validators.filter((v) =>
    v.status === "BOND_STATUS_BONDED" && !v.jailed && v.operatorAddress !== srcAddr);
  openModal("別のバリデーターへ移す", `
    <div class="kv"><span>移動元</span><b>${esc(valName(srcAddr))}</b></div>
    <label>移動先</label>
    <select class="target" id="dstSelect">
      ${targets.map((v) => `<option value="${esc(v.operatorAddress)}">${esc(v.description.moniker || "(名前なし)")}（手数料 ${commissionPct(v.commission.commissionRates.rate)}）</option>`).join("")}
    </select>
    ${amountField(max, "h")}
    ${feeEditorHtml(GAS.redelegate)}
    <p class="note">移すのは即時です（${unbondDays}日待ちなし）。ただし移した分は ${unbondDays} 日間、さらに別の所へは移せません。</p>
  `, "ウォレットで確認する", async () => {
    const amt = readAmount(max);
    const dst = $("dstSelect").value;
    return signAndSend(myProvider, myAddress, myPubKey, [msgRedelegate(myAddress, srcAddr, dst, amt.toString())], GAS.redelegate, readGasPrice());
  });
  bindChips(max);
  bindFeeEditor(GAS.redelegate);
}

async function doWithdraw(addrs) {
  if (!addrs.length) return;
  const gas = GAS.withdrawBase + GAS.withdrawPerValidator * BigInt(addrs.length);
  openModal("報酬を受け取る", `
    <p>${addrs.length} 件の委任先から、たまった報酬を受け取ります。</p>
    ${feeEditorHtml(gas)}
  `, "ウォレットで確認する", async () =>
    signAndSend(myProvider, myAddress, myPubKey, addrs.map((a) => msgWithdrawReward(myAddress, a)), gas, readGasPrice()));
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
  setStatus("modalStatus", "ウォレットで承認してください…");
  try {
    const res = await modalSubmit();
    setStatus("modalStatus", "");
    $("modalBody").innerHTML = `
      <p>できました。</p>
      <p class="addr">取引: <a href="${EXPLORER_TX}${esc(res.hash)}" target="_blank" rel="noreferrer">${esc(res.hash)}</a></p>`;
    ok.classList.add("hidden");
    $("modalCancel").textContent = "閉じる";
    await reloadAll();
  } catch (e) {
    const msg = String(e?.message ?? e);
    setStatus("modalStatus", msg.includes("rejected") || msg.includes("denied")
      ? "ウォレットでキャンセルされました" : "失敗しました: " + msg, true);
  } finally {
    ok.disabled = false;
  }
});
window.addEventListener("load", () => {
  renderConnectButtons();
  // Validator list is public data: show it even before connecting.
  reloadAll().catch(() => {});
  window.addEventListener("keplr_keystorechange", () => location.reload());
});
