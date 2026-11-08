# QOM ステーキング（QL1）

QL1（QOM）のバリデーターに Keplr / FoxWallet / MetaMask でステーキングするための静的サイト。

## 言語（English / 日本語）
- ルート（`index.html`）は言語ゲート：保存済みの選択（localStorage `qomstaking_lang`）が
  「ja」のときだけ日本語ページへ、それ以外は **英語がデフォルト**。
- 日本語ページ：`ja.html` ／ 英語ページ：`en.html`。両ページともヘッダー右上に
  言語セレクタがあり、切り替えると選択が保存される。
- DEX アグリゲーター（dex-aggregator v6.3）と同じ方式。文言は `src/i18n.js` の
  文字列テーブルに集約し、ページの `lang` 属性で切り替える（動的文字列も含め全訳）。

**公開サイト:** https://ql1-infinite42-guppy-histoire.github.io/qom-staking/ （入口＝言語ゲート）
- 日本語: https://ql1-infinite42-guppy-histoire.github.io/qom-staking/ja.html
- English: https://ql1-infinite42-guppy-histoire.github.io/qom-staking/en.html

## 対応ウォレット
- **Keplr**：拡張機能（PC）／アプリ内ブラウザ（スマホ）
- **FoxWallet**：Keplr と同じ Cosmos プロトコル（window.foxwallet.cosmos）。
  Cosmos 対応はモバイルアプリ版のみ（公式ドキュメント記載）なので、アプリ内ブラウザで開く。
- **MetaMask / EVMウォレット**：ethermint の EIP-712 "web3 tx" 方式で対応。
  QL1 には EVM 側のステーキング・プリコンパイル（0x0800 / 0x0801）は無いが
  （実測で空応答）、ノードは署名モード127＋ExtensionOptionsWeb3Tx の
  Cosmos tx を受け付ける。実在の成功例がチェーン上に111件あり
  （ステーキング・報酬受取）、うち1件のステーキングについて typed data を再構成して
  署名者が復元できることまで検証済み（2026-11-05）。
  公開鍵が未登録の口座でも使える：署名から公開鍵を復元して取引自体に
  含める（その取引が登録を兼ねる）。登録専用ボタン（100 QOM をバーン
  アドレスへ送る方式）も一時用意したが、自動復元で足りるため
  ユーザー判断で撤去した（2026-11-06、v9）。
  ガス単価は 2026-11-06 に再実測し、フロア 18 QOM/ガスで不変を確認。

## できること
- Keplr 接続（チェーン qom_766-1 を自動で追加提案）
- 残高・ステーキング中・たまった報酬・解除手続き中の一覧
- バリデーター一覧（稼働中 9 件＋全 109 件、手数料率・預かり合計つき）
- ステーキングする／増やす／解除する（21日で戻る）／別のバリデーターへ移す／報酬を受け取る（全部まとめても可）

## 技術メモ（検証済み 2026-11-05）
- QL1 には公開 LCD/REST が無いので、読み取りは全部 CometBFT RPC
  （https://rpc.foxxone.one、CORS 可）越しの ABCI クエリ（CosmJS Stargate）。
- QL1 は ethermint 系：アカウントは EthAccount、署名者の公開鍵タイプは
  `/ethermint.crypto.v1.ethsecp256k1.PubKey`（チェーン上の実在の報酬請求
  tx で確認）。CosmJS 標準の署名だと鍵タイプが合わず弾かれるため、
  tx は手組みして Keplr の signDirect に渡している。
- 手数料のガス単価は実測で 18 QOM/ガスがチェーンの最低ライン（eth_gasPrice と実在txの全サンプルが一致）。サイトは最低18／ふつう22／高い30 QOMから選択＋自由入力でき、tx内の手数料にそのまま反映する。Keplr 登録時の gasPriceStep も同水準に設定。
- 秘密鍵は Keplr 内だけ。このサイトは署名済み tx を中継するだけ。

## 開発
```sh
npm install
npm run build   # docs/ に静的ファイルを出力（GitHub Pages が /docs を配信）
```

---

## English summary

A static site for staking QOM with QL1 validators with Keplr, FoxWallet, or MetaMask.

- **Language**: the root page is a language gate — English by default, Japanese
  (`ja.html`) only when that choice was saved (`qomstaking_lang` in localStorage).
  Both pages have a language selector at the top right of the header. All UI
  strings, including dynamic ones, live in the table in `src/i18n.js`.
- **Wallets**: Keplr (extension / in-app browser); FoxWallet (same Cosmos
  protocol via `window.foxwallet.cosmos`, mobile app only); MetaMask / EVM
  wallets via ethermint's legacy EIP-712 "web3 tx" flow (signer mode 127 +
  ExtensionOptionsWeb3Tx) — QL1 has no staking precompiles, but its node
  accepts these Cosmos txs (111 successful on-chain examples verified
  2026-11-05). Accounts whose pubkey is not yet registered are supported:
  the pubkey is recovered from the signature and carried in the first tx
  itself, which registers it.
- **Features**: connect (suggests chain `qom_766-1`), balances / staking positions /
  rewards / unbonding list, validator list (9 bonded of 109, with commission
  and total stake), stake / add / unstake (21-day unbonding) /
  move to another validator / claim rewards (individually or all at once), % amount chips.
- **Reads**: QL1 has no public LCD/REST, so all reads go through CometBFT RPC
  (`https://rpc.foxxone.one`) ABCI queries via CosmJS. Accounts are ethermint
  EthAccounts with `/ethermint.crypto.v1.ethsecp256k1.PubKey` signer keys, so
  transactions are hand-built and signed via Keplr `signDirect`.
- **Gas**: the chain floor is 18 QOM per gas (measured on-chain, re-measured
  2026-11-06). The site offers 18 / 22 / 30 QOM presets plus free input
  (floor-validated), and stake MAX subtracts the real fee.
- Private keys never leave the wallet; this site only relays signed txs.
