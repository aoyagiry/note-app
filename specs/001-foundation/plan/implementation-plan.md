# 計画

## テストが呼ぶ形（約束）

テストを書く役と作る役の両方が従う。001 には画面の要件（SCR）が無いので、撮るテストは基盤の見本（`zztmp--SCR-sample`）だけで、`screen_paths` と `try_at` は書かない。

### 1. npm のコマンド（package.json の scripts。作る役が書く）

toolchain.yaml のコマンドは、すべてここに置く。テストのコマンドは、テストを書く役が書く `tests/run/` の node のスクリプトを呼ぶだけにする（テストの流し方、JUnit の出し先、Red の印、ブラウザの置き場所は、テストを書く役が持つ）。末尾に渡したファイルは、そのままスクリプトに渡る。

| 名前 | 中身 |
| --- | --- |
| test-unit | `node tests/run/vitest.mjs unit` |
| test-api | `node tests/run/vitest.mjs api` |
| test-foundation | `node tests/run/vitest.mjs foundation` |
| test-rust | `node tests/run/rust.mjs` |
| test-e2e | `node tests/run/e2e.mjs` |
| gen | `cargo run -q -p app-protocol --bin gen-types`（packages/protocol/src/generated/ に TypeScript の型を出す） |
| build:web | gen の後に `vite build`（apps/desktop/dist/ に出す） |
| build | build:web の後に `cargo build --release -p app-devhost`（target/release/devhost） |
| serve | `node scripts/serve.mjs`（target/release/devhost を `serve --port 4310 --data .data/dev --dist apps/desktop/dist` で起こす。末尾の `--clock <日時>` はそのまま devhost に渡す） |
| seed | `node scripts/seed.mjs`（`cargo run --release -p app-devhost -- seed --data .data/dev`。build の前でも動く） |
| dev:web | `vite`（127.0.0.1:1420、strictPort。tauri dev の beforeDevCommand） |
| app | `tauri dev`（@tauri-apps/cli） |
| lint | `eslint .`、`prettier --check .`、`cargo fmt --all --check`、`cargo clippy --workspace --all-targets --all-features -- -D warnings` |
| typecheck | gen の後に `tsc --noEmit -p tsconfig.json` |
| audit | `npm audit --audit-level=high` と `cargo audit` |
| coverage | `node scripts/coverage.mjs` |
| start-check | `node scripts/start-check.mjs` |
| measure-response | `node scripts/measure-response.mjs` |
| measure-sync | `node scripts/measure-sync.mjs`（「計測する場面はまだありません」と出して 0 で終わる） |
| setup | `node scripts/setup.mjs` |
| browsers | `node scripts/browsers.mjs` |

### 2. Rust の crate の名前（テストの支えが Cargo.toml を読んで使う）

| フォルダ | package の名前 | lib の名前 | 作るもの |
| --- | --- | --- | --- |
| crates/core | app-core | app_core | 処理（001 は時計とデータの置き場所だけ） |
| crates/commands | app-commands | app_commands | dispatch と記録の始め方 |
| crates/devhost | app-devhost | — | 実行ファイル `devhost`（`[[bin]] name = "devhost"`） |
| crates/protocol | app-protocol | app_protocol | データの形と、型を出す実行ファイル `gen-types` |
| apps/desktop/src-tauri | app-desktop | app_desktop | Tauri のアプリ（lib と実行ファイル `app-desktop`） |

- feature `e2e`：app-commands（`__test_panic` と `__test_fail` を足す）、app-devhost（`e2e = ["app-commands/e2e"]`。テストの受け口を足す）、app-desktop（`e2e = ["app-commands/e2e"]`）。テストの Rust は `--workspace --all-features` で流す
- app-desktop の dev-dependencies に `tauri`（features `test`）を入れる

### 3. コマンド（dispatch。試す場とアプリで同じ）

`app_commands::dispatch(core: &app_core::Core, name: &str, args: serde_json::Value) -> Result<serde_json::Value, app_protocol::CommandError>`

| 名前 | 引数 | 結果 |
| --- | --- | --- |
| now | `{}`（読まない） | `{ "at": "2027-05-12T16:00:00+09:00" }`。処理の時計の今を、パソコンの時間帯（試す場は `--tz` があればその時間帯）の時差付きで、秒まで（小数は切り捨て）の RFC 3339 で返す |
| __test_panic（feature e2e だけ） | `{}` | panic する（文 `test panic requested`）。dispatch が `{ "kind": "internal", "reason": "internal" }` に変える |
| __test_fail（feature e2e だけ） | `{}` | 想定外の失敗（anyhow。文 `test failure requested`）を返す。dispatch が internal に変える |
| 上のどれでもない名前 | — | `{ "kind": "not_found", "reason": "unknown_command" }`（PD-001） |

- 失敗の形：`CommandError { kind: ErrorKind, reason: String }`。ErrorKind は `not_found`、`rejected`、`conflict`、`forbidden`、`unauthenticated`、`internal`（serde の snake_case）。`fields` は、欄ごとの誤りを返す最初のチケットで足す
- internal に変えた失敗の詳細（anyhow の文の連なり、panic の文と場所）は、記録（tracing の error）にだけ書く

### 4. 試す場（crates/devhost の実行ファイル devhost）

起動の形（引数は手で読む。clap は入れない）：

- `devhost serve --port <番号> --dist <画面のビルドのフォルダ> [--data <フォルダ>] [--clock <日時>] [--tz <IANA の時間帯>] [--log-dir <フォルダ>]`
  - 127.0.0.1 だけで待つ。`--data` の既定は `.data/dev`、`--log-dir` の既定は `<data>/logs`
  - `--clock`：時差か時間帯の付いた日時はその時刻、付かない日時（`2027-05-12T16:00`）は `--tz`（無ければパソコンの時間帯）の時刻として、時計を止める
  - 起きたら標準出力に `listening on http://127.0.0.1:<番号>` を 1 行書く
- `devhost seed [--data <フォルダ>]`：架空のデータを入れて終わる（001 は入れるものが無く、データの置き場所を作るだけ）

HTTP：

| 道 | 返すもの |
| --- | --- |
| `GET /`、`GET /<ファイル>` | `--dist` の下のファイル（`/` は index.html）。無ければ 404 |
| `POST /api/invoke/<コマンド>` | 本文は引数の JSON（引数が無ければ `{}`）。成功は 200 と結果の JSON。失敗は失敗の形の JSON と、kind ごとの状態コード（not_found 404、rejected 422、conflict 409、forbidden 403、unauthenticated 401、internal 500）。`content-type: application/json`。応答の見出しに道具の名前と版を入れない |

feature e2e でビルドしたときだけ、次が足される。

| 道か印 | 中身 |
| --- | --- |
| データの分け方 | 要求の見出し `x-test-profile: <ID>`、無ければクッキー `aidd-test-profile`。画面を `/?profile=<ID>` で開くと、その応答がクッキー `aidd-test-profile=<ID>`（Path=/）を付ける（PD-004）。ID は英数字、`-`、`_` の 64 文字まで。どちらも無いときは `--data` の置き場所を使う。データの置き場所は OS の一時の場所の下に、devhost の起動ごとのフォルダを作り、その下に ID ごとに作る（PD-005） |
| `POST /__test/profiles/<ID>/clock` | 本文 `{ "at": "2027-05-12T16:00:00+09:00" }`（時差付き）。その置き場所の時計をその時刻で止める。204 |
| `POST /__test/shutdown` | 204 を返してから、受け付けをやめて正しく終わる（一時の置き場所を消し、記録を閉じる）（PD-006） |
| `--tz` | e2e、API、計測、基盤の検査で起こす試す場は、`--tz Asia/Tokyo` を付ける |

### 5. Rust の関数（テストの Rust と、二つの入口が使う）

- `app_core::Clock`：`Clock::system()`（パソコンの時間帯）、`Clock::in_zone(tz: jiff::tz::TimeZone)`、`clock.freeze(at: jiff::Timestamp)`、`clock.now() -> jiff::Zoned`。Send と Sync（中の止めた時刻は RwLock）
- `app_core::Core`：`Core::open(data_dir: PathBuf, clock: Clock) -> anyhow::Result<Core>`（フォルダが無ければ作る）、`core.clock() -> &Clock`
- `app_commands::init_logging(dir: &Path, file_prefix: &str, also_stderr: bool) -> anyhow::Result<()>`：tracing-appender の日ごとのファイル（`<file_prefix>.YYYY-MM-DD`）に書き、panic の hook を tracing の error に差し替える（PD-007、PD-008）。devhost は `devhost.log`、アプリは `app.log`
- `app_desktop::configure<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R>`：`invoke_command` だけを登録する。状態の `app_core::Core` は呼ぶ側が `.manage()` で渡す（アプリは setup でアプリのデータの置き場所から、テストは一時のフォルダから）
- `invoke_command(name: String, args: serde_json::Value) -> Result<serde_json::Value, CommandError>`：async の Tauri のコマンド。dispatch に渡して、返ったものをそのまま返す（PD-013）
- テストの形（AC-errors-3）：`app_desktop::configure(tauri::test::mock_builder()).manage(core).build(tauri::test::mock_context(tauri::test::noop_assets()))` の窓に、`tauri::test::get_ipc_response` で `cmd: "invoke_command"`、本文 `{ "name": …, "args": {} }` を送る。失敗は `Err(<失敗の形の JSON>)` で返る

### 6. 画面の側（TypeScript）

- `apps/desktop/src/bridge/invoke.ts`：`invoke<T>(name: string, args?: Record<string, unknown>): Promise<T>`。呼ぶたびに `"__TAURI_INTERNALS__" in window` を見て、あれば `@tauri-apps/api/core` の `invoke("invoke_command", { name, args: args ?? {} })`、無ければ同じ origin の `POST /api/invoke/<name>`（本文 `JSON.stringify(args ?? {})`、`content-type: application/json`）。失敗は、Tauri なら返った値を、HTTP なら 2xx でない応答の本文の JSON を、そのまま reject する（PD-011）
- `apps/desktop/src/bridge/ready.ts`：`notifyRendered(): void`。画面が最初に描き終えたら App が 1 回呼ぶ。Tauri の中ならイベント `app-rendered` を emit、ブラウザなら `performance.mark("app-rendered")`（PD-012）
- `apps/desktop/src/ui/Text.tsx`：`<Text id="…" values={{ name: … }} />` と `text(id: string, values?: Record<string, string | number>): string`（PD-009、PD-010）
- `apps/desktop/texts-plugin.ts`：`loadTexts(specsCurrentDir: string): Record<string, string>`（`<dir>/*/texts.yaml` をすべて読む。ID が重なれば、重なった ID を文に入れて throw）と、Vite のプラグイン `textsPlugin(options?: { dir?: string })`（`virtual:texts` の既定の書き出しが ID から文への表。dir の既定は `specs/_current`）
- `apps/desktop/vite.shared.ts`：`sharedPlugins()`（react と textsPlugin）と `sharedAlias`（`@protocol` → `packages/protocol/src/index.ts`）。vite.config.ts と vitest.config.ts の両方がここから読む
- `packages/protocol/src/index.ts`：生成した型（`Now`、`CommandError`、`ErrorKind`）を出し直す。画面とテストは `@protocol` から読む
- `apps/desktop/index.html`：`<html lang="ja">`、`<div id="root"></div>`、`<script type="module" src="/src/main.tsx">`
- `apps/desktop/src/main.tsx` の先頭の import は、この順の副作用の import：`@fontsource/zen-maru-gothic/400.css`、`500.css`、`700.css`、`900.css`、`@fontsource/nunito/500.css`、`700.css`、`./styles/tokens.css`、`./styles/base.css`。その後に App などの import（AC-design-base-2）
- 土台の画面（001）：App が `<main>` を 1 つ描くだけ（中身の文は無い）。描き終えたら notifyRendered を呼ぶ

### 7. テストの支え（テストを書く役が書き、後のチケットも使う）

- `tests/run/devhost.mjs [--e2e] --port <番号> [devhost の serve の引数…]`：`npm run build:web` の後に、`--e2e` なら `cargo build -p app-devhost --features e2e`（debug）でビルドし、`serve --port <番号> --dist apps/desktop/dist --tz Asia/Tokyo` に、データと記録の置き場所を OS の一時の場所に向けて起こす。CARGO_TARGET_DIR があればその下の実行ファイルを使う（カバレッジの回）
- ポート（PD-016）：人の試す場 4310、e2e 4311、API 4312、計測 4313、基盤の検査が自分で起こす試す場 4314
- `tests/support/invoke.ts`（`invoke(name, args, { profile })`。試す場の HTTP を呼ぶ）、`tests/support/clock.ts`（テストの「今日」`2027-05-12T10:00:00+09:00` と、置き場所の時計を決める関数）
- API の globalSetup：`tests/run/devhost.mjs --e2e --port 4312` を起こし、`POST /api/invoke/now` が答えるまで待つ。後片付けは `POST /__test/shutdown`（カバレッジの記録を書かせるため。子のプロセスを殺さない）
- `e2e/support/shoot.ts`：`shoot(page: Page, name: string): Promise<void>`。name は `<領域>--<SCR の ID>[--<AC の ID>]`。`e2e-screenshots/<name>--<project の名前>.png` に出し、webkit の project では撮らない。architecture.md のスクリーンショットの節（揺れを止める、下に固定した部品）のとおり
- 計測の結果（PD-019）：perf/ の計測は、場面ごとに `reports/perf/<場面>--<ブラウザ>.json` に `{ "scene", "browser", "median_ms", "limit_ms" }` を書く。001 の場面は `devhost-startup`（`/` を開いてから `performance.getEntriesByName("app-rendered")` までを 5 回測った中央値。基準 1000）

### 8. 基盤の検査（specs/_current/_tech/checks/）が見るもの

- AC-dev-env-2 と 3 は toolchain.yaml の start の command と clock をそのまま流す。AC-dev-env-3 は、now の `at` の時差の前が `2027-05-12T16:00:00` で、時差が node から見たパソコンの時間帯のその日時の時差と同じことを見る。起こしたものは、プロセスの木ごと止める（Windows は `taskkill /pid <番号> /T /F`、Mac はプロセスのグループに送る）
- AC-errors-1 と 2 は `tests/run/devhost.mjs --e2e --port 4314 --log-dir <一時のフォルダ>` で起こし、記録はそのフォルダの `devhost.log.*` を読む。AC-errors-3 は `npm run test-rust -- apps/desktop/src-tauri/tests/<名前>.rs` を流して結果を見る
- AC-structure-4 の bridge の確かめは、unit の project（jsdom）で `@tauri-apps/api/mocks` の `mockIPC` と、fetch の差し替えで行う。Tauri のアプリが登録するコマンドが invoke_command だけであることは、AC-errors-3 と同じ mock の窓で、別の名前のコマンドを呼ぶと断られることで見る

## 変え方の方針（案内）

リポジトリにはまだコードが無いので、architecture.md の標準のファイル構成のとおりに、すべて新しく作る。

- 処理の入口を 1 つにする：アプリ（invoke_command）と試す場（`POST /api/invoke/<コマンド>`）は、受けた名前と JSON を `app_commands::dispatch` に渡すだけにする。名前の振り分け、引数の読み取り、失敗の写し方、`catch_unwind`（`AssertUnwindSafe`）で panic を internal に変えることは、すべて dispatch の中に置く。状態コードへの写し方だけは試す場に置く。リリースのビルドの profile に `panic = "abort"` を書かない（書くと catch_unwind が効かない）
- 時計：core の Clock を、試す場の `--clock`、テストの受け口、コマンド now が同じく使う。試す場はデータの分け方の ID ごとに `Arc<Core>` を持つ（表は `Mutex<HashMap<…>>`）
- 001 で作らないもの：SQLite、yrs、rusqlite_migration は、最初にページを保存する 002 で入れる（001 には保存するものが無い）。`<html>` の data-theme（明るさ）を決めることと、data-sky（時刻の空）を付けることも作らない。明るさの切り替えは 002 の範囲で、空は空を描く画面のチケットで、Text のときと同じく部品とテストを足す
- 見た目の共通の値と土台の CSS：`apps/desktop/src/styles/tokens.css` を `_tech/design.yaml` の値から写す（`_tech/ds/sunlit-play/tokens.css` から Google Fonts の `@import` の行を除いた形と同じになる。値は design.yaml が正。breakpoint、sky_times、text_rules、name、url、mood は写さない）。`apps/desktop/src/styles/base.css` は `_tech/ds/sunlit-play/base.css` の中身をそのまま写す。`.gitattributes` に `* text=auto eol=lf` を置いて、Windows でも改行が変わらないようにする
- 書体：Fontsource の `@fontsource/zen-maru-gothic`（400、500、700、900）と `@fontsource/nunito`（500、700）を main.tsx で読む。デザインシステムの tokens.css と同じ太さ
- 画面文：texts-plugin が `specs/_current/*/texts.yaml` を読む。001 には texts.yaml が 1 つも無いので、表は空で動く（無いことを失敗にしない）。`virtual:texts` の型の宣言（`apps/desktop/src/texts/virtual-texts.d.ts`）と、表を引く所（`apps/desktop/src/texts/index.ts`）を置く。Text.tsx は、表の文を `{名前}` で分け、値の部分を `<span data-value>` で包み、値でない部分だけを BudouX（`loadDefaultJapaneseParser()` を 1 度だけ作って使い回す）で分けて、文節の間に `<wbr>` を入れる
- 起動の速さを測る：アプリは `--measure-startup` を受けたときだけ、main の最初に取った時刻から、画面の `app-rendered` を受けるまでの時間を、標準出力に `startup_ms=<整数>` で書いて終わる。`scripts/measure-response.mjs` が `tauri build --no-bundle` でリリースのビルドを作って 5 回流した中央値と、`npx playwright test -c perf/playwright.config.ts` が書いた `reports/perf/*.json` をまとめ、最後の行に「場面、OS かブラウザ、中央値、基準」を 1 行で書き、どれかが基準を超えたら 1 で終わる
- カバレッジ：`scripts/coverage.mjs` が、`cargo llvm-cov show-env` の出力の環境を子のプロセスに渡し、`cargo llvm-cov clean --workspace` の後に、`vitest run --project unit --project api --coverage.enabled`（TypeScript の報告は coverage/ts）、`cargo nextest run --workspace --all-features --no-tests=pass` を流し、`cargo llvm-cov report` で coverage/rust（lcov と html）を出す。Rust の除くもの（`apps/desktop/src-tauri/`、`crates/devhost/src/main.rs`）は report の `--ignore-filename-regex` で外す。API のテストの試す場は shutdown の受け口で正しく終わるので、試す場の分も Rust の報告に入る（PD-006）
- start-check：`scripts/start-check.mjs` が、`npm run seed` の後に `scripts/serve.mjs` を起こし、`GET /` が 200 で `id="root"` を含むことと、`POST /api/invoke/now` が 200 で答えることを確かめて止め、0 で終わる（だめなら 1）。build は前のコマンドで済んでいる前提（toolchain.yaml の順）
- Tauri のアプリ：`tauri.conf.json` は、窓 1280×800、devUrl `http://127.0.0.1:1420`、frontendDist `../dist`、beforeDevCommand `npm run dev:web`、beforeBuildCommand `npm run build:web`。version は書かず、Cargo の workspace の版を使う（PD-015）。名前と識別子は仮のもの（PD-014）、アイコンも仮のもの（PD-017）。capabilities は `core:default` だけ。自動のアップデート（updater の plugin）は入れない（008 の作らないもの）。cargo の clippy と nextest は tauri の custom-protocol を付けずに流れるので、画面のビルド（dist）が無くても通る見込み。通らなければ、lint の前に build:web を流す形にして報告に書く
- 型の生成：ts-rs の `#[ts(export)]` は使わない（src の中にテストが生まれ、nextest が流してしまう）。`crates/protocol/src/bin/gen-types.rs` が、使っている ts-rs の版の書き出しの関数（Context7 で確かめる）で `packages/protocol/src/generated/` に出す（PD-018）。生成したものは .gitignore に入れる
- 書き方の決まり：`.prettierrc` は `{ "printWidth": 120 }`（ほかは既定）。ESLint は typescript-eslint の recommended（型の情報を使わない形）と、`apps/desktop/src/` に react-hooks。eslint と prettier は `specs/`、`.claude/`、生成した型、ビルドとテストの出力を見ない（.prettierignore と eslint の ignores）。tsconfig は apps、tests、e2e、perf、`specs/_current/_tech/checks/`、設定のファイルの TypeScript を含め、`strict`、moduleResolution `bundler`
- 依存：package.json の dependencies に react、react-dom、@tauri-apps/api、budoux、@fontsource/zen-maru-gothic、@fontsource/nunito。devDependencies に typescript、vite、@vitejs/plugin-react、vitest、@vitest/coverage-v8、jsdom、@playwright/test（`~`）、@tauri-apps/cli、eslint、@eslint/js、typescript-eslint、eslint-plugin-react-hooks、prettier、yaml（画面文と design.yaml を読む）、@types/react、@types/react-dom、@types/node。Cargo の workspace.dependencies に tauri、tauri-build、axum、tokio、serde、serde_json、anyhow、jiff、tracing、tracing-subscriber、tracing-appender、ts-rs。どれも技術の選択の付き物で、選択を変えるライブラリは足さない（静的なファイルを配るのも tower-http を入れずに手で書く。PD-020）。テストを書く役も、テストのための新しいライブラリ（Testing Library など）を足さない（React の描画は react-dom で行う）
- 版：`.node-version` は `24`（手元の v24.5.0 の LTS の系統）。`rust-toolchain.toml` は作るときの最新の stable の版を 1 つ書き、components に clippy、rustfmt、llvm-tools-preview。`scripts/setup.mjs` が `cargo install --locked` で入れる cargo-nextest、cargo-llvm-cov、cargo-audit の版を書く
- CI とリリース：architecture.md の CI とリリースの節のとおりに `.github/workflows/ci.yml` と `release.yml` を書く。e2e のジョブも試す場をビルドするので、Rust の道具と rust-cache を入れる。release.yml は Mac で rustup に aarch64-apple-darwin と x86_64-apple-darwin を足し、tauri-action に `--target universal-apple-darwin` を渡す。きっかけに pull_request_target を使わない
- README.md：人が一度だけ行う準備、`npm run setup`、人が画面を開く手順（build、serve、`--clock`、app）、版の印の付け方（Cargo.toml の workspace の版を揃えてからタグを付ける）を書く

### 影響の一覧（status.yaml の affects）への影響

- 002-page-tree の範囲に明るさの切り替えが足された：001 は `<html>` に data-theme を付けない（tokens.css は明るい地を `:root` に、暗い地を `[data-theme="dark"]` に持つので、001 の土台の画面は明るい地で出る）。端末の設定に合わせることと、選んだ明るさを持つことは、002 が作る
- 008-start-using の範囲に、自分で入れ直すことと、自動のアップデートを作らないことが足された：001 の release.yml は、版の印で .dmg、.msi、.exe を下書きのリリースに置くだけで、updater の plugin も更新の情報のファイルも作らない
- FACT-rust の書き足し（処理は Rust、画面は Web の技術）：この計画はそのとおりに分ける。処理は crates/ の Rust、画面は apps/desktop/src の TypeScript で、画面は bridge からしか処理を呼ばない

## 作る順番と触るつもりのファイル（案内）

外れてよく、外れたら作る役が報告に書く。

1. テストを書く役：テストの設定とテストの支え。`vitest.config.ts`（projects の unit、api、foundation。`apps/desktop/vite.shared.ts` の sharedPlugins と sharedAlias を読む。passWithNoTests。カバレッジの include と除くもの）、`playwright.config.ts`（architecture.md の e2e の節のとおり。webServer は `node tests/run/devhost.mjs --e2e --port 4311`、timeout 10 分）、`.config/nextest.toml`（JUnit を出す profile）、`perf/playwright.config.ts`（Chromium と WebKit、1280×800、webServer はポート 4313）、`tests/run/vitest.mjs`、`tests/run/rust.mjs`、`tests/run/e2e.mjs`、`tests/run/devhost.mjs`、`tests/support/invoke.ts`、`tests/support/clock.ts`、`tests/support/api-setup.ts`（globalSetup）、`e2e/support/shoot.ts`、`e2e/support/fixtures.ts`（ID ごとのデータの置き場所で画面を開く）。すべてテストを書く役の範囲（tests/**、e2e/**、perf/**、vitest.config.ts、playwright.config.ts、.config/nextest.toml）
2. テストを書く役：基盤の検査 `specs/_current/_tech/checks/*.test.ts`（acceptance.yaml の checked_by: test のすべて。CORE の範囲）。決め事のテスト：`tests/api/devhost.test.ts`（001/PD-001、PD-003、PD-004）、`apps/desktop/src/ui/Text.test.tsx`（001/PD-009）、`apps/desktop/src/texts/load-texts.test.ts`（001/PD-010。一時のフォルダに texts.yaml を置いて loadTexts を呼ぶ）、bridge のテスト `apps/desktop/src/bridge/invoke.test.ts`、Tauri のテスト `apps/desktop/src-tauri/tests/invoke_command.rs`、計測 `perf/startup.perf.ts`。Prettier の既定に printWidth 120 を足した形で書く（package.json がまだ無いので、`npx --yes prettier@3 --print-width 120 --write <ファイル>` で整える）。eslint の recommended に当たる書き方（未使用の変数、any）を避ける。Red は、package.json と雛形がまだ無いことによる失敗でよい（test-generation の基盤づくりのとき）。`red-result.md` と `red-run.json` を書く
3. 作る役：開発環境の定義。`package.json`、`.node-version`、`rust-toolchain.toml`、`Cargo.toml`（workspace と workspace.dependencies、workspace.package.version）、`scripts/setup.mjs`、`scripts/browsers.mjs`、`.gitattributes`、`.gitignore`（AC-structure-1 の行と、`packages/protocol/src/generated/`、`reports/`）。この時点で Rust（rustup）と C++ のビルドの道具が入っていなければ、マシン全体へのインストールはせずに止まる（開発環境の準備が要る。今のこの Windows のパソコンには rustc と cargo が無い）。人が入れて `npm run setup` を流した後に続ける
4. 作る役：Rust の crate。`crates/protocol`（型と `src/bin/gen-types.rs`）、`crates/core`（Clock、Core）、`crates/commands`（dispatch、init_logging、feature e2e）、`crates/devhost`（serve、seed、静的なファイル、データの分け方、テストの受け口）、`apps/desktop/src-tauri`（`Cargo.toml`、`build.rs`、`tauri.conf.json`、`capabilities/default.json`、`icons/`、`src/lib.rs`（configure と run）、`src/main.rs`）
5. 作る役：画面の側。`vite.config.ts`、`apps/desktop/vite.shared.ts`、`apps/desktop/texts-plugin.ts`、`apps/desktop/index.html`、`apps/desktop/src/main.tsx`、`apps/desktop/src/app/App.tsx`（と App.module.css）、`apps/desktop/src/bridge/invoke.ts`、`apps/desktop/src/bridge/ready.ts`、`apps/desktop/src/ui/Text.tsx`、`apps/desktop/src/texts/index.ts`、`apps/desktop/src/texts/virtual-texts.d.ts`、`apps/desktop/src/styles/tokens.css`、`apps/desktop/src/styles/base.css`、`packages/protocol/src/index.ts`
6. 作る役：道具の設定とコマンド。`tsconfig.json`、`eslint.config.js`、`.prettierrc`、`.prettierignore`、`scripts/serve.mjs`、`scripts/seed.mjs`、`scripts/coverage.mjs`、`scripts/start-check.mjs`、`scripts/measure-response.mjs`、`scripts/measure-sync.mjs`、`README.md`
7. 作る役：`.github/workflows/ci.yml`、`.github/workflows/release.yml`
8. seed：toolchain.yaml の `start.seed` はあるが、001 には試す画面のデータが無いので、seed はデータの置き場所を作るだけにする（機能のチケットの作る役が足す）
9. 作りに合わせて変わるテストの設定（devhost の実行ファイルの場所、ビルドのコマンド、カバレッジから外すファイル）は、作る役が変えずに報告し、プロダクトリードがテストを書く役に直させる。lint がテストのファイルの書き方で落ちたときも同じ

全てのファイルが書く役の範囲に入っていることを確かめた：作る役の apps/**、crates/**、packages/**、scripts/**、.github/**、直下の設定のファイル、.gitignore（CORE）。テストを書く役の tests/**、e2e/**、perf/**、crates/*/tests/**、apps/desktop/src-tauri/tests/**、apps/desktop/src/**/*.test.ts(x)、テストの設定 3 つ、specs/_current/_tech/checks/**（CORE）。

## 反映した _notes

- 無し（specs/_notes/ がまだ無い）
