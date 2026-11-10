// モックの PNG（4.5）。specs/<ticket-id>/screen-changes.yaml の
// artboard（画面の元と画面例）ごとに、モックの元（mock/project/<SCR の ID>[--<AC の ID>].dc.html）を案件の Playwright とブラウザ（.browsers/）で開き、
// specs/<ticket-id>/results/mock/<領域>--<SCR の ID>[--<AC の ID>].png に書く。
// キャンバスと同じ描かれ方にするため、手元の小さなサーバー（127.0.0.1）で specs/_current/ を配り、.dc.html が読む ./support.js に、
// そのキャンバスの Design のランタイムの写し（<git の共通の場所>/aidd/runtime/<キャンバスの id>.js。designer が写す）を返す。
// ランタイムは <colgroup> を落とすなど、ファイルをそのまま開いたときと描かれ方が違う。
// 同じページで、文字の要素が枠に収まっているかを測り、results/mock-check.json に画面ごとに書く。
// screen-changes.yaml の parts に載った共通部品（このチケットで変えたもの）は、共通部品の artboard（<領域>--<共通部品の名前>.png）と、
// それを読む代表の画面の元を撮る（読む画面例は撮らない）。同じ名前の共通部品が領域で違えば止める（領域をまたぐ共通部品は、
// 同じ回にすべての領域の写しを直す）。
// プロダクトリードが、Designer の後と、写しの後に実行する。Designer も、自分での確認に --out で流す。
// 最初に、デザインシステムの tokens.css と base.css（土台の CSS）の正本（_tech/ds/）を各領域の mock/project/ds/ に写す。
// 画面の下に固定した部品（lib/pin-fixed.mjs）があり、ページが画面より高い artboard は、部品をページの下端に置いてから全体を撮り、
// 画面の元はその前に最初の 1 画面を <名前>--top.png に撮る。一覧から外れた画面の PNG は、撮った後に消す
// （--top を撮るかは画面を開くまで分からないため。どれを消すかは lib/screens.mjs の stalePngs）。
//
// 使い方：node .claude/aidd/bin/mock-render.mjs <ticket-id> [--out <空のフォルダ>] [--only <artboard の名前>,…]
//   --out：PNG と mock-check.json を、results/ ではなくそのフォルダに書く（Designer が自分で確認するとき）
//   --only：その回に描いた artboard（.dc.html を除いたファイルの名前。例 SCR-list--AC-register-1）か、画面の ID（その画面の載っている
//          artboard をすべて）か、共通部品の名前（共通部品の artboard と代表の画面の元）だけを撮る。--out と一緒にだけ使う
//          （results/ には、承認のページのためにすべての画面を撮る）
// 判定できなければ（Playwright が無い、モックの元、tokens.css、base.css、ランタイムの写しが無い）終了コード 2。
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import YAML from "yaml";

try {
  const args = process.argv.slice(2);
  const ticket = args[0];
  if (!ticket || ticket.startsWith("--")) throw new Error("チケットの ID を渡してください");
  const outArg = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
  if (args.includes("--out") && !outArg) throw new Error("--out に出力先のフォルダを渡してください");
  const onlyArg = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
  if (args.includes("--only") && (!onlyArg || onlyArg.startsWith("--"))) throw new Error("--only に撮る artboard の名前を渡してください");
  if (onlyArg && !outArg) throw new Error("--only は --out と一緒に使ってください（results/ には、すべての画面を撮る）");
  const { resolveRoot } = await import(new URL("../lib/root.mjs", import.meta.url).href);
  const root = resolveRoot();
  const { ticketScreens, ticketParts, topOf, stalePngs } = await import(pathToFileURL(path.join(root, ".claude/aidd/lib/screens.mjs")).href);
  const { findPinned, pinToBottom, unpin } = await import(pathToFileURL(path.join(root, ".claude/aidd/lib/pin-fixed.mjs")).href);
  // 撮る artboard。names は --only で指せる名前：画面の ID（その画面の載っている artboard をすべて）、画面の元か画面例のファイルの名前
  // （ほかの幅も一緒に撮る）、ほかの幅で見せる artboard の名前（その幅だけ）、共通部品の名前（共通部品の artboard と代表の画面の元）
  const boardNames = (s) => [s.id, path.basename(s.mock, ".dc.html"), path.basename(s.file, ".png").slice(s.area.length + 2)];
  const byFile = new Map(ticketScreens(root, ticket).map((s) => [s.file, { ...s, names: boardNames(s) }]));
  const parts = ticketParts(root, ticket);
  for (const p of parts) {
    byFile.set(p.file, { area: p.area, id: null, ac: null, also: [], example: null, size: null, file: p.file, mock: p.mock, names: [p.name] });
    // 代表の画面の元は、このチケットの画面と同じ PNG なら 1 回だけ撮る
    for (const r of p.rep) byFile.has(r.file) ? byFile.get(r.file).names.push(p.name) : byFile.set(r.file, { ...r, names: [p.name] });
  }
  const all = [...byFile.values()];
  // 同じ名前の共通部品は、どの領域でも同じ中身にする（領域をまたぐ共通部品を変えたら、同じ回にすべての領域の写しを直す）
  const current = path.join(root, "specs/_current");
  for (const name of new Set(parts.map((p) => p.name))) {
    for (const ext of [".dc.html", ".css"]) {
      const copies = readdirSync(current).filter((a) => !a.startsWith("_") && existsSync(path.join(current, a, "mock/project", `${name}${ext}`)));
      const texts = new Map(copies.map((a) => [a, readFileSync(path.join(current, a, "mock/project", `${name}${ext}`), "utf8")]));
      const odd = copies.filter((a) => texts.get(a) !== texts.get(copies[0]));
      if (odd.length) throw new Error(`共通部品「${name}${ext}」の中身が領域で違います（${[copies[0], ...odd].join("、")}）。すべての領域の写しを同じにして、screen-changes.yaml の parts に領域ごとに載せてください`);
    }
  }
  const only = onlyArg ? new Set(onlyArg.split(",").map((x) => x.trim().replace(/\.dc\.html$/, "")).filter(Boolean)) : null;
  if (only) {
    const names = new Set(all.flatMap((s) => s.names));
    const strays = [...only].filter((n) => !names.has(n));
    if (strays.length) throw new Error(`--only の artboard が screen-changes.yaml にありません：${strays.join("、")}`);
  }
  const screens = only ? all.filter((s) => s.names.some((n) => only.has(n))) : all;
  if (!screens.length) {
    console.log(`specs/${ticket}/screen-changes.yaml に画面がありません。何もしません。`);
    process.exit(0);
  }
  const missing = screens.filter((s) => !existsSync(path.join(root, s.mock))).map((s) => s.mock);
  if (missing.length) throw new Error(`モックの元がありません：${missing.join("、")}`);
  // 画面例が指す具体例が仕様に無い（具体例を消したか名前を変えたのに外し忘れた、書き間違い）なら止める。Gate 1 の承認のページに中身の分からない画面を出さない。
  // 具体例は、領域の具体例か共通の要件の代表の具体例から探す（lib/screens.mjs の ticketScreens）
  const unknown = screens.flatMap((s) => [...(s.ac && !s.example ? [s.acKey] : []), ...s.also.filter((x) => !x.example).map((x) => x.acKey)]);
  if (unknown.length) throw new Error(`screen-changes.yaml の画面例が、仕様に無い具体例を指しています：${unknown.join("、")}`);

  // デザインシステムの tokens.css と base.css（土台の CSS）の正本（specs/_current/_tech/ds/<folder>/。Designer が直す）を、
  // モックのある各領域の mock/project/ds/<folder>/ に写す（毎回上書き。人がモックの HTML を手元で開いても色と文字が当たるように）
  const tokensDir = path.join(root, "specs/_current/_tech/ds");
  if (existsSync(tokensDir)) {
    const folders = readdirSync(tokensDir).filter((d) => existsSync(path.join(tokensDir, d, "tokens.css")));
    for (const area of readdirSync(current)) {
      const project = path.join(current, area, "mock/project");
      if (area.startsWith("_") || !existsSync(project)) continue;
      for (const d of folders) {
        mkdirSync(path.join(project, "ds", d), { recursive: true });
        for (const f of ["tokens.css", "base.css"].filter((f) => existsSync(path.join(tokensDir, d, f)))) copyFileSync(path.join(tokensDir, d, f), path.join(project, "ds", d, f));
      }
    }
  }
  // モックが読むデザインシステムの tokens.css と base.css
  const noTokens = [...new Set(screens.flatMap((s) => [...readFileSync(path.join(root, s.mock), "utf8").matchAll(/href="(ds\/[^"]+\.css)"/g)]
    .map((m) => path.join(path.dirname(s.mock), m[1])).filter((f) => !existsSync(path.join(root, f)))))];
  if (noTokens.length) throw new Error(`モックが読むデザインシステムの値のファイルがありません：${noTokens.join("、")}`);

  // 領域ごとのランタイムの写し
  const common = execFileSync("git", ["-C", root, "rev-parse", "--git-common-dir"], { encoding: "utf8" }).trim();
  const runtimeDir = path.join(path.isAbsolute(common) ? common : path.join(root, common), "aidd", "runtime");
  const runtimes = new Map();
  for (const area of new Set(screens.map((s) => s.area))) {
    const f = path.join(root, `specs/_current/${area}/mock/canvas.yaml`);
    const url = existsSync(f) ? YAML.parse(readFileSync(f, "utf8"))?.url : null;
    if (!url) throw new Error(`specs/_current/${area}/mock/canvas.yaml にキャンバスの URL がありません`);
    const file = path.join(runtimeDir, `${url.replace(/\/+$/, "").split("/").pop()}.js`);
    if (!existsSync(file)) throw new Error(`「${area}」のキャンバスのランタイムの写しがありません（${file}）。designer にキャンバスから写させてください`);
    runtimes.set(area, file);
  }

  // 案件の Playwright（基盤づくりで e2e の道具として入れる）。ブラウザはプロジェクトの中の .browsers/
  process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(root, ".browsers");
  let chromium;
  try {
    const req = createRequire(path.join(root, "package.json"));
    const mod = await import(pathToFileURL(req.resolve("@playwright/test")).href);
    chromium = mod.chromium ?? mod.default?.chromium;
  } catch (e) {
    throw new Error(`案件の Playwright を読めません（npm ci と、準備のコマンドでブラウザを入れたかを確認してください。${e.message}）`);
  }

  const outDir = outArg ? path.resolve(outArg) : path.join(root, "specs", ticket, "results", "mock");
  const checkFile = outArg ? path.join(outDir, "mock-check.json") : path.join(root, "specs", ticket, "results", "mock-check.json");
  mkdirSync(outDir, { recursive: true });
  // この回に撮った PNG（最初の 1 画面の画像も）。撮った後に、ほかの PNG を消す
  const shot = screens.map((s) => s.file);

  // specs/_current/ を配る。<領域>/mock/project/support.js には、その領域のランタイムの写しを返す
  const base = path.join(root, "specs", "_current");
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };
  const server = createServer((q, r) => {
    const rel = decodeURIComponent(new URL(q.url, "http://x").pathname).replace(/^\/+/, "");
    const m = rel.match(/^([^/]+)\/mock\/project\/support\.js$/);
    const file = m ? runtimes.get(m[1]) : path.join(base, rel);
    if (!file || !path.resolve(file).startsWith(m ? runtimeDir : base) || !existsSync(file)) { r.writeHead(404); r.end(); return; }
    r.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
    r.end(readFileSync(file));
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const checks = {};
  // 日付の入力欄などの並びは、ページの locale ではなく、ブラウザの起動の言語で決まる
  const browser = await chromium.launch({ args: ["--lang=ja-JP"] });
  try {
    for (const s of screens) {
      // 大きさは、画面の幅（design.yaml の breakpoint と canvas.yaml の widths）。幅を決める前の案件は、
      // canvas.json の boards（鍵はファイル名。無ければ 1280×800）
      const canvasFile = path.join(root, path.dirname(s.mock), "canvas.json");
      const board = s.size ?? (existsSync(canvasFile) ? JSON.parse(readFileSync(canvasFile, "utf8")).boards?.[path.basename(s.mock)] : null);
      // 言語はキャンバスを見る人のブラウザに合わせる（日付の欄などの書き方が変わる）
      const page = await browser.newPage({ viewport: { width: board?.width ?? board?.w ?? 1280, height: board?.height ?? board?.h ?? 800 }, locale: "ja-JP" });
      await page.goto(`${origin}/${path.relative(base, path.join(root, s.mock)).split(path.sep).join("/")}`, { waitUntil: "networkidle" });
      try {
        await page.waitForFunction(() => document.getElementById("dc-root")?.childElementCount > 0, null, { timeout: 15000 });
      } catch {
        throw new Error(`${s.mock} をランタイムで描けませんでした`);
      }
      await page.evaluate(() => document.fonts.ready);
      // 画面の下に固定した部品があり、ページが画面より高いとき：画面の元は最初の 1 画面も撮り、全体の画像は部品をページの下端に置いて撮る
      const pinned = (await page.evaluate(findPinned)).length > 0 && (await page.evaluate(() => document.documentElement.scrollHeight > innerHeight));
      if (pinned && s.id && !s.ac && !s.variant) {
        await page.screenshot({ path: path.join(outDir, topOf(s.file)) });
        shot.push(topOf(s.file));
        console.log(`書いた\t${path.relative(root, path.join(outDir, topOf(s.file)))}（最初の 1 画面）`);
      }
      if (pinned) await page.evaluate(pinToBottom);
      await page.screenshot({ path: path.join(outDir, s.file), fullPage: true });
      if (pinned) await page.evaluate(unpin);
      checks[s.file] = await page.evaluate(measure);
      await page.close();
      console.log(`書いた\t${path.relative(root, path.join(outDir, s.file))}${checks[s.file].length ? `（収まっていない文字 ${checks[s.file].length} 件）` : ""}`);
    }
  } finally {
    await browser.close();
    server.close();
  }
  // 一覧から外れた画面の PNG は消す（Gate 1 の承認のページに古い画面を残さない）
  for (const f of stalePngs(readdirSync(outDir), shot)) rmSync(path.join(outDir, f));
  writeFileSync(checkFile, JSON.stringify(checks, null, 2) + "\n");
  console.log(`書いた\t${path.relative(root, checkFile)}`);
} catch (e) {
  console.error(`モックの PNG を作れませんでした（${e.message}）。`);
  process.exit(2);
}

/**
 * 文字を持つ枠ごとに、文字が収まっているかを測る（ブラウザの中で動く）。枠は、文字を直に持つ要素か、その要素がインライン（span など）か
 * 文に入れた値を包む span（[data-value]）なら、いちばん近いそのどちらでもない祖先（インラインの要素は幅を持たず、収まっているかを測れないため。
 * [data-value] は inline-block で中身の幅に縮むので、値だけの欄の切れは、その欄で測る）。
 * kind は「はみ出し」（枠の外に出て見えている）、「切れ」（枠で隠れている）、「切れ（…で省略）」（text-overflow: ellipsis）。
 * 見えないように隠した読み上げ用の文字（clip で隠したもの）は除く。
 */
function measure() {
  const out = [];
  const label = (el) => (el.innerText || el.getAttribute("aria-label") || el.tagName).trim().replace(/\s+/g, " ").slice(0, 40);
  const boxes = new Set();
  for (const el of document.querySelectorAll("#dc-root *")) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim())) continue;
    const hidden = (x) => { const cs = getComputedStyle(x); return cs.display === "none" || cs.visibility === "hidden" || cs.clip.startsWith("rect"); };
    if (hidden(el)) continue;
    let box = el;
    while ((getComputedStyle(box).display === "inline" || box.hasAttribute("data-value")) && box.parentElement) box = box.parentElement;
    if (!hidden(box)) boxes.add(box);
  }
  for (const box of boxes) {
    const cs = getComputedStyle(box);
    const r = box.getBoundingClientRect();
    if (r.width <= 2 || r.height <= 2) continue;
    const clips = /hidden|clip|auto|scroll/.test(cs.overflowX);
    if (box.scrollWidth > box.clientWidth + 1) {
      out.push({ kind: clips ? (cs.textOverflow === "ellipsis" ? "切れ（…で省略）" : "切れ") : "はみ出し", text: label(box), box: Math.round(box.clientWidth), need: box.scrollWidth });
      continue;
    }
    const range = document.createRange();
    range.selectNodeContents(box);
    const t = range.getBoundingClientRect();
    if (!clips && (t.right > r.right + 1 || t.left < r.left - 1)) out.push({ kind: "はみ出し", text: label(box), box: Math.round(r.width), need: Math.round(t.width) });
  }
  return out;
}
