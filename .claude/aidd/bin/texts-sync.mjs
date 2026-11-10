// キャンバスの写し（mock/project/*.dc.html）で、人がキャンバスで直した文を、画面文の一覧（texts.yaml）に戻す。
// Designer が、写しを取る回（段 2 の人の番と相談の終わり、Gate 2 で伝えられたとき）と、作る回と直す回でキャンバスに人の直しがあったときに、写しを書いた後、
// コミットの前に流し、変わった texts.yaml を成果物に含める。
//
// 使い方：node .claude/aidd/bin/texts-sync.mjs <領域>
// - 人の直しは、写しの前のモック（HEAD の .dc.html）と今のモックの data-text の文を比較して見つける（texts.yaml とは比較しない。
//   直していない artboard や、ほかの領域の古いモックが、直した文を元に戻さないように）
// - 今回変わった文を、領域の texts.yaml か _tech/texts.yaml の同じ ID の行に書く（行のほかの欄とコメントは残す）
// - 同じ ID を持つほかのモック（共通の文なら、ほかの領域のモックも）の文が違えば、そろえるものとして知らせる（Designer が写しをそろえる）
// - 同じ ID の文が 2 通りに直されていれば、戻さずに知らせる
// - 一覧の文に値の入る所（{名前}）があり、直した文がその形に合わなければ、戻さずに知らせる（Designer が値の入る所を残して一覧を直し、報告に書く）。合えば何もしない
// - 一覧に無い ID は書き足さずに知らせる（どこの文かを Designer が書いて足す）
// 作れなければ終了コード 2。
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

try {
  const area = process.argv[2];
  if (!area || area.startsWith("--")) throw new Error("領域の名前を渡してください");
  const { resolveRoot } = await import(new URL("../lib/root.mjs", import.meta.url).href);
  const root = resolveRoot();
  const { extractTexts, TECH_TEXTS } = await import(pathToFileURL(path.join(root, ".claude/aidd/lib/texts.mjs")).href);
  const { default: YAML } = await import(pathToFileURL(path.join(root, ".claude/aidd/node_modules/yaml/dist/index.js")).href);

  const rel = `specs/_current/${area}/mock/project`;
  const project = path.join(root, rel);
  const mocks = existsSync(project) ? readdirSync(project).filter((f) => f.endsWith(".dc.html")).sort() : [];
  const atHead = (f) => {
    try {
      return execFileSync("git", ["-C", root, "show", `HEAD:${rel}/${f}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      return "";
    }
  };
  const changed = new Map();   // id → Map(文 → [ファイル])
  const now = new Map();       // id → [{ file, text }]
  for (const f of mocks) {
    const before = new Map(extractTexts(atHead(f)).map((x) => [x.id, x.text]));
    for (const { id, text } of extractTexts(readFileSync(path.join(project, f), "utf8"))) {
      if (!now.has(id)) now.set(id, []);
      now.get(id).push({ file: f, text });
      if (before.get(id) === text) continue;
      if (!changed.has(id)) changed.set(id, new Map());
      changed.get(id).set(text, [...(changed.get(id).get(text) ?? []), f]);
    }
  }

  const files = [`specs/_current/${area}/texts.yaml`, TECH_TEXTS].filter((f) => existsSync(path.join(root, f)));
  const docs = new Map(files.map((f) => [f, YAML.parseDocument(readFileSync(path.join(root, f), "utf8"))]));
  const where = new Map();   // id → [ファイル, 行の番号]
  for (const [f, doc] of docs) (doc.toJS()?.texts ?? []).forEach((r, i) => !where.has(r.id) && where.set(r.id, [f, i]));
  // 値の入る所（{名前}）のある文は、そこにどんな値が入っても合うとみなす
  const fits = (pattern, text) => new RegExp(`^${pattern.split(/\{[^}]+\}/).map((x) => x.replace(/[.*+?^$()|[\]\\]/g, "\\$&")).join("[\\s\\S]+")}$`).test(text);

  // 共通の文（_tech/texts.yaml）は、ほかの領域のモックにも出る。そろえるものを探すときだけ見る
  const elsewhere = (id) => {
    const base = path.join(root, "specs/_current");
    return readdirSync(base).filter((a) => a !== area && existsSync(path.join(base, a, "mock/project"))).flatMap((a) =>
      readdirSync(path.join(base, a, "mock/project")).filter((f) => f.endsWith(".dc.html")).flatMap((f) =>
        extractTexts(readFileSync(path.join(base, a, "mock/project", f), "utf8")).filter((x) => x.id === id).map((x) => ({ file: `${a}/${f}`, text: x.text }))));
  };
  const touched = new Set(), updated = [], missing = [], conflicts = [], slots = [], align = [];
  for (const [id, texts] of changed) {
    if (!where.has(id)) { missing.push(`${id}「${[...texts.keys()].join("」「")}」`); continue; }
    const [f, i] = where.get(id);
    const doc = docs.get(f);
    const was = doc.getIn(["texts", i, "text"]);
    // 値の入る所のある文は、画面例ごとに値が違ってよい。形に合わないものだけを知らせ、一覧は書き換えない
    if (/\{[^}]+\}/.test(was)) {
      for (const t of texts.keys()) if (!fits(was, t)) slots.push(`${id}：一覧「${was}」、モック「${t}」`);
      continue;
    }
    if (texts.size > 1) { conflicts.push(`${id}（${[...texts.keys()].map((t) => `「${t}」`).join("、")}）`); continue; }
    const [text] = texts.keys();
    if (was === text) continue;
    updated.push(`${id}：「${was}」→「${text}」`);
    doc.setIn(["texts", i, "text"], text);
    touched.add(f);
    const others = [...(now.get(id) ?? []), ...(f === TECH_TEXTS ? elsewhere(id) : [])].filter((x) => x.text !== text).map((x) => x.file);
    if (others.length) align.push(`${id}「${text}」：${others.join("、")}`);
  }
  for (const f of touched) writeFileSync(path.join(root, f), docs.get(f).toString({ lineWidth: 0 }));

  console.log(updated.length ? `画面文の一覧に戻した文：\n- ${updated.join("\n- ")}` : "画面文の一覧に戻す文はありません。");
  if (align.length) console.log(`同じ文を使うほかの artboard が古い文のままです（写しとキャンバスをそろえてください）：\n- ${align.join("\n- ")}`);
  if (missing.length) console.log(`画面文の一覧に無い文（どこの文かを書いて足してください）：\n- ${missing.join("\n- ")}`);
  if (slots.length) console.log(`値の入る所（{名前}）のある文が、その形に合わない形に直されています（値の入る所を残して一覧を直し、報告に書いてください）：\n- ${slots.join("\n- ")}`);
  if (conflicts.length) console.log(`同じ文が 2 通りに直されているので、戻していません（どちらにするかを決めて、写しをそろえてください）：\n- ${conflicts.join("\n- ")}`);
} catch (err) {
  console.error(`画面文の一覧と比較できませんでした（${err.message}）。`);
  process.exit(2);
}
