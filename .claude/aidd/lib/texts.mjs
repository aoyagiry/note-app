// 画面文の一覧。画面の文は、領域ごとの specs/_current/<領域>/texts.yaml と、領域をまたぐ文の
// specs/_current/_tech/texts.yaml に、行（id、screen、where、text）で持つ。texts-sync.mjs、approval-draft.mjs、gate2-report.mjs が使う。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";

export const TECH_TEXTS = "specs/_current/_tech/texts.yaml";
const git = (root, ...a) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

/** 画面文の一覧のファイルか（領域と _tech。流れの領域には置かない）。 */
export const isTextsFile = (rel) => /^specs\/_current\/[^/]+\/texts\.yaml$/.test(rel) && !rel.startsWith("specs/_current/journeys/");

const rowsOf = (text) => (text ? YAML.parse(text)?.texts ?? [] : []);

/** ref の時点（null なら作業ツリー）の、すべての画面文の一覧の行。行に file を足す。 */
export function readTexts(root, ref = null) {
  let files;
  if (ref) files = git(root, "ls-tree", "-r", "--name-only", "-z", ref, "--", "specs/_current").split("\0").filter(isTextsFile);
  else {
    const cur = path.join(root, "specs/_current");
    files = existsSync(cur) ? readdirSync(cur).map((a) => `specs/_current/${a}/texts.yaml`).filter((f) => isTextsFile(f) && existsSync(path.join(root, f))) : [];
  }
  const text = (f) => {
    if (!ref) return readFileSync(path.join(root, f), "utf8");
    try {
      return git(root, "show", `${ref}:${f}`);
    } catch {
      return null;
    }
  };
  return files.flatMap((f) => rowsOf(text(f)).map((r) => ({ ...r, file: f })));
}

/** from から to（null なら作業ツリー）までに、足した、変えた、消した文。 */
export function textsDiff(root, from, to = null) {
  const key = (r) => `${r.file}#${r.id}`;
  const before = new Map(readTexts(root, from).map((r) => [key(r), r]));
  const after = new Map(readTexts(root, to).map((r) => [key(r), r]));
  const out = [];
  for (const [k, a] of after) {
    const b = before.get(k);
    if (!b) out.push({ change: "added", ...a, before: null });
    else if (b.text !== a.text) out.push({ change: "modified", ...a, before: b.text });
  }
  for (const [k, b] of before) if (!after.has(k)) out.push({ change: "removed", ...b, before: b.text, text: null });
  return out;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };
/** 要素の中身の HTML を、画面文の一覧の文にする。改行（<br>）は改行に、強調（<strong>、<b>）は **…** にし、ほかのタグは外す。 */
export function htmlToText(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<(strong|b)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi, "**$3**")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, n) => ENTITIES[n])
    .split("\n").map((l) => l.replace(/\s+/g, " ").trim()).join("\n").trim();
}

/** モックの HTML から、data-text の付いた要素の文を取り出す。[{ id, text }] */
export function extractTexts(html) {
  const out = [];
  const open = /<([a-zA-Z][\w-]*)\b[^>]*\bdata-text="([^"]+)"[^>]*>/g;
  let m;
  while ((m = open.exec(html))) {
    const tag = m[1].toLowerCase();
    // 同じ名前のタグの入れ子を数えて、対応する閉じタグを探す
    const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
    re.lastIndex = open.lastIndex;
    let depth = 1, end = -1, t;
    while ((t = re.exec(html))) {
      depth += t[1] ? -1 : 1;
      if (depth === 0) { end = t.index; break; }
    }
    if (end < 0) continue;
    out.push({ id: m[2], text: htmlToText(html.slice(open.lastIndex, end)) });
  }
  return out;
}

/** 行の領域（specs/_current/<領域>/texts.yaml の <領域>）。 */
export const textsArea = (r) => r.file.split("/")[2];

// 表の前と後の欄。無い文と無くなる文はそう書く
const cellBefore = (r) => r.before ?? "（無し）";
const cellAfter = (r) => r.text ?? "（無くなる）";
const groups = (rows, nameOf) => [...new Set(rows.map(nameOf))].map((name) => ({ name, rows: rows.filter((r) => nameOf(r) === name) }));
// 前の文が 1 つも無い画面（新しい画面）は、前の列を出さず文だけにする
const allNew = (g) => g.rows.every((r) => r.before == null);

/** 画面ごとの表（Markdown）。nameOf は行から画面の名前を返す。 */
export function textsMd(rows, nameOf) {
  const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, "<br>");
  return groups(rows, nameOf).flatMap((g) => allNew(g)
    ? [`**${g.name}**`, "", "| どこ | 文 |", "| --- | --- |", ...g.rows.map((r) => `| ${cell(r.where)} | ${cell(cellAfter(r))} |`), ""]
    : [`**${g.name}**`, "", "| どこ | 前 | 後 |", "| --- | --- | --- |", ...g.rows.map((r) => `| ${cell(r.where)} | ${cell(cellBefore(r))} | ${cell(cellAfter(r))} |`), ""]);
}

/** 画面ごとの表（HTML）。 */
export function textsHtml(rows, nameOf, esc) {
  const cell = (s) => esc(s).replace(/\n/g, "<br>");
  return groups(rows, nameOf).map((g) => allNew(g)
    ? `<h3>${esc(g.name)}</h3><div class="table-wrap"><table><thead><tr><th>どこ</th><th>文</th></tr></thead><tbody>`
      + g.rows.map((r) => `<tr><td>${cell(r.where)}</td><td>${cell(cellAfter(r))}</td></tr>`).join("") + `</tbody></table></div>`
    : `<h3>${esc(g.name)}</h3><div class="table-wrap"><table><thead><tr><th>どこ</th><th>前</th><th>後</th></tr></thead><tbody>`
      + g.rows.map((r) => `<tr><td>${cell(r.where)}</td><td>${cell(cellBefore(r))}</td><td>${cell(cellAfter(r))}</td></tr>`).join("") + `</tbody></table></div>`).join("");
}
