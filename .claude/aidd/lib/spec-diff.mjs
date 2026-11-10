// 仕様の差分と、今あるものへの影響の一覧（目的の文書の「今あるものへの影響」「仕様の差分は git から機械で出す」）。
// 2 つの時点の現行仕様と ticket-plan.yaml を比較し、足した、変えた、消した項目と具体例、uses でたどった影響、影響の一覧（affects）を出す。
// bin/spec-diff.mjs、approval-draft.mjs、gate2-report.mjs が使う。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { buildIndex, reader, usedBy, isBase, sameItem, stripId, parseYaml } from "./id-graph.mjs";
import { exampleLine, pairDiff, DS_DIR } from "./render.mjs";

const git = (root, ...a) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

/** 比較する元の既定：origin/main とのマージの基点。 */
export function defaultFrom(root) {
  return git(root, "merge-base", "origin/main", "HEAD");
}

/**
 * from から to（null なら作業ツリー）までに変わったファイル。-z で読む（日本語のパスを git が引用符と \ で書き換えないように）。
 * --no-renames で、名前を変えたファイルは前の名前も出す（前の文書が消えたことを見落とさない）
 */
function changedPaths(root, from, to) {
  const names = to ? git(root, "diff", "--name-only", "--no-renames", "-z", from, to) : git(root, "diff", "--name-only", "--no-renames", "-z", from);
  const untracked = to ? "" : git(root, "ls-files", "-z", "--others", "--exclude-standard");
  return [...new Set([...names.split("\0"), ...untracked.split("\0")].filter(Boolean))];
}

/**
 * 名前の付け替えの対。要件と共通の要件の付け替えには、その下の具体例（AC-<古い名前>-n → AC-<新しい名前>-n）の付け替えも含める。
 * 名前は、種類の頭（REQ-、RULE-）を外したもの。
 */
function renameMap(changes, before) {
  const map = new Map();
  for (const { from, to } of changes?.renames ?? []) {
    map.set(from, to);
    const [ta, tid] = [to.slice(0, to.lastIndexOf("/")), to.slice(to.lastIndexOf("/") + 1)];
    for (const e of before.items.values()) {
      if (e.parent !== from) continue;
      const n = e.key.slice(e.key.lastIndexOf("-") + 1);
      map.set(e.key, `${ta}/AC-${tid.replace(/^[A-Z]+-/, "")}-${n}`);
    }
  }
  return map;
}

const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
/**
 * 書き足しか：前の中身がすべて後に残る。入れ子にも効く。オブジェクトは欄ごとに（欄を消していない）、
 * 配列は前の要素がすべて残るか（文字や数の要素はそのまま、オブジェクトの要素は書き足しで）、文の欄は前の文が後に含まれるかで見る。
 * values が真なら、文字の欄も値として同じかで見る（技術の土台の設定。`8px` を `18px` にするのは書き足しでない）
 */
function onlyAppended(a, b, values = false) {
  if (typeof a === "string") return typeof b === "string" && (values ? a === b : b.includes(a));
  if (Array.isArray(a)) return Array.isArray(b) && a.every((x) => (isObj(x) ? b.some((y) => isObj(y) && onlyAppended(x, y, values)) : b.some((y) => sameItem(x, y))));
  if (isObj(a)) return isObj(b) && Object.entries(a).every(([k, v]) => k in b && onlyAppended(v, b[k], values));
  return sameItem(a, b);
}

/**
 * 差分と影響の一覧。ticket はこのチケットの ID（自分の計画の行を、ほかのチケットの行と分けるため）。
 * 戻り値は JSON にできる形。
 */
export function specDiff(root, { ticket, from, to = null, mainFrom = null }) {
  const before = buildIndex(root, reader(root, from));
  const rd = to ? reader(root, to) : reader(root);
  const after = buildIndex(root, rd);
  const changesText = ticket ? rd.text(`specs/${ticket}/spec-changes.yaml`) : null;
  const specChanges = changesText ? parseYaml(changesText, `specs/${ticket}/spec-changes.yaml`, to) : {};
  const renames = renameMap(specChanges, before);
  const isSpec = (e) => !/^\d{3}\//.test(e.key);   // 計画の決め事は仕様の差分に入れない

  const changes = [];
  const seen = new Set();
  for (const b of before.items.values()) {
    if (!isSpec(b)) continue;
    const toKey = renames.get(b.key) ?? b.key;
    const a = after.items.get(toKey);
    seen.add(toKey);
    const base = { key: toKey, kind: a?.kind ?? b.kind, area: a?.area ?? b.area, parent: a?.parent ?? b.parent ?? null };
    if (!a) changes.push({ ...base, key: b.key, change: "removed", before: b.item });
    else if (!sameItem(b.item, a.item) || toKey !== b.key) {
      changes.push({ ...base, change: "modified", renamed_from: toKey !== b.key ? b.key : undefined, before: b.item, after: a.item });
    }
  }
  for (const a of after.items.values()) {
    if (isSpec(a) && !seen.has(a.key)) changes.push({ key: a.key, kind: a.kind, area: a.area, parent: a.parent ?? null, change: "added", after: a.item });
  }

  // 具体例の結果が変わったか：今ある具体例の given、when、then のどれかが変わるか、具体例が消えた（名前の付け替えだけは数えない）
  const exChanged = changes.filter((c) => c.kind === "AC" && (c.change === "removed" || (c.change === "modified" && !sameItem(stripId(c.before), stripId(c.after)))));

  // 影響の一覧の行は人に見せる（Gate 1 の承認のページの冒頭）ので、ID ではなく、要件の文、チケットの名前、ファイルの名前を名前にする。
  // 名前は切らない。同じ要件にかかわる行（具体例、頼っている領域、仕様担当の impacts）は、要件ごとに 1 行にまとめる。
  // どの行にも、何が変わるかの 1 文（前と後）を before_after に添える（仕様担当の impacts だけの行は、note がその文になる）
  const fullName = (k) => {
    const it = (before.items.get(k) ?? after.items.get(k))?.item;
    return String(it?.statement ?? it?.name ?? it?.title ?? it?.summary ?? it?.then ?? k);
  };
  const affects = [];
  // 行が指す項目のキー（要件の行は要件、共通の項目の行はその項目）。承認のページが、仕様の全体のページのその項目へリンクするのに使う。
  // ファイル（spec-diff.json と status.yaml の affects）には書かない（JSON にも YAML にも出ない形で持つ）
  const keyed = (row, key) => (key ? Object.defineProperty(row, "key", { value: key, enumerable: false }) : row);
  const add = (kind, name, reason, beforeAfter, key = null) => affects.push(keyed({ kind, name, reason, ...(beforeAfter ? { before_after: beforeAfter } : {}), source: "spec-diff" }, key));
  // 前と後の文。消すものは「後は無くなる」
  const pair = (b, a) => (a === null ? `前「${b}」、後は無くなる` : `前「${b}」、後「${a}」`);
  // 並びが 4 つ以上なら、2 つと残りの数にする
  const fold = (xs) => [...xs.slice(0, xs.length > 3 ? 2 : 3), ...(xs.length > 3 ? [`ほか ${xs.length - 2} 件`] : [])];
  // 長い文の前と後は、変わった文（「。」で区切った 1 つ）だけを出す（長い文の一部だけを変えたときに、どこが変わったかが分かるように）
  const textChange = (b, a) => {
    const split = (t) => String(t).split(/(?<=。)/).map((x) => x.trim()).filter(Boolean);
    const xs = split(b), ys = split(a);
    if (xs.length < 2 && ys.length < 2) return pair(b, a);
    const gone = xs.filter((x) => !ys.includes(x)), added = ys.filter((y) => !xs.includes(y));
    if (!gone.length && !added.length) return pair(b, a);
    const n = Math.min(gone.length, added.length);
    return fold([...gone.slice(0, n).map((x, i) => pair(x, added[i])), ...gone.slice(n).map((x) => `「${x}」を消す`), ...added.slice(n).map((y) => `「${y}」を足す`)]).join("、");
  };
  // 要件ごとの行：{ kind（最初に足した種類）, key, parts: { examples, dependents, notes } }
  const byReq = new Map();
  const reqRow = (key, kind) => {
    if (!byReq.has(key)) {
      const row = keyed({ kind, name: key ? fullName(key) : "基盤の受入条件", reason: "", source: "spec-diff" }, key);
      affects.push(row);
      byReq.set(key, { row, examples: [], dependents: [], notes: [] });
    }
    return byReq.get(key);
  };
  const reqOf = (k) => (before.items.get(k) ?? after.items.get(k))?.parent ?? k;
  // 具体例は、親の要件の行に、場面の文（when）を並べる。親の無い基盤の受入条件は、それと分かる名前で
  // 前提とすることが同じなら、結果だけの前と後にする
  const oneLine = (t) => String(t ?? "").replace(/\s+/g, " ").trim();
  const scene = (e) => [e?.given, e?.when].filter(Boolean).join(" ／ ");
  const exChange = (c) => (c.change !== "removed" && scene(c.before) === scene(c.after) && scene(c.after)
    ? `「${oneLine(scene(c.after))}」の結果：${pair(oneLine(c.before.then), oneLine(c.after.then))}`
    : pair(oneLine(exampleLine(c.before)), c.change === "removed" ? null : oneLine(exampleLine(c.after))));
  for (const c of exChanged) reqRow(c.parent ?? null, "examples").examples.push(exChange(c));
  const kindLabel = { GOAL: "目的", PURPOSE: "目的", FACT: "前提の事実", TERM: "用語", RULE: "共通の要件", NFR: "非機能要件", TECH: "技術の選択" };
  // 共通の項目の文（目的は実現の目安も、用語は名前と意味）
  const itemText = (c, it) => (c.kind === "GOAL" ? `${it.statement}（実現の目安：${it.success}）` : c.kind === "TERM" ? `${it.name}：${it.definition}` : String(it.statement ?? it.summary ?? c.key));
  const TECH_FIELDS = { reason: "選んだ理由", background: "なぜ決めるか", alternatives: "選ばなかった案", if_changed: "後から変えるとき", sources: "出典" };
  for (const c of changes) {
    if (!isBase(c.area) || c.kind === "AC") continue;
    const label = kindLabel[c.kind] ?? "共通の要件";
    if (c.change === "removed") add("shared", fullName(c.key), `${label}を消す`, pair(itemText(c, c.before), null), c.key);
    if (c.change !== "modified" || onlyAppended(c.before, c.after)) continue;
    // 技術の選択で、何を決めたか（summary）が同じなら、選んだものの書き方を直しただけとみなす（選択は変わらないのに「変える」と出さないため）
    if (c.kind === "TECH" && c.before.summary === c.after.summary) {
      const fields = Object.entries(TECH_FIELDS).filter(([k]) => !sameItem(c.before[k], c.after[k])).map(([, v]) => v);
      add("shared", fullName(c.key), "技術の選択の書き方を直す", c.before.decision !== c.after.decision ? `中身：${textChange(c.before.decision, c.after.decision)}` : `${fields.join("、") || "ほかの欄"}の書き方を直す`, c.key);
      continue;
    }
    const b = itemText(c, c.before), a = itemText(c, c.after);
    add("shared", fullName(c.key), `${label}を変える`, b !== a ? textChange(b, a) : "文は同じで、ほかの欄を変える", c.key);
  }
  // 結果が変わるか消える具体例を持つ要件に、ほかの領域が uses で頼っている
  const impacts = [];
  for (const parent of new Set(exChanged.map((c) => c.parent).filter(Boolean))) {
    const area = parent.slice(0, parent.lastIndexOf("/"));
    const dependents = [...new Set([...usedBy(before, parent), ...usedBy(after, parent)])].filter((k) => !k.startsWith(`${area}/`));
    if (dependents.length) {
      impacts.push({ changed: parent, dependents });
      reqRow(parent, "dependents").dependents.push(`ほかの領域の${dependents.map((k) => `「${fullName(k)}」`).join("、")}が頼っている`);
    }
  }
  for (const c of changes) {
    if (!isBase(c.area) || c.kind === "AC" || c.change === "added") continue;
    const dependents = [...new Set([...usedBy(before, c.key), ...usedBy(after, c.key)])];
    if (dependents.length) impacts.push({ changed: c.key, dependents });
  }
  const otherRows = changes.filter((c) => c.kind === "TICKET" && c.key !== `TICKET/${ticket}` && c.change !== "added");
  // チケットの行の前と後：名前か目的が変われば前と後、範囲だけなら足した行と外した行、依存だけなら先に要るチケット
  const rowText = (x) => `${x.title}：${x.purpose}`;
  const rowChange = (b, a) => {
    if (!a) return pair(rowText(b), null);
    if (rowText(b) !== rowText(a)) return pair(rowText(b), rowText(a));
    const scope = (k, label) => {
      const x = b.scope?.[k] ?? [], y = a.scope?.[k] ?? [];
      return [...y.filter((t) => !x.includes(t)).map((t) => `${label}に「${t}」を足す`), ...x.filter((t) => !y.includes(t)).map((t) => `${label}から「${t}」を外す`)];
    };
    const notes = [...scope("includes", "できること"), ...scope("excludes", "作らないもの")];
    if (notes.length) return fold(notes).join("、");
    const deps = (x) => (x.depends_on ?? []).join("、") || "無し";
    return deps(b) !== deps(a) ? `先に要るチケット：${pair(deps(b), deps(a))}` : "書き方を直す";
  };
  for (const c of otherRows) add("tickets", fullName(c.key), "ほかのチケットの計画の行を変えるか消す", rowChange(c.before, c.change === "removed" ? null : c.after));

  // ファイル：CI と開発環境の定義（setup.files から dependencies を除いたもの）、依存の定義
  const tc = parseYaml(rd.text("specs/_current/_tech/toolchain.yaml") ?? "{}", "specs/_current/_tech/toolchain.yaml", to);
  const deps = tc.dependencies ?? [];
  const envDefs = (tc.setup?.files ?? []).filter((f) => !deps.includes(f));
  const paths = changedPaths(root, from, to);
  const ci = paths.filter((p) => p.startsWith(".github/workflows/"));
  const env = paths.filter((p) => envDefs.includes(p));
  // 技術の土台のうち、項目の索引に入らない文書と設定（architecture.md、toolchain.yaml、書き込み範囲など）
  const indexed = ["specs/_current/_tech/tech.yaml", "specs/_current/_tech/acceptance.yaml"];
  const techDocs = paths.filter((p) => p.startsWith("specs/_current/_tech/") && !indexed.includes(p) && !p.startsWith("specs/_current/_tech/checks/"));
  const fromReader = reader(root, from);
  // 前からある文書を、足すだけでなく変えたもの（Markdown は前の行が順にすべて後に残れば、YAML と JSON は前の値がすべて後に残れば足すだけ）
  const appendedOnly = (p) => {
    const before = fromReader.text(p), after = rd.text(p);
    if (after === null) return false;
    if (/\.md$/.test(p)) {
      const lines = (t) => t.split("\n").filter((l, i, all) => l !== "" || i < all.length - 1);
      const rest = lines(after);
      let i = 0;
      return lines(before).every((l) => { while (i < rest.length && rest[i] !== l) i++; return i++ < rest.length; });
    }
    if (/\.(ya?ml|json)$/.test(p)) return onlyAppended(parseYaml(before, p, from), parseYaml(after, p, to), true);
    return false;
  };
  // 見た目のファイル（デザインシステムの値と正本の tokens.css、base.css、画面文の一覧）は影響の一覧に入れない
  // （Gate 1 の承認のページの「確認してほしいこと」と「画面の文」で見せる）
  const visual = (p) => ["specs/_current/_tech/design.yaml", "specs/_current/_tech/texts.yaml"].includes(p) || p.startsWith(DS_DIR);
  const techChanged = techDocs.filter((p) => !visual(p) && fromReader.text(p) !== null && !appendedOnly(p));
  const file = (f) => f.split("/").pop();
  // ファイルの前と後：最初に変わった行と、残りの数
  const fileChange = (p) => {
    if (rd.text(p) === null) return "このファイルを消す";
    if (fromReader.text(p) === null) return "新しく作る";
    let lines = [];
    try {
      lines = pairDiff(to ? git(root, "diff", "--unified=0", from, to, "--", p) : git(root, "diff", "--unified=0", from, "--", p));
    } catch { /* 比較できなければ数だけにしない */ }
    if (!lines.length) return null;
    const first = lines[0].side === "前" ? pair(lines[0].text, lines[1].text) : lines[0].side === "削除" ? `「${lines[0].text}」を消す` : `「${lines[0].text}」を足す`;
    const rest = lines.filter((l) => l.side !== "後").length - 1;
    return `${first}${rest > 0 ? `（ほか ${rest} か所）` : ""}`;
  };
  for (const f of techChanged) add("tech-docs", file(f), "技術の土台の文書を、足す以外に変える", fileChange(f));
  for (const f of ci) add("ci", file(f), "CI の定義を変える", fileChange(f));
  for (const f of env) add("env", file(f), "開発環境の定義を変える", fileChange(f));
  // ID でつながらない影響（spec-changes.yaml の impacts。仕様担当が書く）
  for (const i of specChanges.impacts ?? []) {
    if (i.item) reqRow(reqOf(i.item), "notes").notes.push(i.note);
    else add("notes", "ほかへの影響", i.note);
  }
  // 要件ごとの行の理由：仕様担当の impacts の文があればそれを、無ければ決まった文を使う。前と後は、変わる具体例ごとの前と後（4 件以上は畳む）
  for (const g of byReq.values()) {
    g.row.reason = [...g.notes, ...(g.examples.length && !g.notes.length ? ["今ある具体例の結果が変わるか、具体例が消える"] : []), ...g.dependents].join("。");
    if (g.examples.length) g.row.before_after = fold(g.examples).join("。");
  }


  // 変えた領域の、領域だけの非機能要件（uses で指さず、その領域を変えるチケットにはすべて当たる）
  const touched = new Set(changes.filter((c) => c.area && !isBase(c.area)).map((c) => c.area));
  const areaNfr = [...after.items.values()].filter((e) => e.kind === "NFR" && touched.has(e.area)).map((e) => e.key);

  // _intent の使う人と範囲（ID を持たないので、項目の差分に入らない）
  const intentOf = (r) => {
    const t = r.text("specs/_current/_intent/intent.yaml");
    const y = t ? parseYaml(t, "specs/_current/_intent/intent.yaml", r.ref) : {};
    return { users: y.users ?? [], scope: y.scope ?? {} };
  };
  const intentBefore = intentOf(reader(root, from));
  const intentAfter = intentOf(rd);
  const intentChanged = !sameItem(intentBefore, intentAfter) ? { before: intentBefore, after: intentAfter } : null;

  let mainOverlap = null;
  if (mainFrom) {
    const main = specDiff(root, { ticket: null, from: mainFrom, to: "origin/main" });
    const mine = new Set(changes.map((c) => c.key));
    mainOverlap = main.changes.map((c) => c.key).filter((k) => mine.has(k));
  }

  return {
    from, to: to ?? "worktree",
    changes,
    examples_changed: exChanged.map((c) => c.key),
    impacts,
    intent: intentChanged,
    files: { ci, env, dependencies: paths.filter((p) => deps.includes(p)), tech_docs: techDocs },
    area_nfr: areaNfr,
    main_overlap: mainOverlap,
    affects,
  };
}


/**
 * status.yaml の affects を、spec-diff の行だけ入れ替える（プロダクトリードが足した source: lead の行は残す）。
 * ほかの行の書式とコメントの桁を変えないよう、affects の塊だけを文として差し替える（無ければ log の前に足す）。
 * 差し替えた結果をパースし直して確認し、合わなければ YAML の文書として書き直す（その場合は書式が変わりうる）。
 */
export function mergeAffects(text, rows) {
  const before = YAML.parse(text) ?? {};
  const all = [...rows, ...(before.affects ?? []).filter((r) => r.source !== "spec-diff")];
  const line = (r) => {
    const d = new YAML.Document(r);
    d.contents.flow = true;
    return `  - ${d.toString({ lineWidth: 0 }).trim()}`;
  };
  const block = all.length ? ["affects:", ...all.map(line)] : ["affects: []"];
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^affects:/.test(l));
  let out;
  if (start >= 0) {
    let end = start + 1;
    while (end < lines.length && /^(\s|-|$)/.test(lines[end]) && lines[end] !== "") end++;
    // 行末のコメントは残す（affects: [] # … の形）
    const comment = lines[start].match(/\s+#.*$/)?.[0] ?? "";
    out = [...lines.slice(0, start), block[0] + comment, ...block.slice(1), ...lines.slice(end)].join("\n");
  } else {
    const at = lines.findIndex((l) => /^log:/.test(l));
    const pos = at >= 0 ? at : lines.length;
    out = [...lines.slice(0, pos), ...block, ...lines.slice(pos)].join("\n");
  }
  try {
    const after = YAML.parse(out) ?? {};
    // 欄の並びは比較しない（affects の欄が無かったときは、log の前に足すので並びが変わる）
    const rest = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).filter(([k]) => k !== "affects").sort(([a], [b]) => a.localeCompare(b))));
    if (rest(after) === rest(before) && JSON.stringify(after.affects) === JSON.stringify(all)) return out;
  } catch { /* 下で書き直す */ }
  const doc = YAML.parseDocument(text);
  doc.set("affects", all);
  return doc.toString({ lineWidth: 0 });
}

/** status.yaml を読む（無ければ null）。 */
export function readStatus(root, ticket) {
  const f = path.join(root, "specs", ticket, "status.yaml");
  return existsSync(f) ? parseYaml(readFileSync(f, "utf8"), `specs/${ticket}/status.yaml`) : null;
}

/**
 * 承認の後に取り込んだ main の、ほかのチケットの変更。承認のときの main とのマージの基点（was）から
 * 今の基点（from）までに main が変えたもののうち、このチケットが from から変えていないもの。keys は仕様の項目の鍵、files はファイル。
 * 承認の後に main を取り込んでいなければ（was と from が同じ）、どちらも空。承認のコミットからの差分は、これを除いて「承認の後に変わったもの」にする
 * （取り込んだ main の、ほかのチケットの具体例が、承認の後の変更に混ざらないように）。
 */
export function mainSinceApproval(root, ticket, approved, from = defaultFrom(root)) {
  const none = { was: null, keys: new Set(), files: new Set() };
  if (!approved) return none;
  const was = git(root, "merge-base", approved, from);
  if (was === from) return none;
  const oursKeys = new Set(specDiff(root, { ticket, from }).changes.map((c) => c.key));
  const oursFiles = new Set(changedPaths(root, from, null));
  return {
    was,
    keys: new Set(specDiff(root, { ticket: null, from: was, to: from }).changes.map((c) => c.key).filter((k) => !oursKeys.has(k))),
    files: new Set(changedPaths(root, was, from).filter((f) => !oursFiles.has(f))),
  };
}

/** 承認の後に変わった仕様の項目：承認のコミットから作業ツリーまでの changes から、承認の後に取り込んだ main のほかのチケットの変更を除いたもの。 */
export function afterApproval(root, ticket, approved, from = defaultFrom(root)) {
  const main = mainSinceApproval(root, ticket, approved, from);
  return { main, changes: approved ? specDiff(root, { ticket, from: approved }).changes.filter((c) => !main.keys.has(c.key)) : [] };
}
