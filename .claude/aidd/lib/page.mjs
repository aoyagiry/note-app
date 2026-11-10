// 手元のページ（HTML）の外枠と、共通の見た目（色、カード、ラベル、タブ、具体例の枠）。approval-draft.mjs と gate2-report.mjs が使う。
// 色はライトとダークの両方を持つ。PNG は呼ぶ側が、ページからの相対パスで指す。

import { existsSync } from "node:fs";
import path from "node:path";

/** HTML の特殊文字を逃がす。 */
export const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 具体例は「前提 → すること → 結果」の 3 段。段ごとに枠で区切り、見出しと文の対応が分かるようにする。 */
export const gwt = (x) => `<ol class="gwt">${x.given ? `<li><span class="k">前提</span><span class="v">${esc(x.given)}</span></li>` : ""}${x.when ? `<li><span class="k">すること</span><span class="v">${esc(x.when)}</span></li>` : ""}<li class="then"><span class="k">結果</span><span class="v">${esc(x.then)}</span></li></ol>`;

/** Markdown のコードの印。中にバッククォートがあっても崩れないよう、それより長い印で囲む。 */
export const codeSpan = (t) => { const n = Math.max(0, ...[...String(t).matchAll(/`+/g)].map((m) => m[0].length)) + 1; const f = "`".repeat(n); return `${f}${n > 1 ? " " : ""}${t}${n > 1 ? " " : ""}${f}`; };

/** 行の配列を 1 つの文にする。3 つ以上続く改行は 2 つにする。 */
export const clean = (xs) => xs.join("\n").replace(/\n{3,}/g, "\n\n");

/** 値の表で、色の値には見本の四角を添える。 */
export const swatch = (v) => (v === undefined ? "（無し）" : /^#[0-9a-f]{3,8}$/i.test(v) ? `<span class="sw" style="background:${esc(v)}"></span>${esc(v)}` : esc(v));

/** 変わった行の並び（[{ side, text }]）。 */
export const rawList = (lines) => `<ul class="dlist">${lines.map((l) => `<li class="raw"><span class="lbl">${esc(l.side)}</span> <code>${esc(l.text)}</code></li>`).join("")}</ul>`;

/** 画像（rel はリポジトリからのパス）。ページのフォルダ（fromDir）からの相対パスで指す。ファイルが無ければ、none の文を出す。 */
export const shot = (root, fromDir, rel, alt, none) => {
  if (!existsSync(path.join(root, rel))) return `<div class="noshot">${esc(alt)}${none}</div>`;
  const src = path.relative(fromDir, path.join(root, rel)).split(path.sep).join("/");
  return `<a class="shot" href="${esc(src)}" target="_blank" title="大きく見る"><img src="${esc(src)}" alt="${esc(alt)}" loading="lazy"></a>`;
};

/** ページの外枠。title はタブの名前、body は中身の HTML、css はそのページだけの見た目。 */
export const page = (title, body, css = "") => `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
${BASE_CSS}${css ? `\n${css}` : ""}
</style>
</head>
<body>
${body}
</body>
</html>
`;

const BASE_CSS = `:root { --bg: #f5f6f8; --surface: #fff; --surface-2: #eceff4; --fg: #1b2230; --muted: #5a6476; --line: #d5dae3;
  --acc: #2563c9; --acc-soft: #e3ecfb; --ok: #1f7a4d; --ok-soft: #e1f3e9; --warn: #9a5b00; --warn-soft: #fbefd9; --bad: #b42335; --bad-soft: #fbe3e6; --hot: #b45309; --hot-soft: #fdecd6; }
@media (prefers-color-scheme: dark) { :root { --bg: #12161e; --surface: #1a202b; --surface-2: #232b38; --fg: #e6e9ef; --muted: #9aa4b6; --line: #2f3847;
  --acc: #8ab4ff; --acc-soft: #1f2d48; --ok: #6fd49a; --ok-soft: #17331f; --warn: #f2c06b; --warn-soft: #3b3018; --bad: #ff8a95; --bad-soft: #3d1f24; --hot: #fbbf6a; --hot-soft: #3b2a14; color-scheme: dark; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.75 "Hiragino Sans", "Yu Gothic UI", "Meiryo", sans-serif; padding: 0 16px 64px; }
header.top, nav.tabs, section { max-width: 1080px; margin: 0 auto; }
h1, h2, h3 { line-height: 1.4; margin: 0; } h1 { font-size: 1.9rem; font-weight: 800; } h2 { font-size: 1.35rem; } h3 { font-size: 1.05rem; margin-top: 8px; }
p { margin: 0; } a { color: var(--acc); }
header.top { padding: 32px 0 20px; display: grid; gap: 12px; }
.eyebrow { font-size: .78rem; letter-spacing: .12em; color: var(--muted); }
.lede { color: var(--muted); max-width: 70ch; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(170px, 100%), 1fr)); gap: 10px; }
.stat { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; display: grid; gap: 2px; color: inherit; text-decoration: none; }
.stat b { font-size: 1.6rem; line-height: 1.2; } .stat span { color: var(--muted); font-size: .82rem; }
.stat.hot { border-color: var(--hot); background: var(--hot-soft); } .stat .aff-some { color: var(--hot); } .stat .aff-none { color: var(--ok); }
.links { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap: 10px; }
a.golink { display: grid; gap: 2px; padding: 10px 14px; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; text-decoration: none; color: var(--fg); }
a.golink:hover, a.golink:focus-visible { border-color: var(--acc); outline: none; }
a.golink .gk { font-size: .82rem; color: var(--muted); }
a.golink .go { color: var(--acc); font-weight: 700; text-decoration: underline; text-underline-offset: 3px; }
nav.tabs { position: sticky; top: 0; z-index: 5; background: var(--bg); border-bottom: 1px solid var(--line); display: flex; gap: 4px; overflow-x: auto; }
nav.tabs a { padding: 12px 14px 10px; font-weight: 700; font-size: .92rem; color: var(--muted); text-decoration: none; border-bottom: 3px solid transparent; white-space: nowrap; }
nav.tabs a:hover { color: var(--fg); border-bottom-color: var(--acc); }
section { padding-top: 28px; display: grid; gap: 14px; scroll-margin-top: 48px; }
.note { color: var(--muted); font-size: .9rem; } .sub { font-weight: 700; font-size: .85rem; color: var(--muted); }
.tags { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { display: inline-flex; align-items: center; font-size: .74rem; font-weight: 700; padding: 1px 9px; border-radius: 999px; background: var(--surface-2); color: var(--muted); white-space: nowrap; text-decoration: none; border: 1px solid color-mix(in srgb, currentColor 30%, transparent); }
.chip.ok { background: var(--ok-soft); color: var(--ok); } .chip.warn { background: var(--warn-soft); color: var(--warn); } .chip.bad { background: var(--bad-soft); color: var(--bad); }
.chip.hot { background: var(--hot-soft); color: var(--hot); } .chip.acc { background: var(--acc-soft); color: var(--acc); }
a.chip.dec { background: var(--hot-soft); color: var(--hot); text-decoration: none; } a.chip.dec:hover { text-decoration: underline; }
.why { margin-top: 10px; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px; font-size: .9rem; }
.why ul { margin: 4px 0 0; padding-left: 1.2em; } .why p { margin: 6px 0 0; color: var(--muted); }
.item { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 8px 12px; } .item .txt { min-width: 200px; } .item .txt { flex: 1; } .item .txt p { margin: 0; } .item > .chip { flex: none; }
.item.gone { opacity: .7; } .aux { color: var(--muted); font-size: .88rem; } .aux .lbl { margin-right: 8px; }
.kgroup { display: grid; gap: 8px; } .kgroup h3 { font-size: .95rem; color: var(--muted); }
.cards { display: grid; gap: 8px; } .cards.tickets { grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr)); }
.tcard { flex-direction: column; gap: 8px; } .tcard > .chip { align-self: flex-start; } .tcard .txt { display: grid; gap: 4px; align-content: start; flex: 1; } .tid { font-size: .78rem; font-weight: 700; color: var(--muted); font-family: ui-monospace, Menlo, monospace; } .tcard p { color: var(--muted); font-size: .9rem; } .tcard .tags { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; } .tcard .tags .chip { white-space: normal; }
.scope-cards { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr)); }
.sc { border-radius: 10px; padding: 12px 16px; border: 1px solid var(--line); } .sc h3 { margin: 0 0 8px; font-size: 1.1rem; }
.sc.users { background: var(--acc-soft); } .sc.inc { background: var(--ok-soft); } .sc.exc { background: var(--surface-2); }
.sc ul { list-style: none; margin: 0; padding: 0; } .sc li { padding: 7px 0; border-top: 1px solid color-mix(in srgb, var(--fg) 12%, transparent); line-height: 1.6; }
.sc > ul > li:first-child { border-top: 0; } .sc li .chip { margin-left: 8px; }
.sc li.grp { padding: 0; border-top: 0; margin-top: 10px; } .sc li.grp:first-child { margin-top: 0; }
.sc li.grp > b { display: inline-block; font-size: .78rem; color: var(--muted); letter-spacing: .04em; margin-bottom: 2px; }
.sc li.grp > ul > li:first-child { border-top: 0; }
.rule { border: 1px solid var(--line); border-radius: 10px; background: var(--surface); overflow: hidden; }
.rule.proposed, .item.proposed { border-left: 4px solid var(--hot); }
.rule-head { padding: 12px 16px; display: grid; gap: 6px; background: var(--surface-2); }
.ex { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 380px); gap: 16px; padding: 12px 16px; border-top: 1px solid var(--line); align-items: start; }
.ex .ex-text { display: grid; gap: 6px; } .ex.gone { grid-template-columns: 1fr; opacity: .7; }
.ex.solo { grid-template-columns: 1fr; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; } #techac details { margin-top: 12px; } #techac .kgroup { margin-top: 10px; } #techac .who { margin-top: 14px; display: grid; gap: 8px; } #techac h4 { margin: 0; font-size: .9rem; color: var(--muted); }
.tags:empty { display: none; }
@media (max-width: 760px) { .ex { grid-template-columns: 1fr; } }
ol.gwt { list-style: none; margin: 0; padding: 0; display: grid; gap: 0; font-size: .92rem; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
ol.gwt li { display: grid; grid-template-columns: 5.5em 1fr; align-items: baseline; border-top: 1px solid var(--line); }
ol.gwt li:first-child { border-top: 0; }
ol.gwt .k { align-self: stretch; padding: 6px 10px; background: var(--surface-2); color: var(--muted); font-size: .78rem; font-weight: 700; }
ol.gwt .v { padding: 6px 12px; }
ol.gwt li.then .k { background: var(--acc-soft); color: var(--acc); } ol.gwt li.then .v { font-weight: 600; }
.stmt { font-weight: 600; }
.was { color: var(--muted); } .was, .now { display: grid; gap: 4px; }
.lbl { font-size: .75rem; font-weight: 700; color: var(--muted); }
.more a { color: var(--hot); font-weight: 700; font-size: .9rem; } .decides { display: grid; gap: 10px; }
.item { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px; }
a.shot { display: block; } a.shot img { display: block; width: 100%; max-height: 300px; object-fit: contain; object-position: top left; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
.noshot { font-size: .85rem; color: var(--muted); border: 1px dashed var(--line); border-radius: 6px; padding: 18px; text-align: center; }
.gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(280px, 100%), 1fr)); gap: 16px; }
figure { margin: 0; display: grid; gap: 6px; align-content: start; } figcaption { font-size: .85rem; color: var(--muted); }
article.card { background: var(--surface); border: 1px solid var(--line); border-top: 3px solid var(--warn); border-radius: 10px; padding: 16px 18px; display: grid; gap: 10px; }
dl.kv { margin: 0; display: grid; grid-template-columns: minmax(110px, max-content) 1fr; gap: 6px 16px; font-size: .92rem; } dl.kv dt { color: var(--muted); font-weight: 700; } dl.kv dd { margin: 0; }
.callout { background: var(--surface-2); border-radius: 8px; padding: 10px 14px; display: grid; gap: 2px; font-size: .92rem; } .callout b { font-size: .82rem; color: var(--muted); } .callout.ans { background: var(--ok-soft); } .callout.ans b { color: var(--ok); }
.table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; }
table { border-collapse: collapse; width: 100%; font-size: .9rem; } th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--line); } th { background: var(--surface-2); color: var(--muted); font-size: .8rem; }
.sw { display: inline-block; width: 14px; height: 14px; border-radius: 3px; border: 1px solid var(--line); vertical-align: -2px; margin-right: 6px; }
details { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 8px 16px 12px; } details > summary { cursor: pointer; font-weight: 700; color: var(--acc); padding: 4px 0; }
ul.items { margin: 0; padding-left: 1.2em; display: grid; gap: 4px; }
ul.dlist { list-style: none; margin: 4px 0 0; padding: 0; } ul.dlist li { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 6px 12px; padding: 10px 2px; border-top: 1px solid var(--line); line-height: 1.7; }
ul.dlist li:first-child { border-top: 0; } ul.dlist li > span:first-child:not(.lbl) { flex: 1; min-width: 200px; } ul.dlist li.raw { justify-content: flex-start; } ul.dlist code { word-break: break-all; }
code { font-family: ui-monospace, Menlo, monospace; font-size: .88em; background: var(--surface-2); padding: 1px 5px; border-radius: 4px; }
article.q { background: var(--surface); border: 1px solid var(--line); border-left: 5px solid var(--hot); border-radius: 10px; padding: 16px 20px; display: grid; gap: 12px; scroll-margin-top: 56px; }
.q-head { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; } .qno { font-weight: 800; color: var(--hot); font-size: .85rem; letter-spacing: .06em; }
.opts { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr)); gap: 10px; }
.opt { border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; display: grid; gap: 4px; align-content: start; background: var(--bg); }
.opt.prop { border: 2px solid var(--acc); background: var(--acc-soft); } .opt.chosen { border: 2px solid var(--ok); background: var(--ok-soft); }
.opt p { color: var(--muted); font-size: .88rem; } .opt .chip { justify-self: start; }
.opt .tags { display: flex; gap: 6px; } .opt .chip.ok { background: var(--ok); color: var(--surface); }`;
