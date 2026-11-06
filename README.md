# QOM 委任（QL1 ステーキングサイト）

QL1（QOM）のバリデーターに Keplr / FoxWallet / MetaMask で委任するための静的サイト。

## 対応ウォレット
- **Keplr**：拡張機能（PC）／アプリ内ブラウザ（スマホ）
- **FoxWallet**：Keplr と同じ Cosmos プロトコル（window.foxwallet.cosmos）。
  Cosmos 対応はモバイルアプリ版のみ（公式ドキュメント記載）なので、アプリ内ブラウザで開く。
- **MetaMask / EVMウォレット**：ethermint の EIP-712 "web3 tx" 方式で対応。
  QL1 には EVM 側のステーキング・プリコンパイル（0x0800 / 0x0801）は無いが
  （実測で空応答）、ノードは署名モード127＋ExtensionOptionsWeb3Tx の
  Cosmos tx を受け付ける。実在の成功例がチェーン上に111件あり
  （委任・報酬受取）、うち1件の委任について typed data を再構成して
  署名者が復元できることまで検証済み（2026-11-05）。
  公開鍵が未登録の口座でも使える：署名から公開鍵を復元して取引自体に
  含める（その取引が登録を兼ねる）。登録専用ボタン（100 QOM をバーン
  アドレスへ送る方式）も一時用意したが、自動復元で足りるため
  ユーザー判断で撤去した（2026-11-06、v9）。
  ガス単価は 2026-11-06 に再実測し、フロア 18 QOM/ガスで不変を確認。

**公開サイト:** https://ql1-infinite42-guppy-histoire.github.io/qom-staking/

## できること
- Keplr 接続（チェーン qom_766-1 を自動で追加提案）
- 残高・委任中・たまった報酬・解除手続き中の一覧
- バリデーター一覧（稼働中 9 件＋全 109 件、手数料率・預かり合計つき）
- 委任する／増やす／解除する（21日で戻る）／別のバリデーターへ移す／報酬を受け取る（全部まとめても可）

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
