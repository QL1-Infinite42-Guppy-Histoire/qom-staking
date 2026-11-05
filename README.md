# QOM 委任（QL1 ステーキングサイト）

QL1（QOM）のバリデーターに Keplr / FoxWallet で委任するための静的サイト。

## 対応ウォレット
- **Keplr**：拡張機能（PC）／アプリ内ブラウザ（スマホ）
- **FoxWallet**：Keplr と同じ Cosmos プロトコル（window.foxwallet.cosmos）。
  Cosmos 対応はモバイルアプリ版のみ（公式ドキュメント記載）なので、アプリ内ブラウザで開く。
- **MetaMask は不可**：QL1 には EVM 側のステーキング・プリコンパイル
  （0x0800 / 0x0801）が存在しないことを実測で確認（eth_call が空応答、
  コードなし）。MetaMask は Cosmos 形式の tx に署名できないため、
  QL1 の委任には使えない。

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
