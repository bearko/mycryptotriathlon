# プロジェクトのメモ（Claude 用）

- **ユーザーへの返答・報告・質問は、必ず日本語で書く**。
- **ほかの作品の名前（参考にしたゲームなど）を、このリポジトリのどこにも書かない**。ファイル・コミットメッセージ・ブランチ名・PR のタイトルと本文・コメントのすべてが対象。仕組みは「自動で攻撃する品」「潜水」「奥へ進む視点」のように一般的な言葉で書く。
- このリポジトリは「My Crypto Triathlon」。My Crypto Heroes のヒーロー 50 組が陸・海・空の 3 種目を競うレースゲーム。走る → 予選落ち → スキルツリーで強化 → もう一度、の周回が芯。全体像は `docs/GAME_DESIGN.md`。ルールを変えたらこの文書も直す。
- サイトを開くと `index.html` → `src/main.ts`。公開は Cloudflare Workers の静的配信（`wrangler.jsonc`）。本番のブランチは `main`。
- 構成：
  - `src/core/` 入力（キーボード・マウス・タッチ）、音、画像、カタログ、乱数
  - `src/game/` ルール：`roster.ts`（武器 10 種・強化 11 種・お助けエクステンションの一覧と数値）、`run.ts`（1 回の挑戦・レベルアップのカード・経験と GUM）、`meta.ts`（スキルツリー・メダル・セーブ）、`reward.ts`（CE）
  - `src/stages/` レース：`arena.ts`（2D の共通部分：走者・エネミー・気絶・反則・審判・パッシブ）、`weapons.ts`（武器の動き）、`land.ts`、`sea.ts`、`sky.ts`（three.js。ここだけ別チャンク）
  - `src/ui/` 画面：`hud.ts`（順位・実況・ゲージ）、`screens.ts`（タイトル・走順・結果など）、`tree.ts`（スキルツリー）
- 素材は `vendor/mycryptoheroes`（サブモジュール）から `scripts/sync-assets.mjs` が使うものだけを `public/mch/` に写し、`src/generated/catalog.json` を作る（どちらも Git には入れない）。ヒーローのパッシブスキルの読み取り（発動条件と効果の種類）もここ。
- レースがツリーから読むのは `stats()`（`meta.ts` の `Stats`）だけ。パネルを足すときは `SKILLS` に 1 行足し、必要なら `Stats` にキーを足して、レース側でそのキーを読む。置き場所（x, y）が重ならないこと・根からたどれることはテストが見る。
- 反則は「審判の円の中で、ライバルに直接攻撃を当てたとき」だけ（`arena.ts` の `strike`・`watching`・`foul`）。体当たり・アイテム・パッシブは反則にしない。
- 陸の難度は `land.ts` の `PACE_MIN`・`PACE_SPAN`・ライバルの `dps`・関門の `need`。変えたら、自動操縦で順位を確かめる（下のデバッグ用 URL）。目安：強化なしで 30〜45 位、中盤まで育てて 20 位台。
- デバッグ用の URL（どこからもリンクしない）：`?stage=land|sea|sky`（その種目から）、`&bot=1`（自動操縦）、`&quick=1`（紹介を飛ばす）、`&speed=3`（早送り）、`&tree=atk:5,speed:3`（そのスキルツリーで始める。本物のセーブには触らない）、`&ce=300&medal=5`、`&heroes=id,id,id`。結果は `window.__log`。
- チェック：`npm test`・`npm run typecheck`・`npm run build`。
- PC とスマホ横持ちの両方で遊べること（スマホは左に仮想スティック、右に A・B）。ボタンは 44px 以上、ドット絵は `image-rendering: pixelated`。画面を直したら 1280×720 と 844×390 で重なりを確かめる。
- 陸は前へ自動で走り、プレイヤーは上下だけを操作する（`land.ts` の `heroControl`）。強化はレベルアップのカード選択（`screens.ts` の `levelUpScreen`、選ぶあいだは `arena.picking` でレース全体が止まる）。宝箱パネルのお助けエクステンションは `land.ts` の `useItem`・`stepItems`。妨害するものは必ず `reflects`（鏡）を通す。
