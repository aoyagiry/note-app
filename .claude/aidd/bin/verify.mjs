// 検証（目的の文書の「検証」）。toolchain.yaml の検証のコマンドを流し、結果を加工せずに
// specs/<ticket-id>/results/verify.json に残し、具体例ごとの結果（examples.json）も作る（verify.json を最後に書く）。
// 実装中は作る役が、検証中にテストを直したときと、テストが最初から通って実装中を飛ばしたときはテストを書く役が、手順の最後に流し、
// 出力を自分のコミットに含める。
// 作る役を起動しない場面（main の取り込みの後と、受入済の文だけの直しの道）はプロダクトリードが流す。
// verify.json の commit は流したときの HEAD で、作る役が流したときは、実装を入れる前のコミットを指す。
// 計測のコマンド（toolchain.yaml の measurement）は、ふだんの検証では流さず、前の verify.json の計測の結果を残す。--measure を付けると、
// 計測のコマンドだけを流して verify.json の計測の結果を書き換える（作る役が返す直前に 1 回だけ流す。
// 実装中を飛ばしたときは、テストを書く役が検証の後に流す）。
// verify.json の passed は、コマンドの結果と、残した計測の結果の両方で決める。
// 画面のあるシステムでは、見た目の回帰テストも行う。
// - コマンドの前に e2e-screenshots/ を空にする（前の回のスクリーンショットを基準にしない）
// - screen-changes.yaml に載っている artboard（画面の元と画面例。モックだけの画面を除く）の e2e のスクリーンショットが無ければ落とす
// - 撮ったすべてのスクリーンショットを、main とのマージの基点にある基準（specs/_current/<領域>/screenshots/）と画素で比較する。
//   作業ツリーの基準とは比較しない（何回流しても main との差が出て、Gate 2 と同じ物差しになる）。違う画素の割合が toolchain.yaml の
//   visual_threshold（既定 0.001）を超え、screen-changes.yaml に載っていない画面なら、前、後、差分の PNG を results/visual/ に書き、
//   verify.json の screenshots.unlisted_changes に書く。落とさない（コードレビューが先に見て、最後は人が Gate 2 で判断する）
//   ただし、このチケットで変えた共通部品（screen-changes.yaml の parts）を読む画面の変化は、unlisted_changes に入れず、
//   screenshots.part_changes に共通部品の名前ごとにまとめる（コードレビューは崩れが無いかだけを見る）。共通部品を読む画面は、
//   閾値を 0 にする（メニューに 1 項目足しても、ページ全体では閾値を超えないため。変わっていない画面は画素まで同じ）
//   最初の 1 画面の画像（<名前>--top.png。画面の下に固定した部品のある背の高い画面の元）は、unlisted_changes にも part_changes にも入れない
//   （変化は全体の画像だけで見る。作ったものとモックの最初の 1 画面は、作る役とコードレビューが比較する）
//   main とのマージの基点が取れなければ比較せず、verify.json の screenshots.not_compared に理由を書く（変化が無かったことと区別する）
// - 比較の後に、撮ったすべての画面（最初の 1 画面の画像も）で、作業ツリーの基準を今の見た目に差し替える
//
// 使い方：node .claude/aidd/bin/verify.mjs <ticket-id> [--measure]
// 流したもの（ふだんはコマンドとスクリーンショット、--measure では計測のコマンド）が落ちたら終了コード 1（失敗の出力は verify.json にある）。
// 判定できなければ 2。--measure は、前の verify.json が無ければ 2。
import { spawnSync, execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync, statSync, utimesSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const LIMIT = 1 << 20;   // 1 つの出力に残す上限（末尾を残す）
const tail = (s) => (s.length > LIMIT ? `…（先頭を省いた）\n${s.slice(-LIMIT)}` : s);
try {
  const ticket = process.argv[2];
  if (!ticket || ticket.startsWith("--")) throw new Error("チケットの ID を渡してください");
  const measure = process.argv.slice(3).includes("--measure");
  const { resolveRoot } = await import(new URL("../lib/root.mjs", import.meta.url).href);
  const root = resolveRoot();
  const lib = (f) => import(pathToFileURL(path.join(root, ".claude/aidd/lib", f)).href);
  const { YAML } = await lib("workspace.mjs");
  const { exampleResults } = await lib("results.mjs");
  const { shotScreens, ticketParts, groupParts, isTop, SHOTS_DIR } = await lib("screens.mjs");
  const { areaOfShot, baselinePath, baselineAt, comparePng } = await lib("visual.mjs");
  const { defaultFrom } = await lib("spec-diff.mjs");
  const tc = YAML.parse(readFileSync(path.join(root, "specs/_current/_tech/toolchain.yaml"), "utf8")) ?? {};
  const run = (j) => {
    const started_at = new Date().toISOString();
    const r = spawnSync(j.command, { cwd: root, shell: true, encoding: "utf8", maxBuffer: 256 << 20 });
    return { ...j, exit_code: r.status ?? -1, stdout: tail(r.stdout ?? ""), stderr: tail(r.stderr ?? ""), started_at, finished_at: new Date().toISOString() };
  };
  const ok = (r) => r.exit_code === 0;
  const line = (r, kept = false) => `${ok(r) ? "通った" : "落ちた"}\t${r.kind === "measurement" ? (kept ? "計測（前の結果を残した） " : "計測 ") : ""}${r.name}\t${r.command}`;
  const dir = path.join(root, "specs", ticket, "results");
  const vFile = path.join(dir, "verify.json");
  const prev = existsSync(vFile) ? JSON.parse(readFileSync(vFile, "utf8")) : null;
  const measurements = Object.entries(tc.measurement ?? {}).map(([name, command]) => ({ kind: "measurement", name, command }));

  if (measure) {
    // 計測だけを流し、前の verify.json の計測の結果を書き換える。ほかの中身（コマンドの結果、スクリーンショット）と examples.json は変えない。
    // verify.json の更新の時刻は、前の検証のときのまま戻す（コミットの検査が、検証の後にコードを直していないかを verify.json の時刻で見るため。
    // 検証の後にコードを直して --measure だけを流しても、その検査に止められる）
    if (!prev) throw new Error(`${path.relative(root, vFile)} がありません。先に verify.mjs ${ticket} で検証を流してください`);
    const measured = measurements.map(run);
    const runs = [...(prev.runs ?? []).filter((r) => r.kind !== "measurement"), ...measured];
    const passed = runs.every(ok) && (prev.screenshots?.missing ?? []).length === 0;
    const { atimeMs, mtimeMs } = statSync(vFile);
    writeFileSync(vFile, JSON.stringify({ ...prev, passed, runs }, null, 2) + "\n");
    utimesSync(vFile, atimeMs / 1000, mtimeMs / 1000);
    if (!measured.length) console.log("計測のコマンドがありません（toolchain.yaml の measurement）");
    for (const r of measured) console.log(line(r));
    process.exit(measured.every(ok) ? 0 : 1);
  }

  rmSync(path.join(root, SHOTS_DIR), { recursive: true, force: true });
  const commandRuns = Object.entries(tc.commands ?? {}).map(([name, command]) => run({ kind: "command", name, command }));
  // 計測は流さず、前の計測の結果を残す
  const kept = (prev?.runs ?? []).filter((r) => r.kind === "measurement");
  const runs = [...commandRuns, ...kept];
  mkdirSync(dir, { recursive: true });
  const commit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  // 見た目の回帰テスト。前の回の前、後、差分の PNG は先に消す
  const visualDir = path.join(dir, "visual");
  rmSync(visualDir, { recursive: true, force: true });
  const screens = shotScreens(root, ticket);
  const shotsDir = path.join(root, SHOTS_DIR);
  const shots = existsSync(shotsDir) ? readdirSync(shotsDir).filter((f) => areaOfShot(f)).sort() : [];
  const listed = new Set(screens.map((s) => s.file));
  const screenshots = { missing: screens.filter((s) => !shots.includes(s.file)).map((s) => s.shot), baseline: [], unlisted_changes: [], part_changes: [] };
  // 変えた共通部品を読む画面。スクリーンショットの名前（<領域>--<SCR の ID>[--<AC の ID>][--<幅>].png）から、モックの元（画面例のモックが
  // 無ければ画面の元）を決め、それが共通部品を読めば、その共通部品の名前に入れる（2 つ読むなら、parts の先のもの）
  const parts = ticketParts(root, ticket);
  const partOf = (f) => {
    const [area, id, second] = f.replace(/\.png$/, "").split("--");
    const own = `specs/_current/${area}/mock/project/${id}${second?.startsWith("AC-") ? `--${second}` : ""}.dc.html`;
    const mock = existsSync(path.join(root, own)) ? own : `specs/_current/${area}/mock/project/${id}.dc.html`;
    return parts.find((p) => p.area === area && p.readers.some((r) => r.mock === mock))?.name ?? null;
  };
  const partChanges = new Map();
  let base = null;
  try {
    base = defaultFrom(root);
  } catch {
    // main とのマージの基点が取れなければ比較しない（基準の差し替えだけ）。比較していないことを verify.json に残す
    screenshots.not_compared = `main とのマージの基点が取れないため、前の見た目と比較していません（origin/main を取得してから流し直すと比較します）`;
  }
  const threshold = tc.visual_threshold ?? 0.001;
  for (const f of shots) {
    const rel = baselinePath(f);
    const now = readFileSync(path.join(shotsDir, f));
    const before = base ? baselineAt(root, base, rel) : null;
    if (before && !listed.has(f) && !isTop(f)) {
      const { ratio, diff } = comparePng(before, now);
      const part = partOf(f);
      if (ratio > (part ? 0 : threshold)) {
        mkdirSync(visualDir, { recursive: true });
        const name = f.replace(/\.png$/, "");
        const out = (kind, buf) => { writeFileSync(path.join(visualDir, `${name}--${kind}.png`), buf); return `specs/${ticket}/results/visual/${name}--${kind}.png`; };
        const change = { file: f, ratio: Number(ratio.toFixed(4)), before: out("before", before), after: out("after", now), diff: diff ? out("diff", diff) : null };
        if (part) partChanges.set(part, [...(partChanges.get(part) ?? []), change]);
        else screenshots.unlisted_changes.push(change);
      }
    }
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    copyFileSync(path.join(shotsDir, f), path.join(root, rel));
    screenshots.baseline.push(rel);
  }
  screenshots.part_changes = groupParts(parts).filter((g) => partChanges.has(g.name))
    .map((g) => ({ part: g.name, areas: g.parts.map((p) => p.area), changes: partChanges.get(g.name) }));
  // 消した画面と具体例の古い基準を消す。基準の名前の画面の ID か具体例の ID が、今の領域の requirements.yaml に無ければ消し、
  // verify.json の screenshots.removed に書く（作業ツリーで消すので、コミットに消したことが入る）。画面例は共通の要件の代表の具体例も指せるので、
  // _shared/rules.yaml の具体例も、ある具体例に数える
  screenshots.removed = [];
  const current = path.join(root, "specs/_current");
  const rulesFile = path.join(current, "_shared", "rules.yaml");
  const sharedAcs = existsSync(rulesFile) ? ((YAML.parse(readFileSync(rulesFile, "utf8")) ?? {}).rules ?? []).flatMap((r) => (r.examples ?? []).map((e) => e.id)) : [];
  for (const area of existsSync(current) ? readdirSync(current).filter((a) => !a.startsWith("_")) : []) {
    const baseDir = path.join(current, area, "screenshots");
    if (!existsSync(baseDir)) continue;
    const reqFile = path.join(current, area, "requirements.yaml");
    const req = existsSync(reqFile) ? YAML.parse(readFileSync(reqFile, "utf8")) ?? {} : {};
    const scr = new Set((req.screens ?? []).map((x) => x.id));
    const acs = new Set([...(req.requirements ?? []).flatMap((r) => (r.examples ?? []).map((e) => e.id)), ...sharedAcs]);
    // 一覧が無い（画面を requirements.yaml に書く前の案件）なら、その種類の ID では消さない
    const known = (x) => (x.startsWith("SCR-") ? !scr.size || scr.has(x) : !acs.size || acs.has(x));
    for (const f of readdirSync(baseDir).filter((f) => f.endsWith(".png"))) {
      const parts = f.replace(/-[a-z0-9]+\.png$/, "").split("--").slice(1);   // <領域>--<SCR>[--<AC>][--<幅>]-<OS>.png
      const gone = parts.filter((x) => /^(SCR|AC)-/.test(x)).some((x) => !known(x));
      if (gone) {
        rmSync(path.join(baseDir, f));
        screenshots.removed.push(`specs/_current/${area}/screenshots/${f}`);
      }
    }
  }
  const ran = commandRuns.every(ok) && screenshots.missing.length === 0;
  const passed = ran && kept.every(ok);
  // verify.json を最後に書く（作る役とテストを書く役のコミットで、commit.mjs が verify.json をほかのファイルより後かで確認するため）
  writeFileSync(path.join(dir, "examples.json"), JSON.stringify(exampleResults(root, ticket), null, 2) + "\n");
  writeFileSync(vFile, JSON.stringify({ commit, passed, runs, ...(screens.length || shots.length ? { screenshots } : {}) }, null, 2) + "\n");
  for (const r of commandRuns) console.log(line(r));
  for (const r of kept) console.log(line(r, true));
  for (const f of screenshots.missing) console.log(`落ちた\t画面のスクリーンショットが無い\t${f}`);
  if (screenshots.not_compared && shots.length) console.log(`比較していない\t${screenshots.not_compared}`);
  for (const u of screenshots.unlisted_changes) console.log(`変化\t変えるつもりの無かった画面が変わった（${(u.ratio * 100).toFixed(2)}%）\t${u.file}`);
  for (const g of screenshots.part_changes) for (const u of g.changes) console.log(`変化\t共通部品「${g.part}」で画面が変わった（${(u.ratio * 100).toFixed(2)}%）\t${u.file}`);
  process.exit(ran ? 0 : 1);
} catch (e) {
  console.error(`検証を流せませんでした（${e.message}）。`);
  process.exit(2);
}
