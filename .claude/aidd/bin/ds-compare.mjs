// デザインシステムの候補の比較のページを作る。プロダクトリードが、001 の候補の回の後に実行する。
// specs/<ticket>/ds-candidates/<案の名前>/ の about.md と、代表の画面（*.html）を、案ごとに 2 つの幅の iframe で並べ、
// specs/<ticket>/results/ds-compare.html に書く。撮らないので Playwright は要らない（001 の壁打ちの時点では、まだ入っていない）。
// 推しは書かない（どの案にするかの問いは、仕様担当が前提の問いに書く）。
//
// 使い方：node .claude/aidd/bin/ds-compare.mjs <ticket-id>
// 候補が無いか、作れなければ終了コード 2。
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// 並べる幅（名前、幅、高さ）。001 の壁打ちの時点では、まだ画面の幅を決めていないので、よくある 2 つにする
const WIDTHS = [["パソコン", 1280, 800], ["スマホ", 390, 844]];
const SCALE = 0.5;

try {
  const ticket = process.argv[2];
  if (!ticket || ticket.startsWith("--")) throw new Error("チケットの ID を渡してください");
  const { resolveRoot } = await import(new URL("../lib/root.mjs", import.meta.url).href);
  const root = resolveRoot();
  const { esc: e, page } = await import(pathToFileURL(path.join(root, ".claude/aidd/lib/page.mjs")).href);
  const dir = path.join(root, "specs", ticket, "ds-candidates");
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => statSync(path.join(dir, n)).isDirectory()).sort() : [];
  if (!names.length) throw new Error(`specs/${ticket}/ds-candidates/ に候補がありません`);

  const outDir = path.join(root, "specs", ticket, "results");
  const href = (name, file) => path.relative(outDir, path.join(dir, name, file)).split(path.sep).map(encodeURIComponent).join("/");
  const frame = (name, file, [label, w, h]) => `<figure><div class="frame" style="width:${w * SCALE}px;height:${h * SCALE}px"><iframe src="${e(href(name, file))}" width="${w}" height="${h}" loading="lazy" title="${e(`${name}：${file}（${label}）`)}"></iframe></div><figcaption>${e(label)}</figcaption></figure>`;
  const sections = names.map((name) => {
    const about = path.join(dir, name, "about.md");
    const screens = readdirSync(path.join(dir, name)).filter((f) => f.endsWith(".html")).sort();
    return `<section id="${e(name)}"><h2>${e(name)}</h2>${existsSync(about) ? `<pre class="about">${e(readFileSync(about, "utf8").trim())}</pre>` : ""}`
      // 大きく開くリンクは、代表の画面ごとに見出しの横に置く
      + screens.map((f) => `<h3>${e(f.replace(/\.html$/, ""))}　<a class="open" href="${e(href(name, f))}" target="_blank">大きく開く ↗</a></h3><div class="row">${WIDTHS.map((w) => frame(name, f, w)).join("")}</div>`).join("")
      + `</section>`;
  });
  const body = `<header class="top"><div class="eyebrow">デザインシステムの候補</div><h1>候補の比較</h1>`
    + `<p class="lede">壁打ちの話を 3 通りに解釈した候補です。どれか 1 つを選ぶか、直したいことを伝えてください。</p></header>`
    + `<nav class="tabs">${names.map((n) => `<a href="#${e(n)}">${e(n)}</a>`).join("")}</nav>${sections.join("")}`;
  const css = `.row { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; } figure { margin: 0; }
.frame { overflow: hidden; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
.frame iframe { border: 0; transform: scale(${SCALE}); transform-origin: 0 0; }
h3 .open { font-size: 14px; font-weight: 400; }
pre.about { white-space: pre-wrap; font: inherit; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px; }`;
  mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, "ds-compare.html");
  writeFileSync(out, page("デザインシステムの候補の比較", body, css));
  console.log(`比較のページを書きました：${path.relative(root, out)}`);
} catch (err) {
  console.error(`比較のページを作れませんでした（${err.message}）。`);
  process.exit(2);
}
