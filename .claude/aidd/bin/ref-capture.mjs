// お手本のページを撮る。プロダクトリードが、壁打ちのメモの「デザイン」の好きなサイトや製品（お手本）の URL を渡して流す。
// 001 のメモの URL は、001 の実装の後（案件の Playwright が入った後）の最初の機能のチケットの始めに、機能のチケットの見た目の壁打ちで
// 出た URL は、その話をメモに書いた後に撮る（どちらも Designer を作る回で起動する前）。Designer と画面のレビュー役が、構成の水準
// （最初の画面の強さ、区切り方、余白）を並べて比較するために使う。
// 撮った PNG は git の管理の外（`git rev-parse --git-common-dir` の下の aidd/references/design/）に置く。他社のページの画像を
// リポジトリに入れず、公開しないため。幅ごとに、開いたときの画面と、ページ全体を撮る。
//
// 使い方：node .claude/aidd/bin/ref-capture.mjs <URL> [<URL> ...]
// 外のサイトを開くので、Playwright 付属の Chromium ではなく、この機械の Google Chrome（channel: "chrome"）を、サンドボックスを効かせて
// （chromiumSandbox: true）起動する。付属の Chromium は版が固定で Chrome の修正より古いことがあり、launch の既定ではサンドボックスが切れているため。
// 撮れなかった URL があれば終了コード 1（ほかの URL は撮る）。Playwright か Chrome が無いか、URL が無ければ 2。
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

// 撮る幅（名前、幅、高さ）
const WIDTHS = [["desktop", 1280, 800], ["phone", 390, 844]];
// 読み込みの後に、通信が止まるのを待つ長さ（ミリ秒）。止まらなくても、この後に撮る
const IDLE_MS = 5000;

try {
  const urls = process.argv.slice(2).filter((a) => /^https?:\/\//.test(a));
  if (!urls.length) throw new Error("撮るページの URL（http:// か https:// で始まるもの）を渡してください");
  const { resolveRoot } = await import(new URL("../lib/root.mjs", import.meta.url).href);
  const root = resolveRoot();
  const common = execFileSync("git", ["-C", root, "rev-parse", "--git-common-dir"], { encoding: "utf8" }).trim();
  const outDir = path.join(path.isAbsolute(common) ? common : path.join(root, common), "aidd", "references", "design");

  // 案件の Playwright（基盤づくりで e2e の道具として入れる）。ブラウザは付属の .browsers/ でなく、この機械の Google Chrome を使う
  let chromium;
  try {
    const req = createRequire(path.join(root, "package.json"));
    const mod = await import(pathToFileURL(req.resolve("@playwright/test")).href);
    chromium = mod.chromium ?? mod.default?.chromium;
  } catch (e) {
    throw new Error(`案件の Playwright を読めません（001 の実装の後に流してください。${e.message}）`);
  }

  mkdirSync(outDir, { recursive: true });
  const slug = (u) => { const x = new URL(u); return `${x.hostname}${x.pathname}`.replace(/[^A-Za-z0-9.-]+/g, "-").replace(/-+$/, ""); };
  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome", chromiumSandbox: true, args: ["--lang=ja-JP"] });
  } catch (e) {
    throw new Error(`外のサイトはサンドボックスを効かせた Google Chrome で開くので、この機械の Chrome が要ります。Chrome を起動できませんでした（入っていないか、起動に失敗した）。Chrome を入れるか、お手本の画像を ${outDir} に置いてください（${e.message.split("\n")[0]}）`);
  }
  const failed = [];
  try {
    for (const url of urls) {
      for (const [name, width, height] of WIDTHS) {
        const page = await browser.newPage({ viewport: { width, height }, locale: "ja-JP" });
        try {
          // 読み込み（load）が終わるまで待ち、通信が止まるのは IDLE_MS だけ待つ。開いた後も通信を続けるページでは通信が止まらず、
          // networkidle を待つと 30 秒で撮れずに終わるため
          await page.goto(url, { waitUntil: "load", timeout: 30000 });
          await page.waitForLoadState("networkidle", { timeout: IDLE_MS }).catch(() => {});
          await page.evaluate(() => document.fonts?.ready);
          const base = path.join(outDir, `${slug(url)}--${name}`);
          await page.screenshot({ path: `${base}.png` });
          await page.screenshot({ path: `${base}-full.png`, fullPage: true });
          console.log(`撮った\t${name}\t${url}\t${base}.png`);
        } catch (e) {
          failed.push(url);
          console.log(`撮れなかった\t${name}\t${url}\t${e.message.split("\n")[0]}`);
        } finally {
          await page.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`置き場所：${outDir}（git の管理の外。リポジトリに入れない）`);
  process.exit(failed.length ? 1 : 0);
} catch (err) {
  console.error(`お手本を撮れませんでした（${err.message}）。`);
  process.exit(2);
}
