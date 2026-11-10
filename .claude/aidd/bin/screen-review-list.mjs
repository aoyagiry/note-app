// 画面のレビューが開く PNG の一覧。プロダクトリードが、画面のレビューを起動する前に流し、組ごとに reviewer に渡す。
// すべての PNG は開かせない。主の幅は、領域の mock/canvas.yaml の widths の先頭（無ければ breakpoint の最初の幅）。
// - 1 回目（--since も --after も無い）：screen-changes.yaml の画面の元、画面例、モックだけの画面をすべて主の幅で。もう一方の幅は、
//   画面の元と長い値の画面（variant: long）だけ。変えた共通部品（parts）の artboard と、それを読む代表の画面の元（主の幅）も入れる。
//   領域をまたぐ共通部品（同じ名前で領域ごとに置く。中身は同じ）の artboard は、名前ごとに最初の領域の 1 枚だけにし、代表は領域ごとに入れる
// - 2 回目から：前の回の指摘が指した artboard（--after の結果のファイルの指摘の where にある PNG の名前）と、--since のコミットから
//   HEAD までに変わった artboard（.dc.html）、画面の CSS（<SCR の ID>.css）が変わった画面のすべての artboard、変わった共通部品の artboard と代表を、主の幅で
// - 画面の元には、mock-render が最初の 1 画面の画像（<名前>--top.png。画面の下に固定した部品のある背の高い画面）を撮っていれば、
//   その画像を添える（開いたときの見え方を見る）
// - 30 枚を超えたら、画面ごとに組に分ける。組には、ほかの組の画面の元（主の幅）を consistency として添える（画面をまたぐ一貫を見るため）。
//   組の大きさは consistency を含めて 30 枚までにする（レビュー役の手数の上限 maxTurns: 60 の中で、ほかの読みものと結果を書くことも済ませるため）
// 一覧は <git の共通の場所>/aidd/tmp/<ticket-id>/screen-review-list.json に書く（コミットしない）。
// --check：reviewer の結果のファイルの opened（開いた PNG）と、一覧のその組（files と consistency）を突き合わせ、開いていない PNG があれば終了コード 1。
//
// 使い方：node .claude/aidd/bin/screen-review-list.mjs <ticket-id> [--since <コミット>] [--after <前の回の結果のファイル>[,…]]
//         node .claude/aidd/bin/screen-review-list.mjs <ticket-id> --check <結果のファイル> [--group <組の番号>]
// 判定できなければ（一覧が無い、組の番号が無い、結果のファイルを読めない）終了コード 2。
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const LIMIT = 30;
const args = process.argv.slice(2);
const opt = (n) => {
  if (!args.includes(n)) return null;
  const v = args[args.indexOf(n) + 1];
  if (!v || v.startsWith("--")) throw new Error(`${n} に値を渡してください`);
  return v;
};
try {
  const ticket = args[0];
  if (!ticket || ticket.startsWith("--")) throw new Error("チケットの ID を渡してください");
  const { resolveRoot } = await import(new URL("../lib/root.mjs", import.meta.url).href);
  const root = resolveRoot();
  const lib = (f) => import(pathToFileURL(path.join(root, ".claude/aidd/lib", f)).href);
  const { ticketScreens, ticketParts, parseBoardName, topOf } = await lib("screens.mjs");
  const { parseYaml } = await lib("id-graph.mjs");
  const git = (...a) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const common = git("rev-parse", "--git-common-dir");
  const listFile = path.join(path.isAbsolute(common) ? common : path.join(root, common), "aidd", "tmp", ticket, "screen-review-list.json");
  const png = (file) => `specs/${ticket}/results/mock/${file}`;

  const checkArg = opt("--check");
  if (checkArg) {
    if (!existsSync(listFile)) throw new Error(`一覧がありません（${listFile}）。先に一覧を作ってください`);
    const list = JSON.parse(readFileSync(listFile, "utf8"));
    const n = Number(opt("--group") ?? (list.groups.length === 1 ? 1 : NaN));
    const group = list.groups[n - 1];
    if (!group) throw new Error(`組の番号を --group に渡してください（1〜${list.groups.length}）`);
    const resultFile = path.resolve(root, checkArg);
    if (!existsSync(resultFile)) throw new Error(`結果のファイルがありません：${checkArg}`);
    const opened = new Set((parseYaml(readFileSync(resultFile, "utf8"), checkArg).opened ?? []).map((f) => path.basename(String(f))));
    const missing = [...group.files, ...group.consistency].filter((f) => !opened.has(path.basename(f)));
    if (missing.length) {
      console.log(`開いていない PNG が ${missing.length} 枚あります（組 ${n}）：`);
      for (const f of missing) console.log(`\t${f}`);
      process.exit(1);
    }
    console.log(`組 ${n} の PNG を、すべて開いています（${group.files.length + group.consistency.length} 枚）。`);
    process.exit(0);
  }

  const screens = ticketScreens(root, ticket);
  const parts = ticketParts(root, ticket);
  const since = opt("--since");
  const after = opt("--after")?.split(",").map((x) => x.trim()).filter(Boolean) ?? [];
  const first = !since && !after.length;
  // artboard（<領域>/<モックの元の名前>）ごとの、幅ごとの 1 件。代表の画面の元も入れる（2 回目からの指摘が代表を指すことがある）
  const boards = new Map();
  const nameOf = (s) => `${s.area}/${path.basename(s.mock, ".dc.html")}`;
  for (const s of [...screens, ...parts.flatMap((p) => p.rep)]) {
    const k = nameOf(s);
    if (!boards.has(k)) boards.set(k, []);
    if (!boards.get(k).some((x) => x.file === s.file)) boards.get(k).push(s);
  }
  const mainOf = (k) => boards.get(k)?.filter((s) => s.main).map((s) => s.file) ?? [];
  // 共通部品は名前ごとに、最初の領域の artboard の 1 枚と、渡した領域ごとの代表の画面の元（主の幅）。同じ名前の共通部品は、どの領域でも同じ中身なので
  const partFiles = (ps) => [parts.find((p) => p.name === ps[0].name).file, ...ps.flatMap((p) => p.rep.filter((s) => s.main).map((s) => s.file))];
  const byName = (ps) => [...new Set(ps.map((p) => p.name))].map((name) => ps.filter((p) => p.name === name));
  // 組に分ける単位：画面（<領域>/<SCR の ID>）と、共通部品（先頭）。同じ PNG は 1 回だけ（代表の画面の元が、このチケットの画面でもあるとき）
  const units = new Map();
  const seen = new Set();
  // 画面の元の後ろに、mock-render が撮った最初の 1 画面の画像を添える（撮るのは画面の元だけなので、ファイルがあるかで決める）
  const withTop = (files) => files.flatMap((f) => (existsSync(path.join(root, png(topOf(f)))) ? [f, topOf(f)] : [f]));
  const add = (unit, files) => {
    const fresh = withTop(files).filter((f) => !seen.has(f));
    fresh.forEach((f) => seen.add(f));
    if (fresh.length) units.set(unit, [...(units.get(unit) ?? []), ...fresh]);
  };

  if (first) {
    for (const ps of byName(parts)) add("共通部品", partFiles(ps));
    for (const s of screens) if (s.main || (!s.ac && (!s.variant || s.variant === "long"))) add(`${s.area}/${s.id}`, [s.file]);
  } else {
    const picked = new Set();
    const pickedParts = new Set();
    // 前の回の指摘の where から、PNG かモックの元の名前を拾う（<領域>-- と、最初の 1 画面の画像の --top と、--<幅> は外す）
    const designFile = path.join(root, "specs/_current/_tech/design.yaml");
    const bpNames = Object.keys((existsSync(designFile) ? parseYaml(readFileSync(designFile, "utf8"), "specs/_current/_tech/design.yaml").breakpoint : null) ?? {});
    const areas = new Set([...screens, ...parts].map((s) => s.area));
    for (const f of after) {
      const file = path.resolve(root, f);
      if (!existsSync(file)) throw new Error(`前の回の結果のファイルがありません：${f}`);
      for (const finding of parseYaml(readFileSync(file, "utf8"), f).findings ?? []) {
        for (const token of String(finding.where ?? "").split(/[^A-Za-z0-9-]+/).filter(Boolean)) {
          let segs = token.split("--");
          const area = segs.length > 1 && areas.has(segs[0]) ? segs.shift() : null;
          if (segs.length > 1 && segs.at(-1) === "top") segs.pop();
          if (segs.length > 1 && bpNames.includes(segs.at(-1))) segs.pop();
          const name = segs.join("--");
          for (const k of boards.keys()) if (k.endsWith(`/${name}`) && (!area || k.startsWith(`${area}/`))) picked.add(k);
          for (const p of parts) if (p.name === name && (!area || p.area === area)) pickedParts.add(p);
        }
      }
    }
    // --since のコミットから HEAD までに変わったモックの元と CSS（Designer の直しはコミットしてから流す）
    if (since) {
      for (const f of git("diff", "--name-only", since, "HEAD", "--", "specs/_current").split("\n").filter(Boolean)) {
        const m = f.match(/^specs\/_current\/([^/]+)\/mock\/project\/([^/]+)\.(dc\.html|css)$/);
        if (!m) continue;
        const [, area, name, ext] = m;
        for (const p of parts) if (p.area === area && p.name === name) pickedParts.add(p);
        // 画面の CSS が変わったら、その画面のすべての artboard。モックの元が変わったら、その artboard
        if (ext === "css") for (const k of boards.keys()) { if (k.startsWith(`${area}/`) && parseBoardName(k.slice(area.length + 1))?.id === name) picked.add(k); }
        else if (boards.has(`${area}/${name}`)) picked.add(`${area}/${name}`);
      }
    }
    for (const ps of byName(parts.filter((x) => pickedParts.has(x)))) add("共通部品", partFiles(ps));
    for (const k of [...boards.keys()].filter((x) => picked.has(x))) add(`${k.split("/")[0]}/${parseBoardName(k.split("/")[1]).id}`, mainOf(k));
  }

  // 組に分ける。画面を分けず、順に詰める。分けたときは、ほかの組の画面の元（主の幅）を添えるので、組の大きさは添える枚数も含めて LIMIT までにする
  // （添える枚数は、すべての画面の元の数から、その組の画面の元の数を引いたもの。全体が LIMIT までなら 1 つの組になり、何も添えない）
  const homeOf = (unit) => screens.find((s) => `${s.area}/${s.id}` === unit && !s.ac && !s.variant && s.main)?.file;
  const homesIn = (us) => us.filter((u) => homeOf(u)).length;
  const homes = homesIn([...units.keys()]);
  const groups = [];
  for (const [unit, files] of units) {
    const g = groups.at(-1);
    if (g && g.files.length + files.length + homes - homesIn([...g.units, unit]) <= LIMIT) { g.units.push(unit); g.files.push(...files); }
    else groups.push({ units: [unit], files: [...files] });
  }
  for (const g of groups) {
    g.consistency = groups.length > 1 ? groups.filter((x) => x !== g).flatMap((x) => x.units).map(homeOf).filter(Boolean).map(png) : [];
    g.files = g.files.map(png);
  }
  const list = { ticket, made_at: new Date().toISOString(), round: first ? "first" : "again", since, after, groups };
  mkdirSync(path.dirname(listFile), { recursive: true });
  writeFileSync(listFile, JSON.stringify(list, null, 2) + "\n");
  if (!groups.length) {
    console.log("見る PNG がありません（画面のレビューは要りません）。");
    process.exit(0);
  }
  console.log(`一覧を書いた\t${listFile}`);
  groups.forEach((g, i) => {
    console.log(`組 ${i + 1}（${g.units.join("、")}）：${g.files.length} 枚${g.consistency.length ? `、一貫を見るほかの画面の元 ${g.consistency.length} 枚` : ""}`);
    for (const f of [...g.files, ...g.consistency]) console.log(`\t${f}`);
  });
} catch (e) {
  console.error(`画面のレビューの一覧を作れませんでした（${e.message}）。`);
  process.exit(2);
}
