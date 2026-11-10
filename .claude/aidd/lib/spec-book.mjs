// 仕様の全体のページ。人が仕様の全体を通して読むための 1 枚の HTML を、作業ツリーの specs/_current
// （_intent、_shared、領域の requirements.yaml と mock/canvas.yaml）と specs/*/plan/details.yaml から作る。AI は使わない。
// 作業ツリーを読むので、Gate のページから開いたとき、そのチケットの変更も入っている。コミットしない（/aidd-init が .gitignore に
// specs/*/results/spec-book.html を足す）。approval-draft.mjs と gate2-report.mjs が自分のページを作るたびに同じフォルダに作り直し、
// ページの上のリンクから相対のリンクで指す。人が仕様の全体を読みたいと言ったときは bin/spec-book.mjs で作る。
// 人には ID を見せない。本文の ID と uses は、指す項目の短い名前のリンクにする。
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildIndex, isBase, usesOf } from "./id-graph.mjs";
import { areaHeading, exampleLine, readYaml, readJson } from "./render.mjs";
import { esc as e, page } from "./page.mjs";

/** ページの中の項目の印（リンクの先）。項目のキー（rooms/REQ-register など）から作る。 */
export const anchorOf = (key) => `k-${String(key).replace(/[^A-Za-z0-9_-]/g, "-")}`;

const CHECK = { measurement: "計測", tool: "検査の道具", human: "人が見る", test: "テスト" };
const KIND_LABEL = { REQ: "要件", RULE: "共通の要件", NFR: "非機能要件", FACT: "前提", GOAL: "目的", TERM: "用語", AC: "具体例", PD: "計画の決め事" };
// 本文の ID。領域を付けた形（rooms/REQ-x、_intent/FACT-x、journeys/signup/REQ-x）、番号を付けた計画の決め事（005/PD-005）と、付けない形
const ID = /(?<![\w/-])((?:[a-z_][a-z0-9-]*\/){0,2}|\d{3}\/)((?:REQ|RULE|NFR|TERM|FACT|GOAL|AC|PD)-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)/g;
const SPACED_ID = new RegExp(` ?${ID.source} ?`, "g");
const clip = (t, n = 20) => { const s = String(t ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? `${s.slice(0, n)}…` : s; };

/**
 * 領域の並び：その領域の requirements.yaml を最初に足したコミットの順（git log --diff-filter=A）。まだコミットしていない領域は
 * その後ろに名前の順で並べ、流れの領域（journeys/）は最後に置く。
 */
function areaOrder(root, areas) {
  let log = "";
  try {
    log = execFileSync("git", ["-C", root, "log", "--reverse", "--diff-filter=A", "--format=", "--name-only", "--", ":(glob)specs/_current/**/requirements.yaml"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 << 20 });
  } catch { /* 履歴が無ければ名前の順 */ }
  const seen = [];
  for (const f of log.split("\n")) {
    const m = f.match(/^specs\/_current\/(.+)\/requirements\.yaml$/);
    if (m && !seen.includes(m[1])) seen.push(m[1]);
  }
  const rank = (a) => (seen.includes(a) ? seen.indexOf(a) : seen.length);
  const journey = (a) => (a.startsWith("journeys/") ? 1 : 0);
  return [...areas].sort((a, b) => journey(a) - journey(b) || rank(a) - rank(b) || a.localeCompare(b));
}

/**
 * 文の中の ID を人に見せる名前にする道具（人には ID を見せない）。仕様の全体のページと、Gate 1 の承認のページの「仕様のレビューで
 * 残った指摘」で使う。
 * - find(scope, id, ctx)：参照を索引のキーにする。ctx は文のある所（area は領域、num は計画の決め事のチケットの番号）。付けない ID は、
 *   その領域、そのチケットの計画の決め事、共通、システム全体の順に探し、無ければ同じ ID の項目を探す（計画の決め事の番号はチケットごとなので探さない）
 * - fullText(k)：項目の全文。中の ID は種類の名前（用語は用語の名前）にする
 * - labelOf(k)：リンクの名前。用語なら用語の名前、ほかは文の頭（20 字）
 * - nameIds(text, ctx)：文の中の ID を、指す項目の全文を「」で囲んだものにする。指す項目が無ければ種類の名前にする。ID の前後の
 *   半角の空白（日本語の文で ID を区切るもの）は除く
 */
export function idNames(index) {
  const items = [...index.items.values()];
  const get = (k) => index.items.get(k);
  const resolve = (ref, ctx = {}) => {
    const r = String(ref);
    if (r.includes("/")) return index.items.has(r) ? r : null;
    for (const k of [`${ctx.area}/${r}`, `${ctx.num}/${r}`, `_shared/${r}`, `_intent/${r}`]) if (index.items.has(k)) return k;
    return r.startsWith("PD-") ? null : items.find((x) => x.key.endsWith(`/${r}`))?.key ?? null;
  };
  const find = (scope, id, ctx = {}) => resolve(`${scope}${id}`, ctx) ?? (scope ? resolve(id, ctx) : null);
  const kindLabel = (id) => KIND_LABEL[id.split("-")[0]] ?? "";
  const deId = (t) => String(t ?? "").replace(ID, (m, scope, id) => {
    const k = find(scope, id);
    return k && get(k).kind === "TERM" ? get(k).item.name : kindLabel(id);
  });
  const fullText = (k) => {
    const x = get(k);
    return deId(x.kind === "TERM" ? `${x.item.name}：${x.item.definition}` : x.kind === "AC" ? exampleLine(x.item) : x.kind === "PD" ? x.item.plain : x.item.statement);
  };
  const labelOf = (k) => (get(k).kind === "TERM" ? get(k).item.name : clip(fullText(k)));
  const nameIds = (text, ctx = {}) => String(text ?? "").replace(SPACED_ID, (m, scope, id) => {
    const k = find(scope, id, ctx);
    return k ? `「${fullText(k)}」` : kindLabel(id);
  });
  return { find, fullText, labelOf, nameIds, kindLabel };
}

/** 仕様の全体のページの HTML。ticket を渡すと、そのチケットの作業中の仕様と見出しに書く。 */
export function specBook(root, { ticket = null } = {}) {
  const index = buildIndex(root);
  const items = [...index.items.values()];
  const get = (k) => index.items.get(k);
  const areas = areaOrder(root, index.areas.filter((a) => !isBase(a)));

  // 本文の ID と uses は、指す項目の短い名前のリンクにする（全文はリンクの title に置く）
  const { find, fullText, labelOf, kindLabel } = idNames(index);
  const ref = (k) => `<a class="ref" href="#${anchorOf(k)}" title="${e(fullText(k))}">${e(labelOf(k))}</a>`;
  const linkIds = (text, ctx) => e(text).replace(ID, (m, scope, id) => {
    const k = find(scope, id, ctx);
    return k ? ref(k) : e(kindLabel(id));
  });
  // uses の参照（前提と目的は「目的と前提」の節にまとめて出すので除く）
  const usesLine = (x) => {
    const ks = [...new Set(usesOf(x).map((r) => find("", r, { area: x.area })).filter((k) => k && !["FACT", "GOAL"].includes(get(k).kind)))];
    return ks.length ? `<p class="uses">関わるもの：${ks.map(ref).join("　")}</p>` : "";
  };
  const exampleLi = (y) => {
    const ctx = { area: y.area }, x = y.item;
    const scene = [x.given && `<span class="given">${linkIds(x.given, ctx)}</span>`, x.when && `<span class="when">${linkIds(x.when, ctx)}</span>`].filter(Boolean).join('<span class="sep">／</span>');
    return `<li class="ex" id="${anchorOf(y.key)}">${scene}${scene ? '<span class="arrow">→</span>' : ""}<span class="then">${linkIds(x.then, ctx)}</span></li>`;
  };
  // 要件と共通の要件。共通の要件の下には代表の具体例
  const reqHtml = (x) => {
    const exs = items.filter((y) => y.parent === x.key);
    return `<article class="req" id="${anchorOf(x.key)}"><p class="label">${x.kind === "RULE" ? "共通の要件" : "要件"}</p><p class="statement">${linkIds(x.item.statement, { area: x.area })}</p>${usesLine(x)}`
      + (exs.length ? `<p class="label ex-label">具体例（${exs.length}）<span class="howto">前提 ／ 操作 → 結果</span></p><ol class="examples">${exs.map(exampleLi).join("")}</ol>` : "")
      + "</article>";
  };
  const nfrLi = (x) => `<li id="${anchorOf(x.key)}">${linkIds(x.item.statement, { area: x.area })}<span class="check">${e(CHECK[x.item.check] ?? x.item.check)}</span></li>`;

  // 計画の決め事（details.yaml の plain）を、領域ごとに畳んで出す。same_as の写しは除く。領域は、理由か決め事の文が最初に指す要件の領域、
  // 無ければそのチケットの仕様の差分（results/spec-diff.json）で変えた項目が最も多い領域。001 の分と、どの領域にも決まらない分は「技術の土台」
  const pds = items.filter((x) => x.kind === "PD" && !x.item.same_as && x.item.plain);
  // replaces で後のチケットに変えられた決め事 → 変えたチケットの番号
  const replacedBy = new Map();
  for (const x of pds) for (const r of x.item.replaces ?? []) replacedBy.set(String(r), x.key.slice(0, 3));
  const reqArea = (text) => {
    for (const m of String(text ?? "").matchAll(ID)) {
      if (!m[2].startsWith("REQ-")) continue;
      const k = find(m[1], m[2]);
      if (k && areas.includes(get(k).area)) return get(k).area;
    }
    return null;
  };
  const mainArea = (dir) => {
    const n = new Map();
    for (const c of readJson(root, `specs/${dir}/results/spec-diff.json`)?.changes ?? []) if (areas.includes(c.area)) n.set(c.area, (n.get(c.area) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1] || areas.indexOf(a[0]) - areas.indexOf(b[0]))[0]?.[0] ?? null;
  };
  const pdByArea = new Map();
  for (const x of pds) {
    const dir = x.file.split("/")[1];
    const num = dir.slice(0, 3);
    const area = num === "001" ? "_tech" : reqArea(`${x.item.reason ?? ""} ${x.item.decision ?? ""}`) ?? mainArea(dir) ?? "_tech";
    pdByArea.set(area, [...(pdByArea.get(area) ?? []), { key: x.key, num, item: x.item, by: replacedBy.get(x.key) ?? null }]);
  }
  const PD_NOTE = "チケットごとの計画で決めたことを、新しいチケットから順に並べています。どれもそのチケットのときの記録です。後のチケットで変えたと計画に書かれたものは、下に畳んでいます（要件と具体例は今の仕様です）。";
  const pdSection = (area) => {
    const all = [...(pdByArea.get(area) ?? [])].sort((a, b) => b.num.localeCompare(a.num));
    if (!all.length) return "";
    const now = all.filter((x) => !x.by), old = all.filter((x) => x.by);
    const li = (x) => `<li id="${anchorOf(x.key)}">${linkIds(x.item.plain, { area, num: x.num })}<span class="check">${x.num} で決めた${x.item.test ? "、テストで確認" : ""}</span>${x.by ? `<span class="check changed">後のチケットで変わった（${x.by} で変えた）</span>` : ""}</li>`;
    return `<h3>計画で決めたこと（${now.length}）</h3><details class="pds"><summary>開く</summary><p class="note">${PD_NOTE}</p><ul class="pd">${now.map(li).join("")}</ul>`
      + (old.length ? `<details class="pds"><summary>後のチケットで変わった決め事（${old.length}）</summary><ul class="pd">${old.map(li).join("")}</ul></details>` : "")
      + "</details>";
  };

  const of = (kind, area) => items.filter((x) => x.kind === kind && (!area || x.area === area));
  const goals = of("GOAL", "_intent"), facts = of("FACT", "_intent"), terms = of("TERM", "_shared"), rules = of("RULE", "_shared"), nfrs = of("NFR", "_shared");
  const sections = [];
  const toc = [];
  const sec = (id, title, body) => { toc.push([id, title]); sections.push(`<section id="${id}"><h2>${e(title)}</h2>${body}</section>`); };
  if (goals.length || facts.length) {
    sec("system", "目的と前提", (goals.length ? `<h3>目的</h3><ul>${goals.map((x) => `<li id="${anchorOf(x.key)}"><b>${linkIds(x.item.statement, { area: "_intent" })}</b>${x.item.success ? `<br><span class="success">成功の目安：${linkIds(x.item.success, { area: "_intent" })}</span>` : ""}</li>`).join("")}</ul>` : "")
      + (facts.length ? `<h3>前提</h3><ul>${facts.map((x) => `<li id="${anchorOf(x.key)}">${linkIds(x.item.statement, { area: "_intent" })}</li>`).join("")}</ul>` : ""));
  }
  if (terms.length) sec("terms", "用語", `<dl>${terms.map((x) => `<dt id="${anchorOf(x.key)}">${e(x.item.name)}</dt><dd>${linkIds(x.item.definition, { area: "_shared" })}</dd>`).join("")}</dl>`);
  if (rules.length) sec("rules", "共通の要件", rules.map(reqHtml).join(""));
  areas.forEach((a, i) => {
    const spec = readYaml(root, `specs/_current/${a}/requirements.yaml`) ?? {};
    const canvas = readYaml(root, `specs/_current/${a}/mock/canvas.yaml`)?.url;
    const screens = spec.screens ?? [];
    const reqs = of("REQ", a), nfr = of("NFR", a);
    sec(`area-${i + 1}`, areaHeading(index, a), (screens.length ? `<div class="screens"><h3>画面</h3><ul>${screens.map((s) => `<li>${e(s.title)}</li>`).join("")}</ul>${canvas ? `<p class="canvas"><a href="${e(canvas)}" target="_blank">キャンバスで画面を見る ↗</a></p>` : ""}</div>` : "")
      + (reqs.length ? `<h3>要件と具体例</h3>${reqs.map(reqHtml).join("")}` : "")
      + (nfr.length ? `<h3>この領域の非機能要件</h3><ul class="nfr">${nfr.map(nfrLi).join("")}</ul>` : "")
      + pdSection(a));
  });
  const techPd = pdSection("_tech");
  if (techPd) sec("tech", "技術の土台", `<p class="note">基盤づくり（001）の計画で決めたことと、どの領域にも当たらない計画の決め事です。</p>${techPd}`);
  if (nfrs.length) sec("nfr", "共通の非機能要件", `<ul class="nfr">${nfrs.map(nfrLi).join("")}</ul>`);

  const reqCount = items.filter((x) => x.kind === "REQ" && areas.includes(x.area)).length;
  const exCount = items.filter((x) => x.kind === "AC" && x.parent && x.area !== "_tech").length;
  const lead = `${ticket ? `チケット ${ticket} の作業中の仕様です（このチケットの変更も入っています）。` : "今の作業ツリーの仕様です。"}要件 ${reqCount}、具体例 ${exCount}、計画で決めたこと ${pds.length}。読むだけのページで、仕様の元は specs/_current の YAML です。`;
  // 目次は、領域の名前（領域の目的の文）が長いので頭の 24 字にし、全文を title に置く
  const body = `<div class="book"><nav class="toc" aria-label="目次"><ol>${toc.map(([id, t]) => `<li><a href="#${id}" title="${e(t)}">${e(clip(t, 24))}</a></li>`).join("")}</ol></nav><main>`
    + `<header><h1>仕様の全体</h1><p>${e(lead)}</p></header>${sections.join("\n")}</main></div>`;
  return page("仕様の全体", body, BOOK_CSS);
}

/** 仕様の全体のページを file に書く。 */
export function writeSpecBook(root, file, opts = {}) {
  const html = specBook(root, opts);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, html);
  return file;
}

// 仕様の全体のページだけの見た目（色はページの外枠の値を使い、ライトとダークの両方に効く）
const BOOK_CSS = `.book { display: grid; grid-template-columns: 15rem minmax(0, 46rem); gap: 3rem; max-width: 66rem; margin: 0 auto; padding: 2.5rem 0 6rem; word-break: auto-phrase; line-break: strict; }
.book nav.toc { position: sticky; top: 1.5rem; align-self: start; font-size: .9rem; } .book nav.toc ol { list-style: none; padding: 0; margin: 0; } .book nav.toc li { margin: .2rem 0; }
.book nav.toc a { color: var(--muted); text-decoration: none; } .book nav.toc a:hover { color: var(--acc); }
.book section { max-width: none; margin: 0; padding: 0; display: block; scroll-margin-top: 1rem; }
.book header h1 { font-size: 1.9rem; margin: 0 0 .3rem; } .book header p { color: var(--muted); font-size: .9rem; }
.book h2 { font-size: 1.45rem; margin: 3.2rem 0 .6rem; padding-top: 1rem; border-top: 2px solid var(--fg); } .book h3 { font-size: 1.05rem; margin: 2rem 0 .6rem; color: var(--muted); }
.book .success { color: var(--muted); font-size: .92rem; }
.book .req { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 1rem 1.2rem; margin: 0 0 1rem; scroll-margin-top: 1rem; }
.book .req:target, .book li:target, .book dt:target { outline: 2px solid var(--acc); outline-offset: 4px; }
.book .statement { margin: 0 0 .4rem; } .book .label { margin: 0 0 .2rem; font-size: .75rem; font-weight: 700; letter-spacing: .08em; color: var(--acc); }
.book .ex-label { margin-top: .9rem; padding-top: .6rem; border-top: 1px dashed var(--line); } .book .howto { margin-left: .8rem; font-weight: 400; color: var(--muted); letter-spacing: 0; }
.book a.ref { color: var(--acc); font-size: .85em; text-decoration: none; border-bottom: 1px dotted var(--acc); } .book .uses { margin: .2rem 0 .6rem; font-size: .82rem; color: var(--muted); }
.book .examples { margin: .4rem 0 0; padding-left: 1.4rem; font-size: .93rem; } .book .ex { margin: .5rem 0; } .book .sep, .book .arrow { color: var(--acc); margin: 0 .35rem; font-weight: 700; } .book .then { font-weight: 600; }
.book dl { display: grid; grid-template-columns: 9rem 1fr; gap: .4rem 1rem; } .book dt { font-weight: 700; } .book dd { margin: 0; }
.book ul.nfr li { margin: .5rem 0; } .book .check { display: inline-block; margin-left: .5rem; font-size: .75rem; padding: 0 .5rem; border-radius: 99px; background: var(--surface-2); color: var(--muted); }
.book .check.changed { background: var(--warn-soft); color: var(--warn); }
.book .pds { margin: .6rem 0 0; font-size: .9rem; } .book .pds summary { cursor: pointer; color: var(--acc); } .book .pd { margin: .3rem 0 0; padding-left: 1.2rem; } .book .pd li { margin: .3rem 0; }
.book .screens ul { margin: .2rem 0; padding-left: 1.2rem; } .book .canvas a { color: var(--acc); }
@media (max-width: 52rem) { .book { grid-template-columns: 1fr; gap: 1rem; } .book nav.toc { position: static; } .book dl { grid-template-columns: 1fr; } }`;

/**
 * 仕様の全体のページを書く。作れなければ、理由を stderr に出して false を返す
 * （pageName は呼ぶ側のページの名前。そのページは、仕様の全体へのリンクを付けずに作る）。
 */
export function tryWriteSpecBook(root, file, opts, pageName) {
  try {
    writeSpecBook(root, file, opts);
    return true;
  } catch (err) {
    console.error(`仕様の全体のページを作れませんでした（${err.message}）。${pageName}は、仕様の全体へのリンクを付けずに作ります。`);
    return false;
  }
}
