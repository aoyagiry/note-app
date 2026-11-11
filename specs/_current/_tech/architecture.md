# architecture

## 技術スタック

| 部分 | 技術 |
| --- | --- |
| アプリの殻 | Tauri 2（Windows は WebView2、Mac は WKWebView） |
| 処理 | Rust（stable。版は rust-toolchain.toml） |
| パソコンの中のデータ | SQLite（rusqlite の bundled）、rusqlite_migration、Yjs の形の文書（yrs） |
| 時刻 | jiff |
| 記録 | tracing、tracing-appender |
| 画面 | React 19、TypeScript、Vite、CSS Modules、CSS の変数 |
| 本文の編集 | 003 で選ぶ（ProseMirror の系統と y-prosemirror を前提にする） |
| 書体 | Fontsource の npm パッケージ（design.yaml の書体。今の案では Zen Maru Gothic と Nunito） |
| 文節の区切り | BudouX（budoux） |
| 試す場 | axum（crates/devhost） |
| データの形の共有 | crates/protocol と ts-rs |
| サーバー（005 から） | Supabase（Postgres、Auth、Realtime。Edge Functions は使わない）。アプリからは画面の側の supabase-js でやり取りする。ログインの情報は keyring で OS の鍵の置き場所に置く。手元は Supabase の CLI と Docker |
| テスト | Vitest、Playwright（Chromium、WebKit）、cargo-nextest |
| カバレッジ | Vitest の v8、cargo-llvm-cov |
| 書き方の検査 | ESLint、Prettier、rustfmt、clippy |
| 脆弱性の検査 | npm audit、cargo audit |
| CI とリリース | GitHub Actions、tauri-apps/tauri-action |
| Node.js | LTS の版（.node-version に書く） |

## 構成とレイヤ

```
画面（apps/desktop/src。React）
  ├ sync（apps/desktop/src/sync。005 から）：supabase-js で Supabase とやり取りする（ログイン、差分を預ける、知らせを受ける）
  │   └ 差分の受け渡しは bridge のコマンドで処理に頼む
  └ bridge：コマンドの呼び出し。Tauri の中では invoke("invoke_command")、ブラウザでは試す場への HTTP
      ├ Tauri のアプリ（apps/desktop/src-tauri）─ 汎用のコマンド invoke_command ─┐
      └ 試す場（crates/devhost）─ POST /api/invoke/<コマンド> ─────────────┤
                                                  dispatch（crates/commands。ただ 1 つの入口）
                                                  └ 処理（crates/core）
                                                      ├ パソコンの中のデータ（SQLite と Yjs の文書）
                                                      ├ 時計（Clock）
                                                      └ 同期の手前（006。まだ預けていない差分を出す、届いた差分を合わせる）
サーバー（supabase/。005 から）：Auth、Postgres（差分を積む表と行ごとの制限）、Realtime（データベースから送る Broadcast）
```

- 処理の中心は crates/core に置く。core は Tauri にも HTTP にも頼らない。画面に出す文を持たず、理由の符号だけを返す
- crates/commands の `dispatch(名前, JSON の引数) -> JSON の結果か失敗の形` を、コマンドのただ 1 つの入口にする。コマンドの名前、引数と戻り値の型、引数の読み取り、失敗の写し方（下の「エラーの形」）、想定外の失敗と panic を internal に変えること（catch_unwind）は、すべて dispatch の中で行う
- Tauri のアプリは、汎用のコマンド `invoke_command { name, args }` を 1 つだけ登録し、受けた name と args（JSON のまま）を dispatch に渡して、返ったものをそのまま返す。コマンドごとの Tauri のコマンドは作らない（Tauri の引数の名前の変換（camelCase と snake_case）を通らないように）。試す場の `POST /api/invoke/<コマンド>` も、本文の JSON を dispatch に渡すだけにする。どちらも処理を書かない。こうして、API のテストと e2e が通る道と、アプリが通る道を、dispatch から先で同じにする
- アプリだけに残る部分（bridge の invoke の分かれと、invoke_command が dispatch へ渡すこと）は、基盤の受入条件（AC-errors-3、AC-structure-4）で確かめる
- 画面は bridge 以外から処理を呼ばない。bridge は、Tauri の中（window.__TAURI_INTERNALS__ がある）なら `invoke("invoke_command", { name, args })`、そうでなければ同じ origin の `POST /api/invoke/<name>`（本文は args）を呼ぶ。どちらの道でも、同じ名前と同じ JSON の引数を渡し、返った失敗の形をそのまま渡す
- 画面の「今」（日付、時刻、時刻で変わる背景の空の色）は、コマンド now で処理から受け取る。画面で Date.now() や new Date() を「今」に使わない（試す場を --clock で起こしたときに、画面の今も変わるように）。受け取った後の秒の進みは、受け取った時刻と performance.now() の差で足す
- ネットにつながっていなくても、ページの操作はすべてパソコンの中のデータに対して行う（RULE-works-offline）。サーバーへの同期は裏で行い、操作の結果を待たせない
- Supabase とやり取りするのは、画面の側の sync（公式のクライアント supabase-js）だけにする。Supabase には Rust の公式のクライアントが無いため（下の「同期の受け持ち」）

### 同期の受け持ち（005、006）

| 受け持つもの | 置き場所 |
| --- | --- |
| ページのデータ、Yjs の文書、まだ預けていない差分の記録、届いた差分を合わせること（CRDT） | 処理（crates/core。yrs） |
| ログイン、トークンの更新、差分を表に足す、表から取る、Realtime の私用のチャンネルで知らせを受ける | 画面の側の sync（supabase-js） |
| ログインの情報（トークン）の保存 | 処理が OS の鍵の置き場所（Mac のキーチェーン、Windows の資格情報マネージャー。keyring の crate）に置く。sync は supabase-js の storage を、処理のコマンドで読み書きする形に差し替える |

- 流れ：sync は、処理のコマンドで「まだ預けていない差分」を受け取り（Yjs の差分は base64 の文字列で JSON に入れる）、表に足し、足せたら処理に「預けた」と知らせる。知らせを受けるか、つながり直したら、表から前に取った所より後の差分を取り、処理のコマンドで合わせる。合わせ方は処理だけが決め、sync は差分の中身を読まない
- sync はアプリが開いている間（窓が見えていない間も含む）に動く。窓を閉じたときにアプリを残すかは 006 で決める
- e2e では、試す場の画面でも同じ sync が動き、手元の Supabase（Docker）を相手にする
- データの形は crates/protocol に Rust で書き、ts-rs で TypeScript の型を packages/protocol/src/generated/ に生成する（npm run gen。生成したものはコミットしない）

## 標準のファイル構成

```
.github/workflows/ci.yml          CI（PR と main への push）
.github/workflows/release.yml     版の印のときだけ、Mac と Windows のアプリをビルド
.gitattributes                    * text=auto eol=lf（Windows でも改行を LF に揃える。土台の CSS の一致の確認のため）
.node-version                     Node.js の版
rust-toolchain.toml               Rust の版と部品（clippy、rustfmt、llvm-tools-preview）
package.json / package-lock.json  JavaScript の依存とコマンド（npm の workspaces は使わない）
Cargo.toml / Cargo.lock           Cargo の workspace（依存の版は workspace.dependencies にまとめる）
tsconfig.json                     TypeScript の設定
eslint.config.js / .prettierrc    書き方の決まり
vite.config.ts                    画面のビルドの設定（テストの設定を混ぜない）
vitest.config.ts                  Vitest の設定（テストを書く役が書く）
playwright.config.ts              e2e の設定（テストを書く役が書く）
.config/nextest.toml              cargo-nextest の設定（テストを書く役が書く）
scripts/                          準備、ビルド、起動、計測の手前のコマンド（node で書き、Mac と Windows で同じに動く）
apps/desktop/
  index.html
  src/
    main.tsx                      書体、tokens.css、base.css の順に読み込み、画面を起こす
    app/                          画面の組み立てと切り替え
    features/<領域>/              領域ごとの画面と部品（例：features/pages/）
    ui/                           共通の部品（Text.tsx：画面文を出す部品 など）
    bridge/                       コマンドの呼び出し
    texts/                        画面文の取り出し（virtual:texts）
    styles/tokens.css             見た目の共通の値（design.yaml の写し）
    styles/base.css               土台の CSS（_tech/ds/<フォルダ>/base.css の写し）
  src-tauri/                      Tauri のアプリ（窓、コマンドの受け口の登録、記録）
crates/
  core/                           処理とパソコンの中のデータ
  commands/                       コマンドの受け口と失敗の写し方
  devhost/                        試す場（HTTP で画面とコマンドを配る）
  protocol/                       データの形
packages/protocol/                生成した TypeScript の型
supabase/                         サーバーの定義（005 から。migrations/ だけ）
tests/
  api/                            API のテスト（*.test.ts。試す場を相手にする）
  support/                        テストの支え（コマンドを呼ぶ関数、準備の関数、時刻の表）
  run/                            テストのコマンドの手前の node のスクリプト
e2e/                              e2e のテスト（*.spec.ts）
e2e/support/                      e2e の支え（フィクスチャ、撮る関数）
perf/                             計測（*.perf.ts と設定）
crates/*/tests/                   Rust のテスト（結合のテストの形だけ。src の中に #[cfg(test)] のテストを書かない）
apps/desktop/src-tauri/tests/     Tauri のアプリの invoke_command のテスト（tauri::test の mock runtime）
reports/junit/                    テストの結果（JUnit XML。.gitignore）
coverage/                         カバレッジ（.gitignore）
e2e-screenshots/                  e2e のスクリーンショット（.gitignore）
test-results/                     Playwright の出力（.gitignore）
.browsers/                        Playwright のブラウザ（.gitignore）
.data/                            人が試すときのデータ（.gitignore）
target/、apps/desktop/dist/       ビルドの出力（.gitignore）
```

## 仕様の結果の写し方

コマンドは名前と引数で呼ぶ形（RPC）で、HTTP の道筋ごとに分けない。成功は Rust の `Ok(値)` で返し、失敗は下の「エラーの形」で返す。試す場の HTTP では、失敗の種類を状態コードに写す。

| 業務の結果 | 技術の形 |
| --- | --- |
| 受け付ける | `Ok(結果)`。作る操作は作ったもの（ID を含む）、変える操作は変えた後のもの、消す操作は `Ok(())`。HTTP では 200 と結果の JSON |
| 見つからない | kind `not_found`。HTTP では 404 |
| 断られる（要件に反する） | kind `rejected`、reason にどの要件に反したかの符号。HTTP では 422 |
| ほかと重なる | kind `conflict`。HTTP では 409 |
| 権限が無い | kind `forbidden`。HTTP では 403。ほかの人のページは、あることも知らせないため `not_found` で返す（RULE-own-pages-only） |
| ログインしていない | kind `unauthenticated`。HTTP では 401。ログインが要るのはサーバーとのやり取りだけで、パソコンの中の操作には要らない |
| 想定外 | kind `internal`、reason `internal`。HTTP では 500 |

### エラーの形

```json
{ "kind": "rejected", "reason": "title_too_long" }
```

- kind は上の表の 7 つのどれか。reason は snake_case の理由の符号で、kind ごとに具体例が決める（例：`page_has_children`）。kind が not_found、forbidden、unauthenticated、internal のときは reason を kind と同じにしてよい
- 入力の欄ごとの誤りがあるときだけ、`"fields": [{ "field": "title", "reason": "required" }]` を足す
- 文、例外の文、スタックトレース、ファイルの場所、道具の名前と版は返さない（NFR-error-details）。dispatch が、core の想定外の失敗（anyhow など）と panic（catch_unwind）を `internal` に変え（Tauri と試す場で同じ仕組み）、詳細は記録（tracing。アプリのデータの置き場所の logs/）にだけ書く
- 画面は、理由の符号に当たる画面文の ID を引いて出す。ID の決まりは `<領域>.error.<reason>`（例：`pages.error.title_too_long`）、どの領域にも共通の失敗（internal、つながっていない、など）は `common.error.<reason>`（_tech/texts.yaml）
- サーバー（005 から）の失敗も、画面の側の sync がこの形に変えてから画面に渡す。Postgres や Supabase の失敗の文を画面に渡さない

## 画面

### 画面の幅

| 名前 | 大きさ | 使う所 |
| --- | --- | --- |
| desktop | 1280×800 | 既定（canvas.yaml に widths を書かない画面）。アプリの窓の最初の大きさ |
| phone | 390×844 | パソコンで窓を細くしたときと、後で足すスマートフォン（phone-view） |

design.yaml の breakpoint にも同じ名前と大きさを書く。CSS の変数にはしない。

### 見た目の共通の値

- `_tech/design.yaml` の値（color、type、spacing、radius と、書いてあれば size、border、shadow、motion、effect）を、apps/desktop/src/styles/tokens.css に CSS の変数で写す。変数の名前は、デザインシステムの tokens.css と同じにする（design.yaml の欄の道筋を kebab にしてつなぐ。例：`--color-surface-sunken`、`--spacing-5`）
- 明るい地を `:root` に、暗い地を `[data-theme="dark"]` に書く（デザインシステムと同じ）。アプリは、起動のときに `<html>` の data-theme を決める：アプリの中で選んだ明るさがあればそれ、無ければ端末の設定（`matchMedia("(prefers-color-scheme: dark)")`）。選んだ明るさの持ち方は、明るさを切り替えるチケット（002）で決める
- 画面は、色、文字、間隔、角の丸みと、design.yaml にある size、border、shadow、motion、effect を、この変数だけで指定する。値を直に書かない
- breakpoint は CSS の変数にしない。画面の幅で配置を変える所は、上の表の幅を @media に書く
- 書体は、tokens.css の @import を使わず、Fontsource の npm パッケージ（使う太さだけ）を main.tsx で読み込む。アプリに同梱するので、ネットにつながっていなくても同じ書体で出る

### 土台の CSS

- `_tech/ds/<フォルダ>/base.css` を、apps/desktop/src/styles/base.css に中身のまま写す（Designer が直したら、写し直す）
- main.tsx で、書体、tokens.css、base.css の順に、ほかのどの CSS より先に読み込む。すべての画面で効く
- 画面は、base.css が決める折り返し、操作の応答と動き、入力の部品の形を、画面ごとに書き直さない

### 画面の文

- 画面の文は、画面文の一覧（`specs/_current/<領域>/texts.yaml` と `_tech/texts.yaml`）から ID で取り、コードに直に書かない
- 取り込み方：vite.config.ts と vitest.config.ts が同じ Vite のプラグイン（apps/desktop/texts-plugin.ts）を使い、ビルドのときに texts.yaml をすべて読んで、`virtual:texts`（ID から文への表）として渡す。ID が重なれば、ビルドを落とす
- 文を出す部品 `<Text id="…" values={{ name: … }} />`（apps/desktop/src/ui/Text.tsx）：文の `{名前}` を values の値で埋める。埋めた値は `<span data-value>` で包む（base.css がこの印に `display: inline-block` を当て、名前などを行の途中で割らない）。値の入る画面の文は、すべてこの部品で出す（文字列を組み立てて出すと、値が包まれない）
- 属性の値（aria-label、placeholder、alt、title など）は、`text(id, values)`（文字列を返す）で出す。包む span も文節の区切りも入れない
- 1 行で切る欄（`text-overflow: ellipsis`）には、base.css の印 `data-truncate` を付ける（その中では値を包む span が inline に戻り、値が丸ごと「…」にならない）

### 日本語の文節の区切り

- base.css の `word-break: auto-phrase` は Chromium（Windows の WebView2）だけで効き、Mac の WKWebView では捨てられて `word-break: keep-all` が残る。keep-all だけでは、区切りの無い長い文が折り返せず、はみ出す
- そのため、`<Text>` が、文の値でない部分を BudouX（`loadDefaultJapaneseParser().parse(文)`）で文節に分け、文節の間に `<wbr>` を入れる。区切りを入れるのは `<Text>` だけにする（ページの名前や本文など、人が書いた文には入れない）
- BudouX が勧める CSS は `word-break: keep-all; overflow-wrap: anywhere;`（BudouX の README の translateHTMLString の例）。Designer が base.css の文の要素に入れる

### 作った画面を人が開く

- `npm run build` で画面と試す場をビルドし、`npm run serve` で試す場を http://127.0.0.1:4310 に起こす。人はブラウザで開く。データは `.data/dev/` に入る
- 試せるデータは `npm run seed` で入れる（試す場の seed の処理が、core の関数で架空のデータを入れる。001 では入れるデータが無い。機能のチケットの作る役が、そのチケットの画面のデータを足す。005 からは、先に `npm run db:up` で Supabase を起こす）
- 日時を決めて起こすときは `npm run serve -- --clock <日時>`。日時は ISO 8601（例 `2027-05-12T16:00`。時間帯の無いものはパソコンの時間帯の時刻）。処理の時計がその時刻で止まり、画面の「今」も変わる
- デスクトップのアプリの窓で見るときは `npm run app`（tauri dev）。Mac では Safari と同じ仕組みで描かれるので、見え方の確認は窓でも行う

## テスト

### レベルと道具

| レベル | 道具 | 置き場所 | 何を確かめるか |
| --- | --- | --- | --- |
| unit | Vitest（project unit、jsdom） | apps/desktop/src/**/*.test.ts(x) | 画面の部品と画面の中の処理 |
| api | Vitest（project api、node） | tests/api/**/*.test.ts | 具体例の業務の結果。試す場の HTTP でコマンドを呼び、処理とパソコンの中のデータまで通す |
| e2e | Playwright | e2e/**/*.spec.ts | 画面の操作と、画面と処理のつなぎ目。スクリーンショットを撮る |
| rust | cargo-nextest | crates/*/tests/**、apps/desktop/src-tauri/tests/** | Rust の中の細かい決め事と、Tauri の invoke_command が dispatch に渡すこと（具体例の ID は書かない） |
| foundation | Vitest（project foundation） | specs/_current/_tech/checks/**/*.test.ts | 基盤の受入条件 |

- 具体例と計画の決め事を確かめるテストは、TypeScript のファイル（*.test.ts、*.spec.ts）に書き、テストの名前に `<領域>/AC-…` を入れる。ハーネスは Rust のファイルの中の ID を数えない
- 結果はすべて JUnit XML で reports/junit/ に出す（unit.xml、api.xml、e2e.xml、rust.xml、foundation.xml）。テストが 0 件でも成功にする（Vitest は passWithNoTests、Playwright は --pass-with-no-tests、nextest は --no-tests=pass）
- テストのコマンドは、末尾にテストのファイルを渡すと、そのファイルだけを流す。test-rust は、tests/run/rust.mjs が渡されたファイル（Cargo の workspace のどの crate でも、その crate の tests/<名前>.rs か tests/<名前>/main.rs）を、その crate と nextest の `binary(<名前>)` の絞り込みに変える

### テストの設定と支えの置き場所

- テストの設定：vitest.config.ts、playwright.config.ts、.config/nextest.toml、perf/playwright.config.ts
- テストの支え：tests/support/、tests/run/、e2e/support/
- これらはテストを書く役が書き、作る役は変えない（_tech/write-scopes.json）。Vitest の設定を vite.config.ts に混ぜない（共通のプラグインは apps/desktop/ の別のファイルから読む）

### 準備のデータ

- e2e と API のテストは、準備のデータを、画面が使うのと同じコマンド（tests/support/invoke.ts が試す場の `POST /api/invoke/<コマンド>` を呼ぶ）で入れる。Rust のテストは core の関数で入れる。テストに SQL を直に書かない（後片付けの削除も、データの置き場所ごと消すので SQL は要らない）
- 005 からのサーバーのデータも、Supabase の関数か、開発する人のコマンド（seed）と同じ関数で入れる

### 試す場をテストで使う

- 試す場は e2e の feature でビルドしたときだけ、テストのための受け口を持つ（ふだんのビルドとアプリには入らない）
  - データの分け方：画面の URL の `?profile=<ID>` か、HTTP の `x-test-profile` で、テストごとに別のデータの置き場所（OS の一時の場所の下）を使う。テストを並べて流してもデータが混ざらない
  - 時計：`POST /__test/profiles/<ID>/clock`（本文 `{ "at": "2027-05-12T16:00:00+09:00" }`）で、そのデータの置き場所の時計を決める。既定は tests/support/clock.ts の「今日」
  - わざと失敗させるコマンド：`__test_panic`（panic する）と `__test_fail`（想定外の失敗を返す）。失敗の返し方の確認に使う
- e2e の試す場は Asia/Tokyo の時間帯で動く（--tz Asia/Tokyo）。CI の機械の時間帯によらず同じ結果にする
- API のテストは、Vitest の globalSetup が試す場をビルドして 127.0.0.1:4312 に起こす

### e2e

- e2e は、ビルドした試す場（画面と処理）を Playwright の webServer で 127.0.0.1:4311 に起こして相手にし、コマンドを差し替えない（差し替えてよいのは、005 からの外のサービスだけ）。webServer は `node tests/run/devhost.mjs --e2e --port 4311`（画面と試す場のビルドを含む）。ビルドを待つ長さは webServer の timeout（10 分。初めての Rust のビルドを含む）に置く。reuseExistingServer は使わない
- projects

| 名前 | ブラウザ | 大きさ | 流すもの | スクリーンショット |
| --- | --- | --- | --- | --- |
| desktop | Chromium | 1280×800 | すべての e2e のファイル | 撮る（`--desktop`） |
| phone | Chromium | 390×844 | canvas.yaml の widths に phone がある画面のテスト（`@phone` の印を付けたもの） | 撮る（`--phone`） |
| webkit | WebKit | 1280×800 | すべての e2e のファイル | 撮らない（Mac の WKWebView に近い振る舞いの確認だけ） |

- 共通の設定：`locale: "ja-JP"`、`timezoneId: "Asia/Tokyo"`、`colorScheme: "light"`、`reducedMotion: "reduce"`。Chromium の projects はブラウザの起動に `launchOptions.args: ["--lang=ja-JP"]` を渡す（WebKit はこの引数を受けない）
- 待ち：テスト 1 件の待ちは道具の既定のまま。操作の待ち（actionTimeout）と移動の待ち（navigationTimeout）は 5 秒。expect の待ちは道具の既定のまま
- Red の印（環境変数 `AIDD_RED=1`）があるときだけ、操作の待ちと expect の待ちを 1.5 秒にし（移動の待ちは 5 秒のまま）、projects を desktop だけにする。desktop はすべての e2e のファイルを流すので、Red の回にもどの e2e のファイルも流れる。Red の印は run-capture.mjs が付ける。テストを書く役が、run-capture の前に自分で流して Red を確かめる回にも付ける
- 出力：Playwright の出力先は test-results/e2e/。JUnit は reports/junit/e2e.xml
- ブラウザ：プロジェクトの中の `.browsers/` に入れる（.gitignore）。node_modules の中には置かない。準備のコマンド、e2e のテストのコマンド（tests/run/e2e.mjs）、CI、計測に `PLAYWRIGHT_BROWSERS_PATH=<リポジトリ>/.browsers` を渡す。入れるのは `npm run browsers`（中身は `npx playwright install chromium webkit`。`--with-deps` は付けない）

### スクリーンショット

- e2e は振る舞いを確かめ、スクリーンショットを撮るだけにする。見た目の比較はテストの中に書かない（ハーネスの検証が、受け入れた見た目の基準と比較する。比較は手元の検証だけで行い、CI は撮るだけ）
- 撮る関数は e2e/support/shoot.ts。画面ごとに `e2e-screenshots/<領域>--<SCR の ID>--<幅>.png`、画面例ごとに `e2e-screenshots/<領域>--<SCR の ID>--<AC の ID>--<幅>.png` に出す（幅は project の名前。例 `pages--SCR-tree--desktop.png`）。webkit の project では撮らない
- `e2e-screenshots/` は .gitignore に入れ、Playwright の出力先の下に置かない（Playwright は実行のたびに出力先を空にする）。基盤の検査も e2e-screenshots/ を消さない（自分の見本の画像だけを消す）
- 撮る前に揺れを止める
  - 処理の時計を、そのテストの具体例の「今日」に固定する（上の時計の受け口）
  - ブラウザの時計は、移動の前に `page.clock.install({ time: <具体例の今日> })` で入れる（ほかの時計の呼び出しより先に呼ぶ）
  - 動きは `reducedMotion: "reduce"` で止める
  - 書体の読み込みを `await page.evaluate(() => document.fonts.ready)` で待つ
- 画面の下に固定した部品（bottom を指定した sticky と、下に近い fixed）があり、ページが画面より高い画面は、撮る関数が、まず最初の 1 画面（画面の大きさの分だけ）を名前の末尾に `--top` を付けて撮り（例 `pages--SCR-tree--phone--top.png`）、次に `.claude/aidd/lib/pin-fixed.mjs` の `findPinned`、`pinToBottom` を `page.evaluate` に渡して部品をページの下端に置いてから全体を撮り、撮った後に `unpin` で戻す（型は `pin-fixed.d.mts`）
- 見た目の回帰テストで違いとみなす画素の割合は toolchain.yaml の visual_threshold（0.001）。基準は OS ごと（`-mac`、`-win`）に持つ

### 動きのテスト

- 動きのある画面（design.yaml の motion を使う画面）を確かめる e2e は、`page.emulateMedia({ reducedMotion: "no-preference" })` で動きを減らす設定を外す
- JS で作る動きは Playwright の時計（`page.clock.install()`。requestAnimationFrame と performance も差し替える）で確かめる。install は、ほかの時計の呼び出しより先に呼び、時刻をその具体例の今日にする（時計の固定とぶつけないため）。進めるのは `page.clock.runFor()`

### 計測

- どの OS で測るか：計測は、流した機械の OS（Mac か Windows）で測る。最後の行に、OS とブラウザの仕組みごとの値を書く。もう一方の OS の速さは、NFR-polished-look の人の確認（Mac と Windows でアプリを開いて触る）で見る
- 画面の中の速さ：perf/ に Playwright で書く（perf/playwright.config.ts。desktop の幅）。Chromium（Windows の WebView2 と同じ仕組み）と WebKit（Mac の WKWebView に近い仕組み）の両方で測り、どちらも基準の中に収まることを求める。試す場を e2e の feature で起こし、準備のコマンドでページを 1 万件入れてから測る。試す場は HTTP でコマンドを呼ぶので、アプリの invoke より遅い側に出る（基準に収まれば、アプリでも収まる）
- アプリの起動の速さ：窓と WebView を起こす時間は試す場では測れないので、リリースのビルドのアプリそのものを起こして測る。アプリは、起動の引数 `--measure-startup` を受けたときだけ、処理が始まった時刻から、画面がページの並び（001 では土台の画面）を描き終えたと知らせるまでの時間を標準出力に書いて終わる。計測のスクリプトはこれを 5 回流し、中央値を 1 秒の基準と比べる
- `npm run measure-response`（NFR-response-time）：上のアプリの起動と、ページを開く、検索の結果、ボタンの結果、キーを打って文字が出るまで（Event Timing の duration）を、作った機能の分だけ測る。測る場面はチケットごとに足す（001 は、アプリの起動して土台の画面が出るまでと、試す場で土台の画面が出るまで）
- `npm run measure-sync`（NFR-sync-delay）：2 つの試す場の間で、片方の書き換えがもう一方に出るまでを測る。測る場面は 006 で足す。場面が 0 件のときは「計測する場面はまだありません」と出して成功で終える
- 数が基準を超えたら終了コード 1。最後の行に、測った値と基準を 1 行で書く

### カバレッジ

- `npm run coverage`（scripts/coverage.mjs）が、cargo llvm-cov show-env の環境で試す場をビルドし、Vitest の unit と api を v8 のカバレッジ付きで流し、cargo nextest を流してから、TypeScript と Rust の報告を coverage/ に出す。unit、api、rust のテストはこの回にも流れる
- 除くもの：apps/desktop/src/main.tsx、apps/desktop/src-tauri/（窓の組み立て）、crates/devhost/src/main.rs、設定のファイル、packages/protocol/src/generated/

## 開発環境と人が行う準備

人が一度だけ行うこと：

| | Windows | Mac |
| --- | --- | --- |
| Rust | rustup（https://rustup.rs）。版は rust-toolchain.toml で自動で揃う | 同じ |
| C と C++ のビルドの道具 | Microsoft C++ Build Tools（「C++ によるデスクトップ開発」） | Xcode Command Line Tools（`xcode-select --install`） |
| WebView | WebView2（Windows 11 には入っている） | 要らない（OS にある） |
| Node.js | .node-version の版 | 同じ |
| Docker | Docker Desktop（005 から使う） | 同じ |
| Supabase の CLI | 005 で npm の依存として入る | 同じ |

その後、リポジトリで `npm run setup`（scripts/setup.mjs）を流す。中身：`npm ci`、`npm ci --prefix .claude/aidd`、`rustup show`（rust-toolchain.toml の版と部品を入れる）、cargo-nextest、cargo-llvm-cov、cargo-audit を入れる（`cargo install --locked`。版は scripts/setup.mjs に書く）、`npm run browsers`（.browsers/ に Chromium と WebKit を入れる）、`cargo fetch`。

- コマンドは、Windows の cmd.exe と Mac の sh のどちらで流しても同じに動く形にする（toolchain.yaml のコマンドはすべて `npm run <名前>`。環境変数を渡すときは、`VAR=値 コマンド` と書かず、node のスクリプトか CLI の引数で渡す）
- 改行は .gitattributes で LF に揃える
- 人が試すデータ（.data/）、ビルドの出力、テストの出力は .gitignore に入れる

## CI

- ファイル：.github/workflows/ci.yml
- きっかけ：pull_request（向け先が main と `aidd/**`。types は opened、synchronize、reopened、ready_for_review）と、main への push。下書きの PR では流さない（ジョブに `if: github.event_name == 'push' || github.event.pull_request.draft == false`）。コミットの文に `[skip ci]` のある push では流れない（GitHub の決まり）
- 道具の決まり：検証のコマンドが要る道具（Chromium と WebKit、cargo-nextest、cargo-llvm-cov、cargo-audit、rust-toolchain.toml の部品）は、手元では `npm run setup`、CI では各ジョブの準備の段で入れる。CI のどのジョブも、そのジョブで流すコマンドが要る道具をすべて入れる。ブラウザは、手元でも CI でも `npm run browsers`（scripts/browsers.mjs。.browsers/ に Chromium と WebKit を入れる）で入れる。基盤の検査（test-foundation）は見本の単体、API、Rust、e2e を流すので、すべての道具と試す場のビルドが要る
- 機械：GitHub の Mac（macos-latest）と Windows（windows-latest）。NFR-platforms のとおり、すべてのテストを両方で流す。Playwright の公式のコンテナのイメージは Linux だけなので使わない（コンテナを使う理由の、OS のパッケージを入れる段で止まることは、Mac と Windows の機械では起きない。ブラウザだけを .browsers/ に入れる）
- ジョブ
  - checks（matrix：macos-latest、windows-latest）：`npm ci`、`npm ci --prefix .claude/aidd`、cargo の道具を入れる、`npm run browsers`（.browsers/ のキャッシュ付き）、lint、typecheck、build、coverage（unit、api、rust のテストを流す回。別に流さない）、test-foundation、start-check、audit。`node .claude/aidd/bin/traceability-check.mjs --stage baseline` は windows-latest のときだけ 1 回流す
  - e2e（matrix：macos-latest、windows-latest × shard 1/2、2/2）：`npm ci`、`npm run browsers`（.browsers/ のキャッシュ付き）、`npm run test-e2e -- --shard=<n>/2`。スクリーンショットは撮るだけで比較しない
- 時間の上限：checks は `timeout-minutes: 30`（キャッシュの無い初めての Rust のビルドが 15 分を超えることがあるため）、e2e は `timeout-minutes: 20`
- キャッシュ：actions/setup-node の `cache: npm`、Swatinem/rust-cache（OS ごと）、.browsers/（キーは OS と package-lock.json の Playwright の版）。cargo-nextest などの道具は taiki-e/install-action で入れる（ビルドしないので速い）
- PLAYWRIGHT_BROWSERS_PATH に `${{ github.workspace }}/.browsers` を渡す
- データベースのサービス：005 から、サーバーが要るテストのために置く。GitHub の Mac と Windows の機械では Linux のコンテナの Docker を動かせないので、置き方は問い Q-003 の答えと 005 の計画で決める
- main への push の CI も、同じ形で残す
- 費用：非公開のリポジトリの GitHub Free の無料の枠は月 12 ドル分。1 分あたり Mac 0.062 ドル、Windows 0.010 ドル。1 回の CI を Mac 約 25 分、Windows 約 30 分と見込むと約 2 ドルで、無料の枠では月に 6 回ほどしか流せない。足りない分の扱いは問い Q-003 の答えで決める

## リリースとデプロイ

- main へのマージでは、CI のほかに何も動かない。サーバーにもアプリの配布にも何も起きない
- アプリ：版の印（`v` で始まるタグ。例 `v0.1.0`）を付けて GitHub に送ったときだけ、.github/workflows/release.yml が Mac（macos-latest。.dmg。`--target universal-apple-darwin` で、Apple Silicon と Intel のどちらの Mac でも動く 1 つのアプリにする。そのために rustup で aarch64-apple-darwin と x86_64-apple-darwin を入れる）と Windows（windows-latest。.msi と .exe）のアプリを tauri-apps/tauri-action でビルドし、GitHub の下書きのリリースに置く。版の番号は、タグの版を tauri.conf.json と Cargo.toml の版に揃えてから付ける
- 署名はしない（Mac は初めて開くときに右クリックの「開く」が要り、Windows は SmartScreen の知らせが出る）。署名と公証をするかは 008 で決める
- 新しい版は、自分で下書きのリリースから入れ直す。自動のアップデートは、一般に配るとき（later の public-distribution）に足す（001 の問い Q-002 の答え）
- サーバーのデプロイ：後で決める（008-start-using。本番の Supabase のプロジェクトの作り方、表の移し替えを本番に当てるコマンド、切り戻しの方法）。決めるきっかけは、自分がコマンドを打つか印を付けたときだけにし、main へのマージでは動かさない（001 の壁打ち）

## 依存の版の範囲

- npm：package.json は `^`（同じメジャー版の中）。版は package-lock.json で固める。ただし @playwright/test は `~`（同じマイナー版の中。版ごとにブラウザとスクリーンショットが変わるため）
- Rust の crate：Cargo.toml の workspace.dependencies に、Cargo の既定（同じメジャー版の中。0.x は同じマイナー版の中）で書く。版は Cargo.lock で固める（コミットする）
- 主なもの：Tauri 2.x、React 19.x、Vite、Vitest、Playwright 1.x、yrs と yjs（同じ版の系統で揃える）、rusqlite、axum、jiff
- Rust の版は rust-toolchain.toml で 1 つに固め、Node.js は .node-version でメジャー版を固める。これらを変えるのは開発環境の変更として扱う
- この範囲の中の更新は仕様の差分が無いので、今あるものへの影響の一覧に出ない。範囲を超える更新と入れ替えは、今ある技術の選択を変えるので一覧に出る
