// 画面の一覧。mock-render、approval-draft、verify、gate2-report、screen-review-list が使う。
// 画像の名前（最初の 1 画面の画像の --top、消す PNG）もここで決める。
// specs/<チケット>/screen-changes.yaml（Designer が書く）に載っている画面と共通部品だけを扱う。無ければ画面の無いチケットである。
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseYaml } from "./id-graph.mjs";

// e2e のテストがスクリーンショットを出す場所（foundation-hearing で決める名前）
export const SHOTS_DIR = "e2e-screenshots";

// モックだけの画面の種類
const VARIANTS = ["loading", "long"];

// 最初の 1 画面の画像。画面の下に固定した部品があり、ページが画面より高い画面の元だけ、mock-render と e2e が
// 全体の画像の名前の末尾に --top を付けて撮る（lib/pin-fixed.mjs）。撮るかは画面を開くまで分からないので、画面の一覧（ticketScreens）には入れない
/** 全体の画像の名前（<領域>--<SCR の ID>[--<幅の名前>].png）から、最初の 1 画面の画像の名前を作る。 */
export const topOf = (file) => file.replace(/\.png$/, "--top.png");
/** 最初の 1 画面の画像か。 */
export const isTop = (file) => file.endsWith("--top.png");

/**
 * mock-render が撮った後に消す PNG（一覧から外れた画面の PNG を、Gate 1 の承認のページに残さない）。files はフォルダの中のファイルの名前、
 * shot はこの回に撮った PNG の名前（artboard と、撮った最初の 1 画面の画像）。前の回の最初の 1 画面の画像も、この回に撮らなければ消す。
 */
export const stalePngs = (files, shot) => {
  const keep = new Set(shot);
  return files.filter((f) => f.endsWith(".png") && !keep.has(f));
};

const yamlOf = (root, rel) => {
  const f = path.join(root, rel);
  return existsSync(f) ? parseYaml(readFileSync(f, "utf8"), rel) : null;
};

/** 領域の画面の名前、具体例、撮る幅、キャンバスの URL。 */
function areaInfo(root, area) {
  const bps = yamlOf(root, "specs/_current/_tech/design.yaml")?.breakpoint ?? null;
  const bpNames = bps ? Object.keys(bps) : [];
  const canvasYaml = yamlOf(root, `specs/_current/${area}/mock/canvas.yaml`);
  const req = yamlOf(root, `specs/_current/${area}/requirements.yaml`);
  const rules = yamlOf(root, "specs/_current/_shared/rules.yaml");
  const find = (rs, ac) => (rs ?? []).flatMap((r) => r.examples ?? []).find((e) => e.id === ac) ?? null;
  return {
    bps,
    widthsOf: (id) => (bpNames.length ? (canvasYaml?.screens ?? []).find((x) => x.id === id)?.widths ?? [bpNames[0]] : [null]),
    titleOf: (id) => (req?.screens ?? []).find((s) => s.id === id)?.title ?? id,
    // 画面例が指す具体例。領域の具体例に無ければ、共通の要件の代表の具体例（_shared/rules.yaml）を探す。
    // key は探して決めた具体例のキー（<領域>/AC-… か _shared/AC-…。どちらにも無ければ <領域>/AC-…）
    exampleOf: (ac) => {
      const own = find(req?.requirements, ac);
      const shared = own ? null : find(rules?.rules, ac);
      return { key: shared ? `_shared/${ac}` : `${area}/${ac}`, example: own ?? shared };
    },
    screenOrder: (req?.screens ?? []).map((s) => s.id),
    canvas: canvasYaml?.url ?? null,
  };
}

/** 1 つの artboard（画面の元、画面例、モックだけの画面）の、幅ごとの 1 件。 */
function boardsOf(info, area, id, { ac = null, variant = null, change = null, also = [] } = {}) {
  const widths = info.widthsOf(id);
  const mockName = ac ? `${id}--${ac}` : variant ? `${id}--${variant}` : id;
  const ex = ac ? info.exampleOf(ac) : null;
  return widths.map((width, i) => {
    const name = `${mockName}${width ? `--${width}` : ""}`;
    return {
      area, id, ac, acKey: ex?.key ?? null, variant, width, main: i === 0, size: width ? info.bps[width] ?? null : null, change, title: info.titleOf(id),
      example: ex?.example ?? null, also: also.map((a) => { const x = info.exampleOf(a); return { ac: a, acKey: x.key, example: x.example }; }),
      file: `${area}--${name}.png`,
      mock: `specs/_current/${area}/mock/project/${mockName}.dc.html`,
      shot: `${SHOTS_DIR}/${area}--${name}.png`,
      canvas: info.canvas,
    };
  });
}

/**
 * このチケットの artboard。画面の元（ac は null）と画面例（ac は具体例の ID）と、モックだけの画面（variant が loading か long。
 * 読み込み中と、長い値を散らした画面）を 1 件ずつ返す。
 * モックだけの画面は仕様の具体例を持たず、e2e では撮らない（検証、見た目の基準、Gate 2 で作ったものとモックを並べる所から外す）。
 * 1 件は { area, id, ac, acKey, variant, width, main, size, change, title, example, also, file, mock, shot, canvas }。
 * 画面の幅：_tech/design.yaml の breakpoint（{ <名前>: { width, height } }）があれば、領域の mock/canvas.yaml の
 * screens の widths（無ければ breakpoint の最初の名前）の幅ごとに 1 件にし、名前の末尾に --<幅の名前> を付ける。size はその幅の大きさ。
 * main は主の幅（widths の先頭）の 1 件か（画面のレビューがすべての画面例を見る幅）。
 * breakpoint が無ければ（幅を決める前の案件）、幅を名前に入れず、size は null、main は true。
 * also は、同じ見た目なので代表の画面例 1 枚にまとめた具体例 [{ ac, acKey, example }]（描かず、撮らない）。
 * title は画面の名前、example は画面例なら仕様の具体例（given、when、then）、acKey はその具体例のキー（領域の具体例なら <領域>/AC-…、
 * 共通の要件の代表の具体例なら _shared/AC-…。使う側はこのキーで仕様の差分と結果を引く）、
 * file は PNG の名前（<領域>--<SCR の ID>[--<AC の ID>].png）、
 * mock はモックの元（.dc.html）、shot は e2e のスクリーンショットの出力、canvas はキャンバスの URL。
 * 画面の元は、change が unchanged（画面例だけを足すか描き直した）なら返さない。
 */
export function ticketScreens(root, ticket) {
  const list = yamlOf(root, `specs/${ticket}/screen-changes.yaml`)?.screens ?? [];
  const infos = new Map();
  const infoOf = (area) => infos.get(area) ?? infos.set(area, areaInfo(root, area)).get(area);
  return list.flatMap(({ area, id, change, examples = [] }) => {
    const info = infoOf(area);
    return [
      ...(change === "unchanged" ? [] : boardsOf(info, area, id, { change })),
      ...examples.flatMap((e) => boardsOf(info, area, id, { ac: e.ac ?? null, variant: e.variant ?? null, change: e.change, also: e.also ?? [] })),
    ];
  });
}

/** e2e で撮る画面（モックだけの画面を除く）。verify と gate2-report が使う。 */
export const shotScreens = (root, ticket) => ticketScreens(root, ticket).filter((s) => !s.variant);

/** モックだけの画面の名前（人に見せる）。 */
export const VARIANT_LABEL = { loading: "読み込み中", long: "長い値を入れたとき" };

/**
 * モックの元（リポジトリのルートからの相対パス）が読むファイルの Set。自分と、<link> で読む同じフォルダの CSS（画面の CSS、共通部品の CSS）と、
 * <dc-import> で読む共通部品（とそれが読むもの）。デザインシステムの写し（ds/ の下）は含めない。
 */
export function readsOf(root, mock, seen = new Set()) {
  if (seen.has(mock) || !existsSync(path.join(root, mock))) return seen;
  seen.add(mock);
  const text = readFileSync(path.join(root, mock), "utf8");
  const dir = path.posix.dirname(mock);
  for (const m of text.matchAll(/href="(?:\.\/)?([^"/:]+\.css)"/g)) seen.add(`${dir}/${m[1]}`);
  for (const m of text.matchAll(/<dc-import\b[^>]*\bname="([^"]+)"/g)) readsOf(root, `${dir}/${m[1]}.dc.html`, seen);
  return seen;
}

/**
 * モックの元のファイルの名前（.dc.html を除く）を、画面の元、画面例、モックだけの画面に分ける。ほかの幅で見せる artboard と、
 * 画面でないもの（共通部品、proto- の試作）は null。
 */
export function parseBoardName(name) {
  const [id, second, ...rest] = name.split("--");
  if (!/^SCR-/.test(id) || rest.length) return null;
  if (second === undefined) return { id, ac: null, variant: null };
  if (/^AC-/.test(second)) return { id, ac: second, variant: null };
  return VARIANTS.includes(second) ? { id, ac: null, variant: second } : null;
}

/**
 * このチケットで変えた共通部品（screen-changes.yaml の parts）と、それを読む画面。
 * 共通部品は領域のキャンバスごとに置くので、領域ごとに 1 件。1 件は { area, name, change, mock, css, file, readers, rep }。
 * - mock、css：共通部品の .dc.html と .css（リポジトリのルートから）。file は共通部品の artboard の PNG の名前（<領域>--<共通部品の名前>.png）
 * - readers：その領域のモックの元のうち、共通部品を（ほかの共通部品を通しても）読む画面の元、画面例、モックだけの画面 [{ id, ac, variant, mock }]
 * - rep：代表の画面の元の artboard（ticketScreens の 1 件と同じ形。幅ごと）。代表は、その領域の screen-changes.yaml の screens に
 *   元が共通部品を読む画面があれば先頭のもの、無ければ requirements.yaml の screens の順で最初に読む画面（ナビゲーションの項目だけを足す
 *   領域は、screens に画面が載らないため）。読む画面が無ければ []
 */
export function ticketParts(root, ticket) {
  const sc = yamlOf(root, `specs/${ticket}/screen-changes.yaml`);
  return (sc?.parts ?? []).map(({ area, name, change }) => {
    const dir = `specs/_current/${area}/mock/project`;
    const mock = `${dir}/${name}.dc.html`;
    const files = existsSync(path.join(root, dir)) ? readdirSync(path.join(root, dir)).filter((f) => f.endsWith(".dc.html")).sort() : [];
    const readers = files.flatMap((f) => {
      const b = parseBoardName(f.replace(/\.dc\.html$/, ""));
      const m = `${dir}/${f}`;
      return b && readsOf(root, m).has(mock) ? [{ ...b, mock: m }] : [];
    });
    const readsSelf = new Set(readers.filter((r) => !r.ac && !r.variant).map((r) => r.id));
    const listed = (sc.screens ?? []).filter((s) => s.area === area).map((s) => s.id);
    const info = areaInfo(root, area);
    const order = [...listed, ...info.screenOrder, ...[...readsSelf].sort()];
    const repId = order.find((id) => readsSelf.has(id)) ?? null;
    return {
      area, name, change, mock, css: `${dir}/${name}.css`, file: `${area}--${name}.png`, readers,
      rep: repId ? boardsOf(info, area, repId, { change: "unchanged" }) : [],
    };
  });
}

/**
 * 共通部品のある領域を、人に見せる名前（その領域の代表の画面の名前）で返す。代表の画面が無ければ null
 * （領域の ID だけで説明しないため、呼ぶ側はほかの領域の並びから外す）
 */
export function partAreaName(p) {
  return (p.rep.find((s) => s.main) ?? p.rep[0])?.title ?? null;
}

/**
 * 共通部品を名前ごとにまとめる（領域をまたぐ共通部品は、同じ名前で領域ごとに置く）。[{ name, change, parts: [ticketParts の 1 件…] }]。
 * change は、どれかの領域で modified なら modified（前からある部品を、新しい領域にも置いたとき）、すべての領域で added なら added。
 */
export function groupParts(parts) {
  return [...new Set(parts.map((p) => p.name))].map((name) => {
    const ps = parts.filter((p) => p.name === name);
    return { name, change: ps.some((p) => p.change === "modified") ? "modified" : "added", parts: ps };
  });
}

/** origin の GitHub のリポジトリ（owner/repo）。分からなければ null。 */
export function githubRepo(root) {
  try {
    const url = execFileSync("git", ["-C", root, "remote", "get-url", "origin"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * PR の本文に載せる画像の Markdown。HEAD にコミットされた PNG を blob/<コミット>/<パス>?raw=true で指す
 * （非公開のリポジトリでも PR の本文に出る）。コミットされていなければ、その旨の文を返す。
 */
export function imageLine(root, rel, alt) {
  const git = (...a) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    git("cat-file", "-e", `HEAD:${rel}`);
  } catch {
    return `（${alt}の PNG がコミットされていません）`;
  }
  const repo = githubRepo(root);
  const commit = git("rev-parse", "HEAD");
  return repo ? `![${alt}](https://github.com/${repo}/blob/${commit}/${rel}?raw=true)` : `${alt}：\`${rel}\``;
}
