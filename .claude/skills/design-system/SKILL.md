---
name: design-system
description: 画面のあるシステムの基盤づくり（001）で、見た目の壁打ちから 3 通りの候補を描き、人が選んだ案を Design System の型でデザインシステム（値と土台の CSS）にして、値を _tech/design.yaml に書く。段 2 の相談と承認の前に、人の直しを読み直す。機能のチケットで値か土台の CSS を足すか変えるときも使う。
user-invocable: false
---

# design-system

## 使う役
designer

## 読むもの
- `specs/001-foundation/hearing/brainstorm.md` の「デザイン」（見た目の壁打ちで話したことと、人が確認した言い直し：どう感じてほしいか、好きなサイトや製品と理由、嫌いなもの、競合とどう違って見せたいか、使う場面、ブランドの性格、渡せる素材や色の決まり）と `hearing/questions.yaml`（選んだ候補と、前提の問いの答え）
- `specs/ticket-plan.yaml`（候補の代表の画面を選ぶ）
- お手本の画像（`git rev-parse --git-common-dir` の下の `aidd/references/design/`。人が置いたときだけ）
- `specs/_current/_intent/`（誰が、どんな場面で使うか）
- 作る回は `specs/_current/_tech/architecture.md`（仕様担当が決めた画面の幅の名前と大きさと、文節の区切りの手当てとその道具が勧める CSS）
- `specs/_references/`（人が置いた資料があれば）
- プロダクトリードが伝える回（候補、作る、直す、読み直す）と、直すときはキャンバスのコメントか人の答えの中身
- 機能のチケットで値か土台の CSS を足すか変えるとき（screen-mock から）は、その理由（今ある値では描けない画面の意図、直す範囲が all の画面のレビューの指摘、人のコメント）

## 0. 候補（001 の壁打ちの後）
人が見比べて 1 つ選べるように、見た目の壁打ちの話を 3 通りに解釈した候補を描く。推しは書かない。
1. 案は色違いにせず、名前の付いた軸（配置、密度、性格）で分ける。案ごとに、先に短い案（色 4〜6、書体とその役、配置の考え、原則 2〜3 行）を書き、AI が作りがちな既定の見た目（紫から青のグラデーション、どれも同じ大きさのカードの格子、中央寄せのヒーローに 3 つの特徴の並び、Inter だけの書体、意味の無い絵文字や飾りの図形）に寄っていないかを照らして直してから、値を書く
2. お手本（壁打ちで挙がったサイトや製品）は、なぜ好きかの言葉と、置かれた画像だけを使う。お手本の製品の形、絵、文、色の組み合わせを写さない
3. 案ごとに `specs/001-foundation/ds-candidates/<案の名前>/` に次を置く（ふつうの HTML。Design の型もランタイムも使わない）
   - `tokens.css`：下の 1 の 2 と 3 の範囲の値を CSS の変数で書く。書体は先頭に `@import` で読み込む（Google Fonts など）
   - 代表の画面 2 枚（`<画面の名前>.html`）：`ticket-plan.yaml` から選ぶ。業務の画面と顧客向けの画面の両方があれば 1 枚ずつ。tokens.css を `<link>` で読み、配置ごと実際の画面として描く（値だけを入れ替えた見本のページにしない。見本と実際の画面では見え方の順位が入れ替わるため）。要件はまだ無いので、壁打ちの話から現実にありうる中身で描く。スマホの幅（390px）を超える固定の幅を使わず、表は折り返すか表の中で横に送る（撮れないので、横にはみ出さない描き方で防ぐ）
   - `about.md`：方向の名前、何を変えたか、向く場面、引き換えを 1 行ずつ
4. 撮らない（001 の壁打ちの時点では、案件の Playwright がまだ無い）。代わりに、HTML、tokens.css の書体の読み込み、about.md を読み直して確認する。比較のページは、プロダクトリードが `ds-compare.mjs` で作る

## 1. 作る
人が選んだ案（`hearing/questions.yaml` の答え）だけを、デザインシステムにする。値は、その案の tokens.css から始める。
1. Artifact の `quickstart`（intent: other）で Design System の型を見つけ、その `type_url` から 1 つ作る（title はシステムの名前）。型の指示に従って、元のファイル（値、説明など）を scratchpad に書いて公開する。元のファイルはリポジトリに置かない
2. 値は、色（明るい地と暗い地）、文字（書体、見出し、本文、ラベル、ボタン、数、誤りの知らせ）、間隔、角の丸みを決める。breakpoint（画面の幅の名前と大きさ）は、画面のあるシステムでは必ず書く。architecture.md の幅の名前と大きさのとおりに、`{ desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } }` の形で書く（最初の幅が、canvas.yaml に widths を書かない画面の既定になる。後から足すと、すべての画面の PNG の名前が変わるため、001 で決める）。motion（時間で動く値と、スクロールの位置で動く値。動きを減らす設定では止めずに穏やかにする）は、土台の CSS の操作の応答と知らせの出入りに使う値を必ず書き、ほかの動きの値は要る画面があるときだけ足す。要る画面があるときだけ、size（部品の高さ、押せる大きさ、中身の最大の幅、格子）、border、shadow、effect（すりガラスなど）も書く。選んだ案の性格を保ち、業務の画面では長く使って疲れないものにする。デザインシステムのページには、主な部品（ボタン、入力欄、表、知らせ）と、下の 4 の入力の部品（プルダウン、日付と時刻、ファイルを選ぶ、チェック）を、明るい地と暗い地の両方で並べた見本を入れる（人が承認の前に、暗い表示の見え方も確認できるように）。見本が HTML と CSS だけで `components/bundle.js` を持たないときは、`design-system.json` に `namespace` を書かない（型のページは、見本があり、bundle.js が無く、namespace があると、見本を動かさずに「Previews can't run」と出し、見本に土台の CSS が効かない）
3. デザインシステムに `project/tokens.css` も公開し、同じものを `specs/_current/_tech/ds/<フォルダ>/tokens.css` に置く（リポジトリの正本。フォルダはデザインシステムの名前を英小文字とハイフンにしたもの。mock-render が各領域のモックの写しに写す）。tokens.json のすべての値（breakpoint を除く。breakpoint は CSS の変数で使えないので design.yaml の値だけにする）を CSS の変数で書く。書体は先頭に `@import` で読み込む（モックがどこでも同じ書体で描かれるように。作るコードは、001 が npm のパッケージなどで同じ書体を入れる）。変数の名前は、design.yaml の欄の道筋を kebab にしてつなぐ（`--color-surface-sunken`、`--type-family-text`、`--spacing-5`、`--radius-md`）。明るい地を `:root` に、暗い地を `[data-theme="dark"]` に書き、`prefers-color-scheme` の指定は書かない（OS が暗い表示の人だけキャンバスのモックが暗く描かれ、明るい表示で撮る PNG と e2e とずれるため）。tokens.json と tokens.css は、同じ値の一覧から書いて食い違わないようにする。画面のモックは、この変数で色、文字、間隔、角の丸みを書く（screen-mock）
4. 土台の CSS（`project/base.css`）を書いてデザインシステムに公開し、同じものを `specs/_current/_tech/ds/<フォルダ>/base.css` に置く（リポジトリの正本。mock-render が各領域のモックの写しに写し、作る役が 001 で作るものの共通の CSS に写す）。値は tokens.css の変数で書き、`@import` は書かない。次の 3 つを決める
   - 日本語の行の折り返し：`line-break: strict`、`word-break: keep-all` の後に `word-break: auto-phrase`、`text-wrap: pretty`。auto-phrase は Chromium だけが対応し、Safari（iPhone を含む）と Firefox では捨てられて keep-all が残る（作るものは、001 で決めた文節の区切りの手当てで受ける）。architecture.md に、文節の区切りの手当ての道具が勧める CSS が書いてあれば、それも入れる。文に入れた値（名前など）を包む span（`[data-value]`）に `display: inline-block` を当てる（行に収まらない値は丸ごと次の行へ送り、1 行より長い値だけ中で折り返す。名前が姓と名の間で割れないように）。1 行で切る欄の印 `[data-truncate]` を置き、`overflow: hidden`、`white-space: nowrap`、`text-overflow: ellipsis` で 1 行に切り、その中だけ `[data-value]` を `display: inline` に戻す（inline-block の値は、前に文字があると丸ごと「…」になるため）
   - 操作の応答と動き：押した（`:active`）、上に乗った（`:hover`）、フォーカス（`:focus-visible`）、送っている間（`[aria-busy="true"]`、`:disabled`）、知らせの出入り（`[role="status"]`、`[role="alert"]`）の見せ方と、その動きの値（motion の変数）。動きを減らす設定（`prefers-reduced-motion`）では、止めずに穏やかにする
   - 入力の部品の形：プルダウン（`select`）、日付と時刻（`input[type="date"]`、`input[type="time"]`）、ファイルを選ぶ（`input[type="file"]`）、チェック（`input[type="checkbox"]`）
   セレクタは、要素、状態（疑似クラスと aria の属性）、data 属性だけで書き、画面ごとのクラスを使わない（作るものにそのまま写せるように）
5. `specs/_current/_tech/design.yaml` に、名前、URL、雰囲気（mood）と、値（color、type、spacing、radius と、書いたなら motion、breakpoint、size、border、shadow、effect）をデザインシステムの値のとおりに書く。値には、何に使うかを短いコメントで添える。基盤づくりで、この値がコードの共通の値（CSS の変数。名前は tokens.css と同じ）に写される
6. `specs/_current/_tech/design.yaml` に、言葉づかいの決まり（`text_rules`。1 行に 1 つ）を足す。少なくとも、です・ます調か、ボタンは押すと何が起きるかを言う、同じ操作は流れを通して同じ名前にする、失敗の知らせは何が起きたか・なぜか・どう直すかを言う、空の画面はこれは何か・なぜ空か・どう始めるかを言う、ラベルは中身の名前にする、古い日時は 1 週間を過ぎたら日付で書く、を決める。壁打ちのブランドの性格と使う人に合わせる

## 2. 直す
先に `read` でデザインシステムの今の中身を取り（scratchpad の元のファイルは、前の起動のものが残っていないことがある）、プロダクトリードが渡したコメントか人の答えの直し（機能のチケットでは、値か土台の CSS を足すか変える理由）を入れて、値は tokens.json と tokens.css の両方を、土台は base.css を直して公開し直し、`_tech/design.yaml` の値と `_tech/ds/<フォルダ>/` の tokens.css と base.css を合わせる。公開が「新しい版を読んでいない」で断られたら（人がデザインシステムを直接直した）、`read` で読み直し、人の直しを残したまま自分の直しを重ねて公開し直す。

人の直しから決めたこと（`decisions`）は、screen-mock の「2. コメント、人の答え、レビューの指摘の直し」で足す。直す回でデザインシステムの値を変えたときも、きっかけが人の直しなら 1 行足す。

## 3. 読み直す（001 の段 2 の人の番と相談の終わり）
`read` でデザインシステムの今の中身を読み、`_tech/design.yaml` の値と `_tech/ds/<フォルダ>/base.css` と比較する。違えば（人が直接直した）、`_tech/design.yaml` の値と `_tech/ds/<フォルダ>/` の tokens.css と base.css を今の中身に合わせて書き直し、報告に違いを書く。

## しないこと
- `_tech/design.yaml` と `_tech/ds/` のほかの `_tech` のファイルを書くこと（技術の土台は仕様担当が書く）
- 画面のモックを作ること（機能のチケットの screen-mock で作る。値か土台の CSS を変えた後の、領域のキャンバスへの写し（tokens.json、tokens.css、base.css）の入れ直しも screen-mock で行う。リポジトリの各領域の写しは mock-render が写す）

## 終わったとき
候補の回は、案ごとのフォルダと、方向の名前を 1 行ずつ書く（どれを勧めるかは書かない）。
報告に、デザインシステムの URL、決めた値の要点（主な色、書体）、土台の CSS で決めたこと（折り返し、操作の応答と動き、入力の部品の形を 1 行ずつ）、読み直しで見つけた人の直し（あれば）を書く。機能のチケットで直したときは、足した値と、変えた値の前と後、土台の CSS で足すか変えた宣言を書く。
