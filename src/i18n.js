// Language strings for the QOM staking site. The language is chosen by
// the page itself (<html lang="ja"> on ja.html, lang="en" on en.html);
// this module only picks the matching table. The gate page (index.html)
// and the header language selector persist the choice as
// localStorage "qomstaking_lang" (same scheme as the DEX aggregator).
export const LANG =
  typeof document !== "undefined" && document.documentElement?.lang === "ja"
    ? "ja"
    : "en";

const STRINGS = {
  ja: {
    // errors: amount / gas input
    errAmountFormat: "金額の書き方が違います",
    errAmountDecimals: "小数点以下は18桁までです",
    errAmountPositive: "0より大きい金額を入れてください",
    errGasFormat: "ガス単価の書き方が違います（例：18）",
    errGasBelowFloor: "ガス単価が最低ライン（18 QOM/ガス）未満だと、チェーンに弾かれます",
    errOverMax: "上限を超えています",
    errFeeInsufficient: "手数料分の QOM が足りません",
    // fee editor
    feeLabel: "手数料（ガス代）",
    feeLow: "最低",
    feeAverage: "ふつう",
    feeHigh: "高い",
    gasPriceLabel: "ガス単価（QOM / ガス1単位）— 自由に変えられます",
    gasPriceNote: "QL1 の最低単価は 18 QOM/ガスで、これより安いとチェーンに弾かれます。合計はウォレットの確認画面でも表示されます。",
    // connection
    connecting: "接続中…",
    connectWith: (label) => label + " で接続",
    connectedAs: (label) => `接続中 (${label}): `,
    connectFailed: (label) => label + " で接続できませんでした: ",
    evmHint: "\nMetaMask アプリ内のブラウザで開いているか確認してください。",
    evmNoAccount: "アカウントが取得できませんでした",
    // status / loading
    loading: "読み込み中…",
    readFailed: "読み取りに失敗しました: ",
    // validators
    statusBonded: "稼働中",
    statusUnbonding: "終了手続き中",
    statusUnbonded: "停止中",
    noName: "(名前なし)",
    jailedBadge: "ペナルティ中",
    youLabel: "あなた: ",
    thName: "名前",
    thStatus: "状態",
    thCommission: "手数料",
    thTotalStaked: "預かっている合計",
    delegateBtn: "ステーキングする",
    // my delegations
    noDelegations: "まだステーキングしていません。下の一覧からバリデーターを選んでください。",
    delegatedLine: (bal, rew) => `${bal} QOM ステーキング中 ／ 報酬 ${rew} QOM`,
    actMore: "増やす",
    actUndelegate: "解除する",
    actRedelegate: "別のところへ移す",
    actWithdraw: "報酬を受け取る",
    unbondingTitle: (days) => `解除手続き中（${days}日たつと戻ります）`,
    unbondingCompletes: (dateStr) => `${dateStr} に完了`,
    // modal chrome
    cancel: "やめる",
    close: "閉じる",
    confirmInWallet: "MetaMask で確認する",
    approveInWallet: "MetaMask で承認してください…",
    doneMsg: "できました。",
    txLabel: "取引: ",
    cancelledInWallet: "ウォレットでキャンセルされました",
    failedPrefix: "失敗しました: ",
    // amount field
    amountLabel: "金額 (QOM)",
    maxLabel: "指定できる上限",
    // delegate modal
    titleDelegate: "ステーキングする",
    kvDelegateTo: "ステーキング先",
    kvCommission: "手数料率",
    delegateNote: (days) => `預けた QOM は、解除しても ${days} 日たたないと戻りません。`,
    // undelegate modal
    titleUndelegate: "ステーキングを解除する",
    kvUndelegateFrom: "解除元",
    undelegateNote: (days) => `解除した分は ${days} 日後に「使える QOM」に戻ります。その間、報酬は付きません。たまっている報酬は別に受け取れます。`,
    // redelegate modal
    titleRedelegate: "別のバリデーターへ移す",
    kvMoveFrom: "移動元",
    moveToLabel: "移動先",
    optionCommission: (pct) => `（手数料 ${pct}）`,
    redelegateNote: (days) => `移すのは即時です（${days}日待ちなし）。ただし移した分は ${days} 日間、さらに別の所へは移せません。`,
    // withdraw modal
    titleWithdraw: "報酬を受け取る",
    withdrawBody: (n) => `${n} 件のステーキング先から、たまった報酬を受け取ります。`,
    // chain / signing errors (cosmos.js, eip712.js)
    accountNotFound: "アカウントが見つかりません",
    accountReadFailed: "アカウントの読み取りに失敗しました",
    chainFailed: (code, rawLog) => `チェーン側で失敗しました (code ${code}): ${rawLog}`,
    unsupportedTx: "対応していない取引です: ",
    recoveredMismatch: "署名から復元したアドレスが、接続中のウォレットと一致しませんでした",
    unexpectedSignature: "ウォレットから想定外の署名が返りました",
  },
  en: {
    errAmountFormat: "Invalid amount format",
    errAmountDecimals: "Up to 18 decimal places are allowed",
    errAmountPositive: "Enter an amount greater than 0",
    errGasFormat: "Invalid gas price format (e.g. 18)",
    errGasBelowFloor: "A gas price below the floor (18 QOM/gas) will be rejected by the chain",
    errOverMax: "Exceeds the maximum",
    errFeeInsufficient: "Not enough QOM to cover the fee",
    feeLabel: "Fee (gas)",
    feeLow: "Low",
    feeAverage: "Average",
    feeHigh: "High",
    gasPriceLabel: "Gas price (QOM per gas unit) — you can change it freely",
    gasPriceNote: "QL1's minimum price is 18 QOM/gas; anything lower is rejected by the chain. The total is also shown on the wallet's confirmation screen.",
    connecting: "Connecting…",
    connectWith: (label) => "Connect with " + label,
    connectedAs: (label) => `Connected (${label}): `,
    connectFailed: (label) => "Could not connect with " + label + ": ",
    evmHint: "\nPlease check that you opened this page in the MetaMask app's built-in browser.",
    evmNoAccount: "Could not get an account",
    loading: "Loading…",
    readFailed: "Failed to load: ",
    statusBonded: "Active",
    statusUnbonding: "Unbonding",
    statusUnbonded: "Inactive",
    noName: "(no name)",
    jailedBadge: "Jailed",
    youLabel: "You: ",
    thName: "Name",
    thStatus: "Status",
    thCommission: "Commission",
    thTotalStaked: "Total staked",
    delegateBtn: "Stake",
    noDelegations: "You haven't staked yet. Choose a validator from the list below.",
    delegatedLine: (bal, rew) => `${bal} QOM staked · Rewards ${rew} QOM`,
    actMore: "Add more",
    actUndelegate: "Unstake",
    actRedelegate: "Move to another",
    actWithdraw: "Claim rewards",
    unbondingTitle: (days) => `Unbonding (returns after ${days} days)`,
    unbondingCompletes: (dateStr) => `completes ${dateStr}`,
    cancel: "Cancel",
    close: "Close",
    confirmInWallet: "Confirm in MetaMask",
    approveInWallet: "Please approve in MetaMask…",
    doneMsg: "Done.",
    txLabel: "Transaction: ",
    cancelledInWallet: "Cancelled in the wallet",
    failedPrefix: "Failed: ",
    amountLabel: "Amount (QOM)",
    maxLabel: "Maximum you can specify",
    titleDelegate: "Stake",
    kvDelegateTo: "Stake with",
    kvCommission: "Commission rate",
    delegateNote: (days) => `Staked QOM cannot be withdrawn until ${days} days after you unstake.`,
    titleUndelegate: "Unstake",
    kvUndelegateFrom: "Unstake from",
    undelegateNote: (days) => `The unstaked amount returns to your available QOM after ${days} days. No rewards accrue during that time. Accumulated rewards can be claimed separately.`,
    titleRedelegate: "Move to another validator",
    kvMoveFrom: "Move from",
    moveToLabel: "Move to",
    optionCommission: (pct) => ` (commission ${pct})`,
    redelegateNote: (days) => `Moving is immediate (no ${days}-day wait). However, the moved amount cannot be moved again for ${days} days.`,
    titleWithdraw: "Claim rewards",
    withdrawBody: (n) => `Claim the accumulated rewards from your ${n} staking position(s).`,
    accountNotFound: "Account not found",
    accountReadFailed: "Failed to read the account",
    chainFailed: (code, rawLog) => `The chain rejected the transaction (code ${code}): ${rawLog}`,
    unsupportedTx: "Unsupported transaction: ",
    recoveredMismatch: "The address recovered from the signature does not match the connected wallet",
    unexpectedSignature: "The wallet returned an unexpected signature",
  },
};

export function t(key, ...args) {
  const v = STRINGS[LANG][key] ?? STRINGS.ja[key] ?? key;
  return typeof v === "function" ? v(...args) : v;
}

// Locale for number/date formatting that has language-specific output.
export const LOCALE = LANG === "ja" ? "ja-JP" : "en-US";
