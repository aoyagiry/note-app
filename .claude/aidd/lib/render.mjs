// 人に見せる Markdown の部品。approval-draft.mjs と gate2-report.mjs が使う。
// 人には ID と作りの細部の言葉を見せず、要件の文と具体例を業務の言葉のまま出す（目的の文書の「具体例の選び方」）。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { reader, parseYaml } from "./id-graph.mjs";

/** 具体例を 1 行にする：前提 ／ すること → 結果。 */
export const exampleLine = (e) => [e?.given, e?.when].filter(Boolean).join(" ／ ") + (e?.given || e?.when ? " → " : "") + (e?.then ?? "");

/** チケットの名前と目的。000 は _intent の目的、001 はコアが固定する目的、機能は ticket-plan.yaml の行。 */
export function ticketPurpose(ticket, index) {
  if (ticket.startsWith("000-")) {
    const goals = [...index.items.values()].filter((e) => e.key.startsWith("_intent/GOAL-")).map((e) => e.item.statement);
    return { title: "全体設計", purpose: goals.join("。") || "（システムの目的はまだありません）" };
  }
  if (ticket.startsWith("001-")) return { title: "基盤づくり", purpose: "機能を作り、確認し、育てていける技術の土台を作る" };
  const row = index.items.get(`TICKET/${ticket}`)?.item;
  return { title: row?.title ?? ticket, purpose: row?.purpose ?? "（ticket-plan.yaml にこのチケットの行がありません）" };
}

/** 領域の見出し。領域の目的があれば添える。 */
export function areaHeading(index, area) {
  const names = { _intent: "システム全体の目的と前提", _shared: "共通の要件と非機能要件", _tech: "技術の土台" };
  const purpose = index.items.get(`${area}/purpose`)?.item?.statement;
  return names[area] ?? (purpose ? `${purpose}` : area);
}

export function readYaml(root, rel) {
  const f = path.join(root, rel);
  return existsSync(f) ? parseYaml(readFileSync(f, "utf8"), rel) : null;
}
export function readJson(root, rel) {
  const f = path.join(root, rel);
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
}

export const DESIGN_FILE = "specs/_current/_tech/design.yaml";
// デザインシステムの正本（tokens.css と base.css）の置き場所。値は design.yaml と同じものなので、見た目のファイルとして扱う（技術文書の変更と影響の一覧に入れない）
export const DS_DIR = "specs/_current/_tech/ds/";
const BASE_CSS = /^specs\/_current\/_tech\/ds\/[^/]+\/base\.css$/;
/** デザインシステムの土台の CSS（_tech/ds/<フォルダ>/base.css）か。 */
export const isBaseCss = (rel) => BASE_CSS.test(rel);
/** 土台の CSS の変わった行に付ける見出し。 */
export const BASE_CSS_LABEL = "土台の CSS（日本語の折り返し、押したときの応答と動き、入力の部品の形）の変わった行";
/** 問い（questions.yaml の 1 件）に答えがあるか。 */
export const answered = (q) => !!q && !(q.answer === undefined || q.answer === null || q.answer === "");

/** 2 つの行の文字の重なり。最長の共通の部分列の長さを、2 つの長さの平均で割った割合（0〜1）。 */
function overlap(a, b) {
  if (!a.length || !b.length) return 0;
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const row = [0];
    for (let j = 1; j <= b.length; j++) row[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], row[j - 1]);
    prev = row;
  }
  return (2 * prev[b.length]) / (a.length + b.length);
}
// 消した行と足した行を組にする、文字の重なりの下限（これより小さければ、別の行として「削除」と「追加」にする）
const PAIR_MIN = 0.5;

/**
 * git diff --unified=0 の出力を、人に見せる行の並びにする。かたまりごとに、消した行と足した行を組にして
 * 「前」「後」を続けて並べ、組にならずに残った行は「削除」「追加」にする。差分の見出しの行と空の行は除く。[{ side, text }]
 * 消した行と足した行の数が同じかたまりは、前から順に組にする。数が違うかたまりは、消した行ごとに、まだ組になっていない足した行のうち
 * 文字の重なりがいちばん大きいものと組にし、重なりが小さければ組にしない（順に組にすると、
 * 1 行を足して隣の行を直したかたまりで、直した行の前と、足した行が組になるため）
 */
export function pairDiff(text) {
  const out = [];
  let minus = [], plus = [];
  const flush = () => {
    if (minus.length === plus.length) {
      for (let i = 0; i < minus.length; i++) out.push({ side: "前", text: minus[i] }, { side: "後", text: plus[i] });
    } else {
      const used = new Set();
      for (const m of minus) {
        let best = -1, score = 0;
        plus.forEach((p, j) => { const s = used.has(j) ? 0 : overlap(m, p); if (s > score) { score = s; best = j; } });
        if (best >= 0 && score >= PAIR_MIN) {
          used.add(best);
          out.push({ side: "前", text: m }, { side: "後", text: plus[best] });
        } else out.push({ side: "削除", text: m });
      }
      out.push(...plus.filter((_, j) => !used.has(j)).map((t) => ({ side: "追加", text: t })));
    }
    minus = [];
    plus = [];
  };
  for (const l of String(text ?? "").split("\n")) {
    if (l.startsWith("@@")) { flush(); continue; }
    if (/^(\+\+\+|---) (a\/|b\/|\/dev\/null)/.test(l) || !/^[+-]/.test(l) || !l.slice(1).trim()) continue;
    (l.startsWith("-") ? minus : plus).push(l.slice(1).trim());
  }
  flush();
  return out;
}

/** from のコミットから今（作業ツリー）までの、ファイルの変わった行（pairDiff の形）。 */
export function fileDiff(root, from, rel) {
  try {
    return pairDiff(execFileSync("git", ["-C", root, "diff", "--unified=0", from, "--", rel], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return [];
  }
}

/**
 * デザインシステムの値（_tech/design.yaml）の、from のコミットから今までの差分。skip に入れたファイル（design.yaml と
 * base.css。承認の後に取り込んだ main だけが変えたもの）は比較しない。
 * before は from の時点の design.yaml（無ければ null）、diff は値ごとの { name, before, after }（名前、URL、雰囲気は除く）。
 * base は土台の CSS（_tech/ds/<フォルダ>/base.css）の変わった行（pairDiff の形）。from の時点に design.yaml が
 * 無ければ（001 でデザインシステムを作った）、diff と base は空にする。
 */
export function designDiff(root, from, { skip = new Set() } = {}) {
  const now = readYaml(root, DESIGN_FILE);
  const t = reader(root, from).text(DESIGN_FILE);
  const before = t ? parseYaml(t, DESIGN_FILE, from) : null;
  let base = [];
  if (before) {
    try {
      const files = execFileSync("git", ["-C", root, "diff", "--name-only", "-z", from, "--", DS_DIR], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\0").filter((f) => isBaseCss(f) && !skip.has(f));
      base = files.flatMap((f) => fileDiff(root, from, f));
    } catch { /* 比較できなければ出さない */ }
  }
  const flat = (o, pre = "", acc = {}) => {
    for (const [k, v] of Object.entries(o ?? {})) {
      if (["name", "url", "mood"].includes(k) && !pre) continue;
      if (v && typeof v === "object" && !Array.isArray(v)) flat(v, `${pre}${k}.`, acc);
      else acc[`${pre}${k}`] = Array.isArray(v) ? v.join("、") : String(v);
    }
    return acc;
  };
  if (!before || skip.has(DESIGN_FILE)) return { now, before, diff: [], base };
  // 文の並び（言葉づかいの決まり、人の直しから決めたこと）は、足した行と消した行を 1 行ずつ出す
  const lists = { text_rules: "言葉づかいの決まり", decisions: "人の直しから決めたこと" };
  const listDiff = Object.entries(lists).flatMap(([k, label]) => {
    const b = before[k] ?? [], a = now?.[k] ?? [];
    const added = a.filter((x) => !b.includes(x)), removed = b.filter((x) => !a.includes(x));
    // 消した行と足した行が 1 つずつなら、変えた決まりとして 1 行（今 → 後）にする
    if (added.length === 1 && removed.length === 1) return [{ name: label, before: removed[0], after: added[0] }];
    return [...added.map((x) => ({ name: label, before: undefined, after: x })), ...removed.map((x) => ({ name: label, before: x, after: undefined }))];
  });
  const strip = (o) => Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => !(k in lists)));
  const b = flat(strip(before)), a = flat(strip(now));
  return { now, before, base, diff: [...[...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => b[k] !== a[k]).map((k) => ({ name: k, before: b[k], after: a[k] })), ...listDiff] };
}
