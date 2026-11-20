# My Crypto Triathlon

My Crypto Heroes のヒーロー 50 組が、陸・海・空の 3 種目を競うお祭りレース（非公式の二次創作）。

- **陸**：50 組が一斉にスタート。敵を倒してレベルを上げ、エクステンションを選んで育て、関門の番人を抜けて、上位 30 組に入る
- **海**：酸素を気にしながら潜り、遺物を掘り出して門を開け、秘宝を手に入れる
- **空**：集めたエクステンションで戦闘機を組み、奥へ奥へと飛ぶ

最初は予選も通れません。走るたびに手に入る CE でスキルツリーを育て、少しずつ先へ進みます。
HP が 0 になると数秒気絶します。コースには審判がいて、その視界（円）の中でライバルを直接攻撃すると反則です。円の外なら、おとがめなし。

ゲームの全体像と今後の予定は [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md)。

## 操作

| | PC | スマホ（横持ち） |
|---|---|---|
| 移動（陸は上下だけ。前へは自動） | WASD / 矢印 | 画面左のスティック |
| 陸：ダッシュ（体当たり） | Space | A |
| 陸：ストライク（直接攻撃） | Shift | B |
| 陸：お助けエクステンションを使う | 1 / 2 | 右上のアイコンをタップ |
| レベルアップのカードを選ぶ | 1〜3 / クリック | タップ |
| 海：銛 | Space / クリック | A |
| 空：ブースト / ロール | Space / Shift | A / B |
| 一時停止 | Esc / P | 右上のボタン |

## 開発

```sh
git clone --recurse-submodules https://github.com/bearko/mycryptotriathlon
cd mycryptotriathlon
npm install
npm run dev        # 開発サーバー
npm test           # テスト
npm run build      # dist/ にビルド
```

素材は [bearko/mycryptoheroes](https://github.com/bearko/mycryptoheroes)（サブモジュール `vendor/mycryptoheroes`）から、
`scripts/sync-assets.mjs` が使うものだけを `public/mch/` に写します（`npm run dev`・`build`・`test` の前に自動で走ります）。

## 公開（Cloudflare）

Cloudflare Workers の静的配信です（`wrangler.jsonc`、`dist/` を配信）。
Workers Builds でこのリポジトリをつなぎ、ビルドコマンド `npm run build`、デプロイコマンド `npx wrangler deploy` を設定します。
サブモジュールを使うので、ビルドの設定でサブモジュールの取得を有効にしてください。

## ライセンス

ソースコードと文書は MIT。My Crypto Heroes の画像・BGM・効果音は対象外です（[LICENSE](LICENSE)）。
