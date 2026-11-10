// Gate 2 の受け入れのページ（目的の文書の「Gate 2 の画面」）。検証の結果と仕様の差分から機械で作る。
// プロダクトリードが PR の CI の終わりを待ってから実行する。gate2.md を PR の本文にし、同じ中身を手元のページ（gate2.html。
// 作ったものとモックを左右に並べる）にも書く。会話には要点（gate2-summary.md）を出し、人はページで全文を見る。
//
// 使い方：node .claude/aidd/bin/gate2-report.mjs <ticket-id> --ci <PR の CI の結果。例：success>
//   書き出し先は specs/<ticket-id>/results/gate2.md。ページと要点は同じフォルダの gate2.html と gate2-summary.md
// 読むもの：results/verify.json、results/examples.json（verify.mjs が作る）、status.yaml の approval.commit（承認の後に変わった具体例）、
//   承認のときと今の hearing/questions.yaml（承認の後に問わずに決めた振る舞い）、
//   results/ci-check.yaml（001 だけ。プロダクトリードが書く。green と red に { commit, result, url }）、plan/details.yaml（細部と画面ごとの道）、
//   toolchain.yaml（計測、道具の検査の非機能要件とコマンドの結び付き nfr_commands、画面を開く手順 start と、日時を決めて起こすコマンド start.clock）、
//   write-scopes.json の implementer の deny と git の履歴（計測の後にコードが変わったか）、
//   screen-changes.yaml（画面のあるチケット。作ったものは verify.mjs が差し替える見た目の基準 specs/_current/<領域>/screenshots/、results/mock/ は mock-render.mjs が書く。
//   変えるつもりの無かった画面の変化は verify.json の screenshots.unlisted_changes と、最後のコードレビュー（reviews/code/）が書いた理由 unlisted_changes。
//   変えた共通部品を読む画面の変化は screenshots.part_changes）
// 「画面を開く」は「あなたが見て判断すること」のすぐ後（無ければ目的と CI の行の後）に置く（下書き、ページ、要点）。
// ページを作るたびに、同じフォルダに仕様の全体のページ（spec-book.html。lib/spec-book.mjs。コミットしない）も作り直し、ページの上のリンクから指す。
// 作れなければ知らせて、受け入れのページは作る。
// 判定できなければ終了コード 2。
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Gate 2 の受け入れのページだけの見た目。作ったものとモックを左右に（狭い画面では上下に）並べる
const GATE2_CSS = `.stat.ok { border-color: var(--ok); } .stat.ok b { color: var(--ok); } .stat.bad { border-color: var(--bad); background: var(--bad-soft); } .stat.bad b { color: var(--bad); }
.stat.warn { border-color: var(--warn); } .stat.warn b { color: var(--warn); } .stat b { font-size: 1.3rem; }
.ex.res { grid-template-columns: 1fr; gap: 8px; } .ex.res .was, .ex.res .now { gap: 6px; }
.cards.pad { padding: 12px 16px; }
.cmp { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; display: grid; gap: 12px; }
.cmp-head { display: grid; gap: 6px; }
.pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; } .pair a.shot img { max-height: 520px; }
@media (max-width: 760px) { .pair { grid-template-columns: 1fr; } }
ol.steps { margin: 4px 0 0; padding-left: 1.4em; }
#misc .kgroup + details, #misc details { margin-top: 8px; } details > .cmp + .cmp, details > summary + .cmp, details > details { margin-top: 12px; }`;

const args = process.argv.slice(2);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
try {
  const ticket = args[0];
  if (!ticket || ticket.startsWith("--")) throw new Error("チケットの ID を渡してください");
  const ci = opt("--ci");
  if (!ci) throw new Error("--ci に PR の CI の結果を渡してください（gh pr checks --watch の後）");
  const { resolveRoot } = await import(new URL("../lib/root.mjs", import.meta.url).href);
  const root = resolveRoot();
  const lib = (f) => import(pathToFileURL(path.join(root, ".claude/aidd/lib", f)).href);
  const { specDiff, defaultFrom, readStatus, afterApproval } = await lib("spec-diff.mjs");
  const { buildIndex, usesOf, isBase, reader, parseYaml } = await lib("id-graph.mjs");
  const { exampleLine, ticketPurpose, areaHeading, readYaml, readJson, designDiff, fileDiff, DS_DIR, BASE_CSS_LABEL: BASE_LABEL, answered } = await lib("render.mjs");
  const { shotScreens, ticketParts, groupParts, partAreaName, imageLine, githubRepo, readsOf } = await lib("screens.mjs");
  const { baselinePath } = await lib("visual.mjs");
  const { esc: e, gwt, page, codeSpan, clean, swatch, rawList, shot: shotOf } = await lib("page.mjs");
  const { tryWriteSpecBook } = await lib("spec-book.mjs");
  const { matchGlob, CODE_SCOPES } = await lib("scopes.mjs");
  const git = (...a) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

  const res = `specs/${ticket}/results`;
  const verify = readJson(root, `${res}/verify.json`);
  const results = readJson(root, `${res}/examples.json`)?.examples;
  if (!verify || !results) throw new Error(`${res}/verify.json と examples.json がありません。verify.mjs を流してください`);
  const index = buildIndex(root);
  const from = defaultFrom(root);
  const mine = specDiff(root, { ticket, from });
  const approved = readStatus(root, ticket)?.approval?.commit;
  // 承認の後に変わったもの（承認のコミットから作業ツリーまで）。承認の後に取り込んだ main の、ほかのチケットの変更は除く。仕様の項目は鍵で、
  // モック、デザインシステム（design.yaml と base.css）はファイルで、画面文は行で除く
  const { main: mainSide, changes: sinceChanges } = afterApproval(root, ticket, approved, from);
  const { title, purpose } = ticketPurpose(ticket, index);
  const icon = (k) => ({ passed: "✅", failed: "❌", skipped: "⏭️" }[results[k]?.result] ?? "⚠️ 未実行");
  const out = path.resolve(root, `${res}/gate2.md`);
  const htmlFile = path.join(path.dirname(out), "gate2.html");

  // ---------- 手元のページの部品 ----------
  // 具体例の結果のラベル（名詞で短く）。成功以外は目立つ色にする
  const resultChip = (k) => {
    const [cls, t] = { passed: ["ok", "成功"], failed: ["bad", "失敗"], skipped: ["warn", "スキップ"] }[results[k]?.result] ?? ["warn", "未実行"];
    return `<span class="chip ${cls}">${t}</span>`;
  };
  // 画像はページからの相対パスで指す（PR の本文は blob の URL）
  const shot = (rel, alt) => shotOf(root, path.dirname(htmlFile), rel, alt, "の画像がありません");
  const nav = [], B = [], stats = [];
  const sec = (id, t, body) => { nav.push([id, t]); B.push(`<section id="${id}"><h2>${e(t)}</h2>${body}</section>`); };
  const secFirst = (id, t, body) => { nav.unshift([id, t]); B.unshift(`<section id="${id}"><h2>${e(t)}</h2>${body}</section>`); };
  const stat = (id, value, label, cls = "") => stats.push(`<a class="stat${cls ? ` ${cls}` : ""}" href="#${id}"><b>${value}</b><span>${e(label)}</span></a>`);
  const ok = (x) => (x ? "ok" : "bad");
  // CI の結果は、検証のコマンドと同じ言葉で出す（ほかの値はそのまま）
  const ciWord = (r) => ({ success: "成功", failure: "失敗" }[r] ?? r);
  stats.push(`<div class="stat ${ok(ci === "success")}"><b>${e(ciWord(ci))}</b><span>PR の CI</span></div>`,
    `<div class="stat ${ok(verify.passed)}"><b>${verify.passed ? "成功" : "失敗あり"}</b><span>検証のコマンド</span></div>`);

  // 変わった行の並び。前と後は組にして続け、組にならない行は「追加」「削除」
  const mdLines = (lines) => lines.map((l) => `- ${l.side}：${codeSpan(l.text)}`);
  const tc = readYaml(root, "specs/_current/_tech/toolchain.yaml") ?? {};

  // PR の本文には見出しを付けない（PR の題名と重なるため）
  const L = [`**目的**：${purpose}`, ""];
  const ciStatus = `**PR の CI**：${ci === "success" ? "✅" : "❌"} ${ciWord(ci)}　**検証のコマンド**：${verify.passed ? "✅ 成功" : "❌ 失敗あり"}`;
  L.push(ciStatus, "");

  // このチケットで足した、変えた要件と具体例の結果
  const touched = new Set(mine.changes.filter((c) => c.change !== "removed").map((c) => (c.kind === "AC" ? c.parent ?? c.key : c.key)));
  const areaReqs = [...index.items.values()].filter((e) => e.kind === "REQ" && !isBase(e.area) && touched.has(e.key));
  const exs = (r) => [...index.items.values()].filter((x) => x.parent === r.key);
  // 共通の要件の代表の具体例は、共通の要件の下に出す。このチケットで足すか変えた共通の要件と具体例に加え、このチケットで触れた要件が
  // uses で指す共通の要件の具体例の結果も添える（テストはその操作ごとに同じ具体例の ID で書く）
  const sharedRules = [...index.items.values()].filter((r) => r.kind === "RULE" && exs(r).length && (touched.has(r.key) || areaReqs.some((x) => usesOf(x).includes(r.key))));
  const reqs = [...areaReqs, ...sharedRules];
  const heading = (area) => (area === "_shared" ? "共通の要件" : areaHeading(index, area));
  L.push("## 要件と具体例", "");
  if (!reqs.length) L.push("- このチケットで足したり変えたりした要件はありません", "");
  let resultsHtml = reqs.length ? "" : `<p class="note">このチケットで足したり変えたりした要件はありません。</p>`;
  for (const area of [...new Set(reqs.map((r) => r.area))]) {
    L.push(`### ${heading(area)}`, "");
    resultsHtml += `<h3>${e(heading(area))}</h3>`;
    for (const r of reqs.filter((x) => x.area === area)) {
      L.push(`- ${r.item.statement}`);
      for (const x of exs(r)) L.push(`  - ${icon(x.key)} ${exampleLine(x.item)}`);
      resultsHtml += `<div class="rule"><div class="rule-head"><p class="stmt">${e(r.item.statement)}</p></div>${exs(r).map((x) => `<div class="ex res"><div class="tags">${resultChip(x.key)}</div>${gwt(x.item)}</div>`).join("")}</div>`;
    }
    L.push("");
  }
  const mineEx = reqs.flatMap(exs);
  const minePassed = mineEx.filter((x) => results[x.key]?.result === "passed").length;
  // 要点（会話に出す）の材料：成功しなかった具体例
  const notPassed = (xs) => xs.filter((x) => results[x.key]?.result !== "passed").map((x) => `- ${icon(x.key)} ${exampleLine(x.item)}`);
  const summaryFailed = notPassed(mineEx);
  if (mineEx.length) stat("results", `${minePassed} / ${mineEx.length}`, "このチケットで決めた具体例のうち、成功した数", minePassed === mineEx.length ? "ok" : "bad");
  sec("results", "要件と具体例", resultsHtml);
  // 基盤の受入条件（001）
  const summaryTech = [], humanTech = [];
  const techAc = [...index.items.values()].filter((e) => e.area === "_tech" && e.kind === "AC");
  if (ticket.startsWith("001-") && techAc.length) {
    const check = readYaml(root, `${res}/ci-check.yaml`) ?? {};
    const ciLine = (x, expected) => (x ? `${x.result === expected ? "✅" : "❌"} ${ciWord(x.result)}${x.url ? `（${x.url}）` : ""}` : "⚠️ 確認していない");
    const ciChip = (x, expected) => (x ? `<span class="chip ${ok(x.result === expected)}">${e(ciWord(x.result))}</span>${x.url ? ` <a href="${e(x.url)}">${e(x.url)}</a>` : ""}` : `<span class="chip warn">確認していない</span>`);
    L.push("## 技術の土台の確認", "");
    let techHtml = "";
    for (const x of techAc) {
      if (x.item.checked_by === "test") {
        L.push(`- ${icon(x.key)} ${exampleLine(x.item)}`);
        techHtml += `<div class="ex res solo"><div class="tags">${resultChip(x.key)}</div>${gwt(x.item)}</div>`;
      } else if (x.item.checked_by === "human") {
        L.push(`- あなたが確認すること：${exampleLine(x.item)}`);
        techHtml += `<div class="ex res solo"><div class="tags"><span class="chip acc">あなたが確認する</span></div>${gwt(x.item)}</div>`;
      }
    }
    const ciLines = [`- 何も壊さない変更で、CI が通る：${ciLine(check.green, "success")}`, `- 失敗するテストを足した変更で、CI が落ちる：${ciLine(check.red, "failure")}`];
    L.push(...ciLines, "");
    summaryTech.push(...ciLines);
    summaryFailed.push(...notPassed(techAc.filter((x) => x.item.checked_by === "test")));
    humanTech.push(...techAc.filter((x) => x.item.checked_by === "human"));
    techHtml += `<div class="item"><div class="txt">何も壊さない変更で、CI が通る</div><div class="tags">${ciChip(check.green, "success")}</div></div><div class="item"><div class="txt">失敗するテストを足した変更で、CI が落ちる</div><div class="tags">${ciChip(check.red, "failure")}</div></div>`;
    sec("tech", "技術の土台の確認", `<div class="cards">${techHtml}</div>`);
  }
  // 承認の後に変わった具体例
  const after = sinceChanges.filter((c) => c.kind === "AC");
  L.push("## 承認の後に変わった具体例", "");
  if (!approved) L.push("- 承認の記録がありません");
  else if (!after.length) L.push("- 無し");
  let afterHtml = !approved ? `<p class="note">承認の記録がありません。</p>` : !after.length ? `<p class="note">承認の後に変わった具体例はありません。</p>` : "";
  if (approved) stat("after", `${after.length} 件`, "承認の後に変わった具体例", after.length ? "warn" : "");
  // 要件ごとにまとめ、変えた具体例は承認のときの具体例と今の具体例を上下に並べる（中身で見比べられるように）
  for (const parent of [...new Set(after.map((c) => c.parent))]) {
    // 親の要件も消えたなら、承認のときの文を「消した要件」として見出しにする
    const req = parent ? index.items.get(parent)?.item ?? sinceChanges.find((c) => c.key === parent && c.change === "removed")?.before : null;
    const pad = req ? "  " : "";
    if (req) L.push(`- ${req.statement}${index.items.has(parent) ? "" : "（消した要件）"}`);
    let rows = "";
    for (const c of after.filter((x) => x.parent === parent)) {
      if (c.change === "added") L.push(`${pad}- 足した：${exampleLine(c.after)}`);
      else if (c.change === "removed") L.push(`${pad}- 消した：${exampleLine(c.before)}`);
      else L.push(`${pad}- 変えた`, `${pad}  - 承認のとき：${exampleLine(c.before)}`, `${pad}  - 今：${exampleLine(c.after)}`);
      rows += c.change === "added" ? `<div class="ex res solo"><div class="tags"><span class="chip ok">足した</span></div>${gwt(c.after)}</div>`
        : c.change === "removed" ? `<div class="ex res solo gone"><div class="tags"><span class="chip bad">消した</span></div><del>${gwt(c.before)}</del></div>`
        : `<div class="ex res solo"><div class="tags"><span class="chip warn">変えた</span></div><div class="was"><div class="lbl">承認のとき</div>${gwt(c.before)}</div><div class="now"><div class="lbl">今</div>${gwt(c.after)}</div></div>`;
    }
    afterHtml += `<div class="rule">${req ? `<div class="rule-head"><p class="stmt">${e(req.statement)}${index.items.has(parent) ? "" : "（消した要件）"}</p></div>` : ""}<div class="cards pad">${rows}</div></div>`;
  }
  L.push("");
  sec("after", "承認の後に変わった具体例", afterHtml);
  // 承認の後に問わずに決めた振る舞い：承認の後に足すか変えた具体例のうち、承認の後に答えた問い（承認のときに答えが無く、今はある）の
  // about に、その具体例の ID が無いもの。要件の ID だけを指す問いでは、その具体例を問うたとみなさない。新しい記録は作らない
  const QS = `specs/${ticket}/hearing/questions.yaml`;
  const qsThen = approved ? (() => { const t = reader(root, approved).text(QS); return t ? parseYaml(t, QS, approved).questions ?? [] : []; })() : [];
  const askedAbout = new Set((readYaml(root, QS)?.questions ?? []).filter((q) => answered(q) && !answered(qsThen.find((x) => x.id === q.id))).flatMap((q) => (q.about ?? []).map(String)));
  const asked = (key) => askedAbout.has(key) || askedAbout.has(key.slice(key.lastIndexOf("/") + 1));
  // 共通の要件の代表の具体例（_shared）も入れる。基盤の受入条件（_tech）は除く
  const unasked = after.filter((c) => ["added", "modified"].includes(c.change) && c.area !== "_tech" && !asked(c.key));
  // 要点の行は具体例だけにする（要件の文は長いことがあり、行ごとに繰り返すと読めない。ページでは要件ごとにまとめる）
  const unaskedLine = (c) => `承認の後に問わずに決めた振る舞い：${exampleLine(c.after)}`;
  // 承認の後に変えたデザインシステムの値（tokens.css の写しだけを変えたときは、モックの .dc.html が変わらず画面の印が付かないため）
  // 土台の CSS（_tech/ds/<フォルダ>/base.css）の変わった行も同じ節に出す
  const { diff: dsAfter, base: baseAfter } = approved ? designDiff(root, approved, { skip: mainSide.files }) : { diff: [], base: [] };
  if (dsAfter.length || baseAfter.length) {
    L.push("## 承認の後に変わったデザインシステムの値", "", "その値を使うすべての画面の見た目が変わります。", "", ...dsAfter.map((v) => `- ${v.name}　承認のとき：${v.before ?? "（無し）"}　今：${v.after ?? "（無し）"}`), "");
    if (baseAfter.length) L.push(`**${BASE_LABEL}**`, "", ...baseAfter.map((l) => `- ${l.side}：${codeSpan(l.text)}`), "");
    sec("ds", "承認の後に変わったデザインシステムの値", `<p class="note">その値を使うすべての画面の見た目が変わります。</p>${dsAfter.length ? `<div class="table-wrap"><table><thead><tr><th>値の名前</th><th>承認のとき</th><th>今</th></tr></thead><tbody>${dsAfter.map((v) => `<tr><td>${e(v.name)}</td><td>${swatch(v.before)}</td><td>${swatch(v.after)}</td></tr>`).join("")}</tbody></table></div>` : ""}${baseAfter.length ? `<div class="sub">${e(BASE_LABEL)}</div>${rawList(baseAfter)}` : ""}`);
  }
  // 承認の後に足した文と変えた文（作る役が足した、具体例の無い通信の失敗の文など）
  const screens = shotScreens(root, ticket);
  const { textsDiff, textsArea, textsMd, textsHtml } = await lib("texts.mjs");
  const textKey = (r) => `${r.file}#${r.id}`;
  const mainTexts = mainSide.was ? (() => { const ours = new Set(textsDiff(root, from).map(textKey)); return new Set(textsDiff(root, mainSide.was, from).map(textKey).filter((k) => !ours.has(k))); })() : new Set();
  const textsAfter = approved ? textsDiff(root, approved).filter((r) => !mainTexts.has(textKey(r))) : [];
  if (textsAfter.length) {
    const textsName = (r) => screens.find((s) => s.area === textsArea(r) && s.id === r.screen)?.title ?? r.screen;
    L.push("## 承認の後に変わった画面の文", "", ...textsMd(textsAfter, textsName));
    sec("texts", "承認の後に変わった画面の文", `<p class="note">承認の後に足した文と変えた文です。</p>${textsHtml(textsAfter, textsName, e)}`);
  }
  // 画面：作ったもの（e2e のスクリーンショット）とモックを並べる。承認の後にモックが変わった画面も示す
  const links = [];
  const details = readYaml(root, `specs/${ticket}/plan/details.yaml`) ?? {};
  const start = tc.start;
  // このチケットの画面を開く URL。画面の名前は領域の requirements.yaml の screens から
  const screenTitle = (area, id) => screens.find((s) => s.area === area && s.id === id)?.title ?? (readYaml(root, `specs/_current/${area}/requirements.yaml`)?.screens ?? []).find((x) => x.id === id)?.title ?? id;
  const openUrls = start ? (details.screen_paths ?? []).map((x) => ({ title: screenTitle(x.area, x.id), url: new URL(x.path, start.url).href })) : [];
  // 見た目の変化の表（前、後、違い）。変えるつもりの無かった画面の変化と、共通部品で変わった画面で使う
  const changeTable = (cs) => ["| 画面 | 前（main） | 後 | 違い |", "| --- | --- | --- | --- |",
    ...cs.map((u) => `| ${u.file.replace(/\.png$/, "")}（${(u.ratio * 100).toFixed(1)}%） | ${imageLine(root, u.before, "前")} | ${imageLine(root, u.after, "後")} | ${u.diff ? imageLine(root, u.diff, "違い") : "大きさが変わった"} |`)];
  // 共通部品で見た目が変わった画像を、画面（領域と SCR の ID）ごとにまとめる。画面ごとに 1 枚（画面の元の画像があればそれ）を開き、残りを畳む
  // （共通部品を読む画面は閾値 0 で拾うので、読む画面の数だけ並ぶ）
  const shotParts = (u) => u.file.replace(/\.png$/, "").split("--");
  const screensOf = (cs) => [...new Set(cs.map((u) => shotParts(u).slice(0, 2).join("/")))].map((k) => {
    const [area, id] = k.split("/");
    const all = cs.filter((u) => shotParts(u).slice(0, 2).join("/") === k);
    const first = all.find((u) => !shotParts(u)[2]?.startsWith("AC-")) ?? all[0];
    return { title: screenTitle(area, id), first, rest: all.filter((u) => u !== first) };
  });
  const changeHtml = (u) => `<div class="cmp"><div class="cmp-head"><p class="stmt">${e(u.file.replace(/\.png$/, ""))}（${(u.ratio * 100).toFixed(1)}%）</p></div><div class="pair"><figure>${shot(u.before, "前")}<figcaption>前（main）</figcaption></figure><figure>${shot(u.after, "後")}<figcaption>後</figcaption></figure>${u.diff ? `<figure>${shot(u.diff, "違い")}<figcaption>違い</figcaption></figure>` : ""}</div></div>`;
  // 承認の後にモックが変わった画面は、2 つに分けて印を付ける（画面の CSS を直すと、読むすべての画面に同じ印が付き、
  // 中身の変わった画面が埋もれるため）。その画面の .dc.html（画面の元か画面例）が変わったもの（高さの値だけの違いは除く）は
  // 「承認の後にモックが変わった」、読む画面の CSS か共通部品（画面の元と画面例が <helmet> の <link> と <dc-import> で読む）だけが変わったものは
  // 「承認の後に CSS か共通部品だけが変わった」
  const tparts = ticketParts(root, ticket);
  const changedMocks = approved && (screens.length || tparts.length) ? git("diff", "--name-only", "-z", approved, "--", "specs/_current").split("\0").filter((f) => /\/mock\/project\/[^/]+\.(?:dc\.html|css)$/.test(f) && !mainSide.files.has(f)) : [];
  // 高さの値（共通部品の読み込みの hint-size の高さと、artboard の大きさの height）を伏せる。読む部品の高さが変わると、これだけが変わる
  const noHeight = (t) => (t === null ? null : t.replace(/("height"\s*:\s*)[\d.]+/g, "$1_").replace(/(hint-size="[^",]*,\s*)[\d.]+px"/g, '$1_px"'));
  const ownMemo = new Map();
  const ownMoved = (s) => {
    if (!changedMocks.includes(s.mock)) return false;
    if (!ownMemo.has(s.mock)) {
      const nowText = existsSync(path.join(root, s.mock)) ? readFileSync(path.join(root, s.mock), "utf8") : null;
      ownMemo.set(s.mock, noHeight(reader(root, approved).text(s.mock)) !== noHeight(nowText));
    }
    return ownMemo.get(s.mock);
  };
  const styleMoved = (s) => !ownMoved(s) && [...readsOf(root, s.mock)].some((f) => f !== s.mock && changedMocks.includes(f));
  const MOCK_MOVED = "承認の後にモックが変わった", STYLE_MOVED = "承認の後に CSS か共通部品だけが変わった";
  const movedLabel = (s) => (ownMoved(s) ? MOCK_MOVED : styleMoved(s) ? STYLE_MOVED : null);
  const movedScreens = screens.filter(ownMoved).length, styledScreens = screens.filter(styleMoved).length;
  const widthNote = (s) => (s.width ? `（${s.width}）` : "");
  // 作った画面を人が自分のブラウザで開く手順（001 で toolchain.yaml の start に書く）。試すデータの入れ方（start.seed。データベースを起こす所から
  // 含める）、ビルドと起動（start.command）、このチケットの画面の URL（計画担当が plan/details.yaml の screen_paths に書く道）の順。
  // 日時を決めて起こすコマンド（start.clock）と、計画担当が書いた試す日時（plan/details.yaml の try_at）があれば、
  // 開く日によって試せないときの道として、{at} に試す日時を入れたコマンドを添える。節は「あなたが見て判断すること」のすぐ後に置く（下で入れる）
  const opening = start && (screens.length || tparts.length) ? (() => {
    const steps = [
      ...(start.seed ? [{ md: `\`${start.seed}\` を実行して、画面を試せるデータを入れる`, html: `<code>${e(start.seed)}</code> を実行して、画面を試せるデータを入れる` }] : []),
      { md: `\`${start.command}\` を実行する`, html: `<code>${e(start.command)}</code> を実行する` },
      openUrls.length
        ? { md: `ブラウザで、このチケットの画面を開く：${openUrls.map((u) => `${u.title}（${u.url}）`).join("、")}`, html: `ブラウザで、このチケットの画面を開く<ul>${openUrls.map((u) => `<li>${e(u.title)}：<a href="${e(u.url)}" target="_blank">${e(u.url)}</a></li>`).join("")}</ul>` }
        : { md: `ブラウザで ${start.url} を開く`, html: `ブラウザで <a href="${e(start.url)}" target="_blank">${e(start.url)}</a> を開く` },
      ...(start.login ? [{ md: `試すためのログイン：${start.login}`, html: `試すためのログイン：${e(start.login)}` }] : []),
      { md: "見終わったら、そのターミナルで Ctrl+C を押して止める", html: "見終わったら、そのターミナルで Ctrl+C を押して止める" },
    ];
    steps[0] = { md: `別のターミナルで、このリポジトリのフォルダに移り、${steps[0].md}`, html: `別のターミナルで、このリポジトリのフォルダに移り、${steps[0].html}` };
    const clock = start.clock && details.try_at ? start.clock.split("{at}").join(details.try_at) : null;
    const at = details.try_at?.replace("T", " ");
    const instead = "データを入れて起動する手順の代わりに";
    const lead = `開く日によって画面を試せないとき（日付や時刻で中身が変わる画面です）は、${instead}`;
    const alt = clock ? { md: `\`${clock}\` を実行する（${at} の画面として起こします）`, html: `<code>${e(clock)}</code> を実行する（${e(at)} の画面として起こします）` } : null;
    return {
      md: ["## 画面を開く", "", ...steps.map((x, i) => `${i + 1}. ${x.md}`), "", ...(alt ? [`${lead} ${alt.md}`, ""] : [])],
      html: `<div class="callout"><ol class="steps">${steps.map((x) => `<li>${x.html}</li>`).join("")}</ol>${alt ? `<p class="note">${lead} ${alt.html}</p>` : ""}</div>`,
      summary: [`**画面を開く**：${start.seed ? `\`${start.seed}\` で試すデータを入れてから、` : ""}\`${start.command}\` を実行し、${openUrls.length ? openUrls.map((u) => `${u.title}（${u.url}）`).join("、") : start.url} を開く`,
        ...(start.login ? [`**試すためのログイン**：${start.login}`] : []), ...(alt ? [`**開く日によって試せないとき**：${instead} ${alt.md}`] : []), ""],
    };
  })() : null;
  if (screens.length || tparts.length) {
    L.push("## 画面", "");
    let screensHtml = `<p class="note">画面ごとに、作ったもの（テストで撮った画面）とモックを並べています。画像を押すと大きく見られます。</p>`;
    // 画面ごとの表。行は画面の元と画面例で、作ったものとモックを並べる。
    // このチケットで足した具体例と変えた具体例、承認の後にモックが変わった画面、画面の元を開いて先に出し、
    // 具体例は変わらず描き直しただけの画面例は、件数を添えて畳む
    const touchedEx = new Set(mine.changes.filter((c) => c.kind === "AC" && c.change !== "removed").map((c) => c.key));
    // 作ったものは、検証が差し替えた見た目の基準（specs/_current/<領域>/screenshots/）
    // label は承認の後の印（movedLabel。無ければ null）
    const rowMd = (s, label) => `| ${s.ac ? (s.example ? exampleLine(s.example) : s.ac) : "画面を開いたとき"}${widthNote(s)}${label ? `（${label}）` : ""} | ${imageLine(root, baselinePath(s.file), "作ったもの")} | ${imageLine(root, `${res}/mock/${s.file}`, "モック")} |`;
    const rowHtml = (s, label) => `<div class="cmp"><div class="cmp-head">${s.ac && s.example ? gwt(s.example) : `<p class="stmt">${e(s.ac ?? "画面を開いたとき")}</p>`}${s.width ? `<p class="note">幅：${e(s.width)}</p>` : ""}${label ? `<div class="tags"><span class="chip ${label === MOCK_MOVED ? "warn" : "acc"}">${e(label)}</span></div>` : ""}</div><div class="pair"><figure>${shot(baselinePath(s.file), "作ったもの")}<figcaption>作ったもの</figcaption></figure><figure>${shot(`${res}/mock/${s.file}`, "モック")}<figcaption>モック</figcaption></figure></div></div>`;
    const head = "| 具体例 | 作ったもの | モック |\n| --- | --- | --- |";
    for (const key of [...new Set(screens.map((s) => `${s.area}/${s.id}`))]) {
      const boards = screens.filter((s) => `${s.area}/${s.id}` === key);
      // 承認の後の印の付いた画面例は、どちらの印も畳まずに並べる
      const redrawn = boards.filter((s) => s.ac && s.change === "modified" && !touchedEx.has(s.acKey) && !movedLabel(s));
      const shown = boards.filter((s) => !redrawn.includes(s));
      L.push(`### ${boards[0].title}`, "", ...(shown.length ? [head, ...shown.map((s) => rowMd(s, movedLabel(s))), ""] : []));
      screensHtml += `<h3>${e(boards[0].title)}</h3>${shown.map((s) => rowHtml(s, movedLabel(s))).join("")}`;
      if (redrawn.length) {
        const sum = `具体例はそのままで、このチケットの変更に合わせて描き直した画面（${redrawn.length} 枚）`;
        L.push(`<details><summary>${sum}</summary>`, "", head, ...redrawn.map((s) => rowMd(s, null)), "", "</details>", "");
        screensHtml += `<details><summary>${sum}</summary>${redrawn.map((s) => rowHtml(s, null)).join("")}</details>`;
      }
    }
    // 変えた共通部品は、名前ごとに 1 つにまとめる。共通部品の artboard（モックだけ）と代表の画面の元を出し、
    // その部品を読む画面の見た目の変化（verify.json の part_changes。コードレビューが画面ごとに 1 枚を見て、崩れを見た）は畳み、
    // 畳んだ中で画面ごとに 1 枚を開いて残りを畳む
    const partChanges = verify.screenshots?.part_changes ?? [];
    const listedFiles = new Set(screens.map((s) => s.file));
    for (const g of groupParts(tparts)) {
      const first = g.parts[0];
      const repS = first.rep.find((x) => x.main && !listedFiles.has(x.file)) ?? null;
      const readers = g.parts.reduce((n, p) => n + p.readers.length, 0);
      const others = [...new Set(g.parts.slice(1).map(partAreaName).filter(Boolean))];
      const changes = partChanges.find((x) => x.part === g.name)?.changes ?? [];
      const byScreen = screensOf(changes);
      const note = `この部品を読む画面（画面の元と画面例）は ${readers} 枚です。${others.length ? `${others.map((n) => `「${n}」`).join("、")}にも同じ部品があります。` : ""}${changes.length ? `部品を変えて見た目が変わった ${byScreen.length} 画面（画像 ${changes.length} 枚）は、コードレビューが画面ごとに 1 枚を見て、崩れの無いことを確認しました。` : ""}`;
      const sum = `この部品で見た目が変わった画面（${byScreen.length} 画面、${changes.length} 枚）`;
      const otherShots = (x) => `同じ画面のほかの画像（${x.rest.length} 枚）`;
      L.push(`### 共通部品「${g.name}」`, "", note, "", imageLine(root, `${res}/mock/${first.file}`, `共通部品「${g.name}」のモック`), "");
      if (repS) L.push(head, `| 画面を開いたとき（代表の画面「${repS.title}」）${widthNote(repS)} | ${imageLine(root, baselinePath(repS.file), "作ったもの")} | ${imageLine(root, `${res}/mock/${repS.file}`, "モック")} |`, "");
      if (changes.length) {
        L.push(`<details><summary>${sum}</summary>`, "");
        for (const x of byScreen) L.push(`**${x.title}**`, "", ...changeTable([x.first]), "", ...(x.rest.length ? [`<details><summary>${otherShots(x)}</summary>`, "", ...changeTable(x.rest), "", "</details>", ""] : []));
        L.push("</details>", "");
      }
      screensHtml += `<h3>共通部品「${e(g.name)}」</h3><p class="note">${e(note)}</p><div class="cmp"><div class="pair"><figure>${shot(`${res}/mock/${first.file}`, `共通部品「${g.name}」`)}<figcaption>共通部品のモック</figcaption></figure></div></div>`
        + (repS ? rowHtml(repS, movedLabel(repS)).replace('<p class="stmt">画面を開いたとき</p>', `<p class="stmt">画面を開いたとき（代表の画面「${e(repS.title)}」）</p>`) : "")
        + (changes.length ? `<details><summary>${e(sum)}</summary>${byScreen.map((x) => `<h4>${e(x.title)}</h4>${changeHtml(x.first)}${x.rest.length ? `<details><summary>${e(otherShots(x))}</summary>${x.rest.map(changeHtml).join("")}</details>` : ""}`).join("")}</details>` : "");
    }
    const canvasUrls = [...new Set([...screens, ...tparts.flatMap((x) => x.rep)].map((s) => s.canvas).filter(Boolean))];
    for (const url of canvasUrls) L.push(`- キャンバス：${url}`);
    // Gate 2 のページを見ている間も、キャンバスを直せる
    const canvasNote = "今はキャンバスを直してよい時です。キャンバスを直したら、マージの前にここで伝えてください（写しを取って、作ったものに入れます）。";
    if (canvasUrls.length) { L.push("", canvasNote); screensHtml += `<p class="note">${e(canvasNote)}</p>`; }
    L.push("");
    stat("screens", `${screens.length} 枚`, "作ったものとモックを並べた画面", movedScreens ? "warn" : "");
    if (movedScreens) stat("screens", `${movedScreens} 枚`, "承認の後にモックが変わった画面", "warn");
    if (styledScreens) stat("screens", `${styledScreens} 枚`, "承認の後に CSS か共通部品だけが変わった画面");
    sec("screens", "画面", screensHtml);
    links.push(...canvasUrls.map((u) => [u, "画面のキャンバス", "キャンバスを開く ↗"]));
  }
  // 前からある機能のテスト。このチケットの具体例（mineEx）に数えたものは除く
  const changedKeys = new Set([...mine.changes.map((c) => c.key), ...mineEx.map((x) => x.key)]);
  const old = Object.keys(results).filter((k) => !changedKeys.has(k) && !/^\d{3}\//.test(k));
  const oldFailed = old.filter((k) => results[k].result !== "passed");
  // 前の機能がまだ無い（001 や最初の機能のチケット）ときは、確認した形で見せない
  const oldLine = old.length ? `具体例 ${old.length} 件のテストのうち、${old.length - oldFailed.length} 件が通った` : "前からある機能のテストは、まだありません";
  L.push("## 前からある機能", "", `- ${oldLine}`);
  const oldFailedLines = oldFailed.map((k) => `- ${icon(k)} ${exampleLine(index.items.get(k)?.item)}`);
  L.push(...oldFailedLines.map((l) => `  ${l}`));
  L.push("");
  summaryFailed.push(...oldFailedLines);
  if (old.length) stat("old", `${old.length - oldFailed.length} / ${old.length}`, "前からある機能の具体例のうち、成功した数", oldFailed.length ? "bad" : "ok");
  sec("old", "前からある機能", old.length ? `<p>前のチケットで作った機能の具体例 ${old.length} 件のテストのうち、${old.length - oldFailed.length} 件が通りました。${oldFailed.length ? "" : "前の機能は壊れていません。"}</p>${oldFailed.length ? `<div class="cards">${oldFailed.map((k) => `<div class="ex res solo"><div class="tags">${resultChip(k)}</div>${gwt(index.items.get(k)?.item ?? {})}</div>`).join("")}</div>` : ""}` : `<p>前からある機能のテストは、まだありません。</p>`);
  // 非機能要件：計測、道具の検査、人が見て判断するもの、公開の後に確認するもの
  const usedNfr = new Set([...areaReqs.flatMap((r) => usesOf(r)), ...mine.area_nfr]);
  const nfrs = [...usedNfr].map((k) => index.items.get(k)).filter((e) => e?.kind === "NFR");
  // 公開の後でないと確認できない非機能要件（after_release）は、公開のチケット（ticket-plan.yaml の行の release）では人が判断するものに出し、
  // ほかのチケットでは、このチケットの要件が頼るものを畳んだ「公開の後に確認すること」に並べる
  const isRelease = !!index.items.get(`TICKET/${ticket}`)?.item?.release;
  const afterRelease = (isRelease ? [...index.items.values()].filter((x) => x.kind === "NFR") : nfrs).filter((x) => x.item.after_release);
  const now = nfrs.filter((x) => !x.item.after_release);
  const measure = now.filter((x) => x.item.check === "measurement");
  // 人が見る非機能要件。同じ並びのほかの非機能要件（画面ごとに絞った領域のもの）が uses で指している共通の非機能要件は、重なるので出さない
  const humanAll = [...now.filter((x) => x.item.check === "human"), ...(isRelease ? afterRelease : [])];
  const human = humanAll.filter((x) => !humanAll.some((y) => y.key !== x.key && usesOf(y).includes(x.key)));
  const laterNfr = isRelease ? [] : afterRelease;
  const misc = [];
  // 計測は、検証で流したものをすべて出す（このチケットの要件が頼るかによらない）。頼るのに流していないものは未計測
  const runsOf = (kind) => new Map((verify.runs ?? []).filter((r) => r.kind === kind).map((r) => [r.name, r]));
  const measured = runsOf("measurement"), commandRuns = runsOf("command");
  const nfrText = (k) => index.items.get(k)?.item?.statement ?? k;
  const lastLine = (r) => (r.stdout ?? "").trim().split("\n").pop() ?? "";
  const unmeasured = measure.filter((x) => !measured.has(x.key)).map((x) => x.item.statement);
  // 計測の新しさ。計測の結果が最後に変わった verify.json のコミットから HEAD までに、specs/ の外で、テストの外
  // （write-scopes.json の implementer の deny に当たらない）のファイルが変わっていれば、前の計測の結果と一緒に「未計測」と出す。
  // 作業ツリーの計測の結果が HEAD と違えば、流したばかりなので新しい。
  // そのコミットの verify.json で、計測の started_at がコマンドの started_at より前でも「未計測」と出す（--measure の後にコードを直し、
  // 検証だけを流し直した。コミットの検査は verify.json の時刻しか見ないので、同じコミットの中のこの順を拾えない）
  const staleMeasure = (() => {
    if (!measured.size) return false;
    const vRel = `${res}/verify.json`;
    const verifyAt = (rev) => {
      try { return JSON.parse(git("show", `${rev}:${vRel}`)); } catch { return null; /* その版に verify.json が無い */ }
    };
    const runsAt = (rev) => JSON.stringify((verifyAt(rev)?.runs ?? []).filter((r) => r.kind === "measurement"));
    const nowRuns = JSON.stringify([...measured.values()]);
    if (nowRuns !== runsAt("HEAD")) return false;
    const at = git("log", "--format=%H", "--", vRel).split("\n").filter(Boolean).find((c) => runsAt(c) !== runsAt(`${c}^`));
    if (!at) return false;
    const atRuns = verifyAt(at)?.runs ?? [];
    const startsOf = (kind) => atRuns.filter((r) => r.kind === kind && r.started_at).map((r) => r.started_at);
    const commandStart = startsOf("command").sort()[0];
    if (commandStart && startsOf("measurement").some((t) => t < commandStart)) return true;
    const deny = readJson(root, CODE_SCOPES)?.implementer?.deny ?? [];
    return git("diff", "--name-only", at, "HEAD").split("\n").filter(Boolean)
      .some((f) => !f.startsWith("specs/") && !deny.some((g) => matchGlob(f, g)));
  })();
  // 道具で確認する非機能要件は、toolchain.yaml の nfr_commands で結んだ検証のコマンドの結果と並べる（結んだものはすべて出す）。頼るのに結んでいないものは、そう出す
  const bound = tc.nfr_commands ?? {};
  const tools = Object.entries(bound).map(([key, names]) => ({ key, runs: names.map((n) => commandRuns.get(n) ?? { name: n, exit_code: null }) }));
  const unbound = now.filter((x) => x.item.check === "tool" && !(x.key in bound)).map((x) => x.item.statement);
  const toolOk = (t) => t.runs.every((r) => r.exit_code === 0);
  const toolWord = (r) => (r.exit_code === null ? "流していない" : r.exit_code === 0 ? "成功" : "失敗");
  const checked = [...(staleMeasure ? [] : [...measured.values()].map((r) => r.exit_code === 0)), ...tools.map(toolOk)];
  if (measured.size || unmeasured.length || tools.length || unbound.length) {
    L.push("## 計測と検査", "");
    let rows = "";
    for (const r of measured.values()) {
      const meets = r.exit_code === 0 ? "基準を満たす" : "基準を満たさない";
      if (staleMeasure) {
        L.push(`- ⚠️ 未計測：${nfrText(r.name)}（計測の後にコードが変わった。前の計測：${lastLine(r)}（${meets}）。計測を流し直させるか、このまま受け入れるかを決めてください）`);
        rows += `<div class="item"><div class="txt"><p>${e(nfrText(r.name))}</p><p class="aux">計測の後にコードが変わりました。前の計測：${e(lastLine(r))}（${meets}）。計測を流し直させるか、このまま受け入れるかを決めてください</p></div><span class="chip warn">未計測</span></div>`;
        continue;
      }
      L.push(`- ${r.exit_code === 0 ? "✅" : "❌"} ${nfrText(r.name)}：${lastLine(r)}`);
      rows += `<div class="item"><div class="txt"><p>${e(nfrText(r.name))}</p><p class="aux">${e(lastLine(r))}</p></div><span class="chip ${ok(r.exit_code === 0)}">${meets}</span></div>`;
    }
    for (const x of unmeasured) {
      L.push(`- ⚠️ 未計測：${x}（計測を足させるか、このまま受け入れるかを決めてください）`);
      rows += `<div class="item"><div class="txt"><p>${e(x)}</p><p class="aux">計測を足させるか、このまま受け入れるかを決めてください</p></div><span class="chip warn">未計測</span></div>`;
    }
    for (const t of tools) {
      const words = t.runs.map((r) => `${r.name}：${toolWord(r)}`).join("、");
      L.push(`- ${toolOk(t) ? "✅" : t.runs.some((r) => r.exit_code === null) ? "⚠️" : "❌"} ${nfrText(t.key)}（検査のコマンド ${words}）`);
      rows += `<div class="item"><div class="txt"><p>${e(nfrText(t.key))}</p><p class="aux">検査のコマンド ${e(words)}${t.runs.length === 1 && t.runs[0].exit_code !== null ? `　${e(lastLine(t.runs[0]))}` : ""}</p></div><span class="chip ${toolOk(t) ? "ok" : t.runs.some((r) => r.exit_code === null) ? "warn" : "bad"}">${toolOk(t) ? "成功" : t.runs.some((r) => r.exit_code === null) ? "流していない" : "失敗"}</span></div>`;
    }
    for (const x of unbound) {
      L.push(`- ⚠️ 確認するコマンドが決まっていない：${x}（検査を足させるか、このまま受け入れるかを決めてください）`);
      rows += `<div class="item"><div class="txt"><p>${e(x)}</p><p class="aux">確認する検査のコマンドが決まっていません。検査を足させるか、このまま受け入れるかを決めてください</p></div><span class="chip warn">コマンドが決まっていない</span></div>`;
    }
    L.push("");
    if (checked.length) stat("measure", `${checked.filter(Boolean).length} / ${checked.length}`, "計測と検査のうち、基準を満たした数", checked.every(Boolean) ? "ok" : "bad");
    sec("measure", "計測と検査", `<p class="note">非機能要件のうち、計測のコマンドと検査のコマンド（アクセシビリティの検査など）で確認したものです。</p><div class="cards">${rows}</div>`);
  }
  if (laterNfr.length) {
    const sum = `公開の後に確認すること（${laterNfr.length} 件）`;
    const lead = "公開の後でないと確認できない非機能要件です。公開のチケットの受け入れで、あなたが見て判断します。";
    L.push(`<details><summary>${sum}</summary>`, "", lead, "", ...laterNfr.map((x) => `- ${x.item.statement}`), "", "</details>", "");
    misc.push(`<details><summary>${e(sum)}</summary><p class="note">${e(lead)}</p><ul class="dlist">${laterNfr.map((x) => `<li><span>${e(x.item.statement)}</span></li>`).join("")}</ul></details>`);
  }
  // 変えるつもりの無かった画面の変化。コードレビューが崩れでないと判断して残ったもの。最後は人が判断する。
  // 最後のコードレビューが書いた理由ごとにまとめて畳み、まとまりごとに代表の 1 枚を開いて見せる。要点には枚数と理由を 1 行で出す。
  // PR の本文は節ごと畳み、開くと代表が見える。手元のページは節がタブで分かれるので、節は畳まず、代表を開いたまま、同じ理由のほかの画面だけを畳む
  const unlisted = verify.screenshots?.unlisted_changes ?? [];
  const reviewDir = `specs/${ticket}/reviews/code`;
  const reviewFiles = existsSync(path.join(root, reviewDir)) ? readdirSync(path.join(root, reviewDir)).filter((f) => /^\d+-c\d+\.yaml$/.test(f)).sort((a, b) => parseInt(a, 10) - parseInt(b, 10)) : [];
  const reasonRows = [...reviewFiles].reverse().map((f) => readYaml(root, `${reviewDir}/${f}`)?.unlisted_changes).find(Boolean) ?? [];
  const unlistedGroups = [];
  {
    const used = new Set();
    for (const g of reasonRows) {
      const cs = unlisted.filter((u) => !used.has(u.file) && g.files.some((f) => path.basename(String(f)) === u.file));
      cs.forEach((u) => used.add(u.file));
      if (cs.length) unlistedGroups.push({ reason: g.reason, changes: cs });
    }
    const rest = unlisted.filter((u) => !used.has(u.file));
    if (rest.length) unlistedGroups.push({ reason: null, changes: rest });
  }
  const reasonText = (g) => g.reason ?? "コードレビューの書いた理由がありません";
  const unlistedLine = unlisted.length ? `${unlisted.length} 枚（コードレビューの見立て：${unlistedGroups.map((g) => `${reasonText(g)}（${g.changes.length} 枚）`).join("、")}）` : "";
  if (unlisted.length) {
    const lead = "このチケットで変えるつもりの無かった画面の見た目が、main と比較して変わりました。コードレビューは、このチケットの変更が及んだものと判断し、理由ごとにまとめています。崩れていたら、ここで伝えてください。変わってよければ、そのままマージすると、新しい見た目が基準になります。";
    L.splice(4, 0, `**変えるつもりの無かった画面の変化**：${unlistedLine}。ページの畳んだ節で、前と後を見られます`, "");
    L.push(`<details><summary>変えるつもりの無かった画面の変化（${unlisted.length} 枚）</summary>`, "", lead, "");
    for (const g of unlistedGroups) {
      const [first, ...others] = g.changes;
      L.push(`**${reasonText(g)}（${g.changes.length} 枚）**`, "", ...changeTable([first]), "");
      if (others.length) L.push(`<details><summary>同じ理由のほかの画面（${others.length} 枚）</summary>`, "", ...changeTable(others), "", "</details>", "");
    }
    L.push("</details>", "");
    stat("unlisted", `${unlisted.length} 枚`, "変えるつもりの無かった画面の変化", "warn");
    sec("unlisted", "変えるつもりの無かった画面の変化", `<p class="note">${e(lead)}</p>${unlistedGroups.map((g) => {
      const [first, ...others] = g.changes;
      return `<h3>${e(reasonText(g))}（${g.changes.length} 枚）</h3>${changeHtml(first)}${others.length ? `<details><summary>同じ理由のほかの画面（${others.length} 枚）</summary>${others.map(changeHtml).join("")}</details>` : ""}`;
    }).join("")}`);
  }
  // 画面を開く節は、あなたが見て判断することのすぐ後（無ければ目的と CI の行の後）に置く
  if (opening) {
    L.splice(4, 0, ...opening.md);
    secFirst("open", "画面を開く", opening.html);
  }
  // あなたが見て判断することは、目的の直後（CI の行の後）に置く。人が確認する基盤の受入条件（001）、人が見る非機能要件と、
  // 承認の後に問わずに決めた振る舞い（変えるなら伝えてもらう）。要点も同じ中身を同じ順に並べる
  if (humanTech.length || human.length || unasked.length) {
    const note = [humanTech.length ? "テストでは確認できない基盤の受入条件です。あなたが確認してください。" : "", human.length ? "テストでは確認できない非機能要件です。あなたが確認して判断してください。" : "", unasked.length ? "承認の後に見つかった仕様の穴を、あなたに問わずに AI が決めた振る舞いです（テストで確認しています）。違う振る舞いにしたければ、ここで伝えてください。" : ""].filter(Boolean).join("");
    L.splice(4, 0, "## あなたが見て判断すること", "", ...humanTech.map((x) => `- ${exampleLine(x.item)}`), ...human.map((x) => `- ${x.item.statement}`), ...unasked.map((c) => `- ${unaskedLine(c)}`), "");
    secFirst("human", "あなたが見て判断すること", `<p class="note">${e(note)}</p>${humanTech.length ? `<div class="cards">${humanTech.map((x) => `<div class="ex res solo">${gwt(x.item)}</div>`).join("")}</div>` : ""}${human.length ? `<div class="cards">${human.map((x) => `<div class="item"><div class="txt">${e(x.item.statement)}</div></div>`).join("")}</div>` : ""}${[...new Set(unasked.map((c) => c.parent))].map((parent) => {
      const req = index.items.get(parent)?.item?.statement;
      return `<div class="rule"><div class="rule-head"><div class="tags"><span class="chip hot">承認の後に問わずに決めた振る舞い</span></div>${req ? `<p class="stmt">${e(req)}</p>` : ""}</div><div class="cards pad">${unasked.filter((c) => c.parent === parent).map((c) => `<div class="ex res solo"><div class="tags">${resultChip(c.key)}</div>${gwt(c.after)}</div>`).join("")}</div></div>`;
    }).join("")}`);
  }
  // ライブラリの変更。package.json はライブラリの欄だけを前と後で比較する（scripts などは作りの細部で、コードレビューが見る）。
  // ほかの依存の定義のファイルは、変わった行をそのまま出す
  const depFields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
  const libsOf = (text) => { try { const j = JSON.parse(text || "{}"); return Object.assign({}, ...depFields.map((k) => j[k] ?? {})); } catch { return {}; } };
  const showAt = (rev, f) => { try { return git("show", `${rev}:${f}`); } catch { return ""; } };
  // 変わった行（pairDiff の形）。行の頭に空白の無い変更（flask==3.0 など）も拾う
  const diffLines = (f) => fileDiff(root, from, f);
  const libGroups = [], rawFiles = [];
  for (const f of mine.files.dependencies.filter((x) => !/lock/i.test(x))) {
    if (path.basename(f) === "package.json") {
      const b = libsOf(showAt(from, f)), a = libsOf(existsSync(path.join(root, f)) ? readFileSync(path.join(root, f), "utf8") : "");
      const added = Object.keys(a).filter((k) => !(k in b)).map((k) => `${k} ${a[k]}`);
      const changed = Object.keys(a).filter((k) => k in b && a[k] !== b[k]).map((k) => `${k} ${b[k]} → ${a[k]}`);
      const removed = Object.keys(b).filter((k) => !(k in a)).map((k) => `${k} ${b[k]}`);
      for (const [label, xs] of [["足したライブラリ", added], ["版を変えたライブラリ", changed], ["外したライブラリ", removed]]) if (xs.length) libGroups.push({ f, label, xs });
    } else {
      const lines = diffLines(f).slice(0, 40);
      if (lines.length) rawFiles.push({ f, lines });
    }
  }
  if (libGroups.length || rawFiles.length) {
    const lead = "このチケットで足したライブラリ、版を変えたライブラリ、外したライブラリです。";
    // 依存のファイルが 2 つ以上変わったら（フロントエンドとバックエンドで分かれているなど）、どのファイルかを見出しに付ける
    const multi = new Set(libGroups.map((g) => g.f)).size + rawFiles.length > 1;
    const libLabel = (g) => (multi ? `${g.f}：${g.label}` : g.label);
    L.push("## ライブラリの変更", "", lead, "");
    for (const g of libGroups) L.push(`**${libLabel(g)}**`, "", ...g.xs.map((x) => `- \`${x}\``), "");
    for (const r of rawFiles) L.push(`**${r.f} の変わった行**`, "", ...mdLines(r.lines), "");
    misc.push(`<div class="kgroup"><h3>ライブラリの変更</h3><p class="note">${lead}</p>${libGroups.map((g) => `<div class="sub">${e(libLabel(g))}</div><ul class="dlist">${g.xs.map((x) => `<li><code>${e(x)}</code></li>`).join("")}</ul>`).join("")}${rawFiles.map((r) => `<div class="sub">${e(r.f)} の変わった行</div>${rawList(r.lines)}`).join("")}</div>`);
  }
  // 技術の土台の文書（architecture.md など）。後のチケットもこれに沿って作るので、変えたことを知らせる。
  // デザインシステムの値は「承認の後に変わったデザインシステムの値」と画面で見せる。001 はすべてを作るチケットなので出さない
  const TECH = "specs/_current/_tech/";
  const techDocs = ticket.startsWith("001-") ? [] : mine.files.tech_docs.filter((f) => f !== `${TECH}design.yaml` && !f.startsWith(DS_DIR));
  const isNew = (f) => { try { git("cat-file", "-e", `${from}:${f}`); return false; } catch { return true; } };
  // 変わった行は 40 行まで出し、残りは数だけ添える
  const techChanged = techDocs.filter((f) => !isNew(f)).map((f) => { const all = diffLines(f); return { f: f.slice(TECH.length), lines: all.slice(0, 40), rest: all.length - 40 }; }).filter((x) => x.lines.length);
  const techNew = techDocs.filter(isNew).map((f) => f.slice(TECH.length));
  if (techChanged.length || techNew.length) {
    const lead = "作り方の決まりの文書の変更です（業務の結果を画面や通信の形に写す決まり、ファイルの置き場所など）。後のチケットも、これに沿って作ります。見て判断していただくものではありません。";
    const more = (x) => (x.rest > 0 ? `（ほか ${x.rest} 行）` : "");
    L.push("## 技術文書の変更", "", lead, "");
    // 前と後を組にして続け、組にならない行は「追加」「削除」（文書の行にはバッククォートがよく入るので、それより長い印で囲む）
    for (const x of techChanged) L.push(`**${x.f} の変わった行**${more(x)}`, "", ...mdLines(x.lines), "");
    if (techNew.length) L.push("**新しく作った文書**", "", ...techNew.map((f) => `- ${f}`), "");
    misc.push(`<div class="kgroup"><h3>技術文書の変更</h3><p class="note">${lead}</p>${techChanged.map((x) => `<div class="sub">${e(x.f)} の変わった行${more(x)}</div>${rawList(x.lines)}`).join("")}${techNew.length ? `<div class="sub">新しく作った文書</div><ul class="dlist">${techNew.map((f) => `<li><code>${e(f)}</code></li>`).join("")}</ul>` : ""}</div>`);
  }
  // AI が決めた細部。テストで確認するもの（test: true）には、具体例と同じ結果のラベルを付ける（結果の鍵は <チケットの番号>/PD-xxx）
  const pds = details.details ?? [];
  if (pds.length) {
    const pdKey = (x) => `${ticket.slice(0, 3)}/${x.id}`;
    L.push(`<details><summary>AI が決めた細部（${pds.length} 件）</summary>`, "", ...pds.map((x) => `- ${x.test ? `${icon(pdKey(x))} ` : ""}${x.plain}`), "", "</details>", "");
    misc.push(`<details><summary>AI が決めた細部（${pds.length} 件）</summary><p class="note">テストで確認する細部には、テストの結果のラベルを付けています。ラベルの無いものは、テストは書かず、コードレビューで守られていることを確認した細部です。</p><ul class="dlist">${pds.map((x) => `<li><span>${e(x.plain)}</span>${x.test ? resultChip(pdKey(x)) : ""}</li>`).join("")}</ul></details>`);
  }
  if (misc.length) sec("misc", "そのほか", misc.join(""));

  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, clean(L));
  console.log(`Gate 2 の受け入れのページを書きました：${path.relative(root, out)}`);

  const status = readStatus(root, ticket);
  const repo = githubRepo(root);
  const prUrl = status?.pr && repo ? `https://github.com/${repo}/pull/${status.pr}` : null;

  // 要点（会話に出す）。マージを決めるのに要るものだけを並べ、全文はページに誘導する。あなたが見て判断することと画面を開く手順を先に置く
  // （下書きとページと同じ順）
  const S = [ciStatus, ""];
  const toJudge = [...humanTech.map((x) => exampleLine(x.item)), ...human.map((x) => x.item.statement), ...unasked.map(unaskedLine)];
  if (toJudge.length) S.push("**あなたが見て判断すること**", "", ...toJudge.map((x) => `- ${x}`), "");
  // 試すための起動とログインの情報（toolchain.yaml の start。seed と login は欄があるときだけ）。開くのは、このチケットの画面の URL（あれば）
  if (opening) S.push(...opening.summary);
  if (mineEx.length) S.push(`- このチケットで決めた具体例のうち、成功した数：${minePassed} / ${mineEx.length}`);
  S.push(old.length ? `- 前からある機能の具体例のうち、成功した数：${old.length - oldFailed.length} / ${old.length}` : "- 前からある機能のテストは、まだありません");
  S.push(...summaryTech);
  if (approved && after.length) S.push(`- 承認の後に変わった具体例：${after.length} 件`);
  if (movedScreens) S.push(`- 承認の後にモックが変わった画面：${movedScreens} 枚`);
  if (styledScreens) S.push(`- 承認の後に CSS か共通部品だけが変わった画面：${styledScreens} 枚`);
  if (dsAfter.length) S.push(`- 承認の後に変わったデザインシステムの値：${dsAfter.length} 個`);
  // 土台の CSS だけを変えたときも 1 行出す（変わった所の数。前と後の組は 1 か所に数える）
  if (baseAfter.length) S.push(`- 承認の後に変わった土台の CSS（日本語の折り返し、押したときの応答と動き、入力の部品の形）：${baseAfter.filter((l) => l.side !== "前").length} か所`);
  if (textsAfter.length) S.push(`- 承認の後に変わった画面の文：${textsAfter.length} 件`);
  if (checked.length) S.push(`- 計測と検査のうち、基準を満たした数：${checked.filter(Boolean).length} / ${checked.length}`);
  if (unlisted.length) S.push(`- 変えるつもりの無かった画面の変化：${unlistedLine}。ページで前と後を見て、崩れていたら伝えてください`);
  const partAll = (verify.screenshots?.part_changes ?? []).flatMap((g) => g.changes);
  if (partAll.length) S.push(`- 共通部品を変えて見た目が変わった画面：${new Set(partAll.map((u) => shotParts(u).slice(0, 2).join("/"))).size} 画面、${partAll.length} 枚（コードレビューが画面ごとに 1 枚を見て、崩れの無いことを確認しました）`);
  S.push("");
  if (summaryFailed.length) S.push("**成功しなかった具体例**", "", ...summaryFailed, "");
  const unmeasuredLines = [...unmeasured.map((x) => `- ${x}`), ...(staleMeasure ? [...measured.values()].map((r) => `- ${nfrText(r.name)}（計測の後にコードが変わった）`) : [])];
  if (unmeasuredLines.length) S.push("**未計測の非機能要件**（計測を足させるか流し直させるか、このまま受け入れるかを決めてください）", "", ...unmeasuredLines, "");
  if (unbound.length) S.push("**確認するコマンドが決まっていない非機能要件**（検査を足させるか、このまま受け入れるかを決めてください）", "", ...unbound.map((x) => `- ${x}`), "");
  S.push(prUrl ? `画面と具体例の全文はページで見られます。PR にも同じものがあります：${prUrl}` : "画面と具体例の全文はページで見られます。PR にも同じものがあります", "");
  const summaryFile = path.join(path.dirname(out), "gate2-summary.md");
  writeFileSync(summaryFile, clean(S));
  console.log(`要点を書きました：${path.relative(root, summaryFile)}`);

  // 手元のページ。見出し、数字のカード、リンク、タブ、節の順
  if (prUrl) links.push([prUrl, `GitHub の PR #${status.pr}`, "PR を開いてマージする ↗"]);
  // 仕様の全体のページ（同じフォルダ。相対のリンクで指す）。作れなくても受け入れのページは作る
  if (tryWriteSpecBook(root, path.join(path.dirname(htmlFile), "spec-book.html"), { ticket }, "受け入れのページ")) links.unshift(["spec-book.html", "仕様の全体", "仕様の全体を読む ↗"]);
  const head = [`<header class="top"><div class="eyebrow">Gate 2：受け入れ</div><h1>${e(title)}</h1><p class="lede">${e(purpose)}</p>`, `<div class="stats">${stats.join("")}</div>`,
    links.length ? `<div class="links">${links.map(([u, k, go]) => `<a class="golink" href="${e(u)}" target="_blank"><span class="gk">${e(k)}</span><span class="go">${go}</span></a>`).join("")}</div>` : "", `</header>`];
  const body = [...head, `<nav class="tabs">${nav.map(([id, t]) => `<a href="#${id}">${e(t)}</a>`).join("")}</nav>`, ...B].join("\n");
  writeFileSync(htmlFile, page(`${title}（Gate 2：受け入れ）`, body, GATE2_CSS));
  console.log(`手元のページを書きました：${path.relative(root, htmlFile)}`);
} catch (e) {
  console.error(`Gate 2 の受け入れのページを作れませんでした（${e.message}）。`);
  process.exit(2);
}

