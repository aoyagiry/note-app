// 書き込み範囲の判定。scope-check が使う（目的の文書の「書き込み範囲」）。
// 例外はそのまま投げる。呼び出し側が、判定できないものとして終了コード 2 で拒否する。
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

// AIDD のサブエージェント。これ以外のサブエージェントの書き込みは拒否する
export const AIDD_AGENTS = ["specification", "planner", "test-writer", "implementer", "reviewer", "debugger", "designer"];

/** プラグインの名前空間（<plugin>:）を外したエージェント名。 */
export const agentName = (agentType) => String(agentType ?? "").split(":").pop();

// 案件の置き場所（テストと実装のファイル）。基盤づくりで仕様担当が書く
export const CODE_SCOPES = "specs/_current/_tech/write-scopes.json";

// 検証の出力（verify.mjs が書く）
const VERIFY_OUTPUT = ["specs/{ticket}/results/verify.json", "specs/{ticket}/results/examples.json", "specs/{ticket}/results/visual/**", "specs/_current/*/screenshots/**"];
// コアが決める成果物の置き場所。{ticket} は今のチケット。ほかのチケットのフォルダはどの役も書けない
const CORE = {
  specification: ["specs/_current/**", "specs/ticket-plan.yaml", "specs/{ticket}/hearing/questions.yaml", "specs/{ticket}/spec-changes.yaml"],
  planner: ["specs/{ticket}/plan/**"],
  // 検証の出力（verify.mjs が書く results/ のファイルと、差し替えた見た目の基準）は、作る役が最後に流してコミットする。
  // テストを書く役も、検証中にテストを直したら最後に流してコミットする。実装中を飛ばしたときも流す
  "test-writer": ["specs/{ticket}/results/red-result.md", "specs/{ticket}/results/red-run.json", "specs/_current/_tech/checks/**", ...VERIFY_OUTPUT],
  // 画面文の一覧（texts.yaml）は、作る役も行を足せる（具体例の無い通信の失敗の文など。Gate 2 の受け入れのページに「承認の後に変わった画面の文」として出る）
  implementer: ["specs/{ticket}/plan/details.yaml", ".gitignore", "specs/_current/*/texts.yaml", ...VERIFY_OUTPUT],
  reviewer: ["specs/{ticket}/reviews/**"],
  debugger: ["specs/{ticket}/results/debug-report.md"],
  // 画面のモックの写し（mock/canvas.yaml と mock/project/）、デザインシステムの値、このチケットの画面の一覧
  designer: ["specs/_current/*/mock/**", "specs/_current/_tech/design.yaml", "specs/_current/_tech/ds/**", "specs/_current/*/texts.yaml", "specs/{ticket}/screen-changes.yaml", "specs/{ticket}/ds-candidates/**"],
};
const EVERYONE = ["specs/_notes/**"];

// glob の判定。path.matchesGlob の * と ** は、点で始まる名前（.gitkeep、.github/ など）に一致せず、
// オプションでも変えられない。tests/** は「その下のすべて」を表すので、点で始まる名前にも一致させる。
// パスとパターンの両方で、区切りの直後の点を同じ印に置き換えてから判定する（パターンに .github/** と書いたものも一致する）
const DOT = "⁣";
const hideDots = (s) => s.replace(/(^|\/)\./g, `$1${DOT}`);
/** rel（/ 区切りの相対パス）が glob に一致するか。点で始まる名前にも一致する。 */
export const matchGlob = (rel, glob) => path.matchesGlob(hideDots(rel), hideDots(glob));

/**
 * 今のチケットの書き込み範囲を読む。コアの置き場所と、案件の _tech/write-scopes.json（あれば）を足し合わせる。
 * 案件のファイルが無いうち（基盤づくりの前）は、どの役もコードを書けない。
 */
export function loadScopes(root, ticket) {
  const file = path.join(root, CODE_SCOPES);
  const code = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const out = {};
  for (const agent of AIDD_AGENTS) {
    out[agent] = {
      allow: [...(CORE[agent] ?? []).map((g) => g.replaceAll("{ticket}", ticket)), ...EVERYONE, ...(code[agent]?.allow ?? [])],
      deny: code[agent]?.deny ?? [],
    };
  }
  return out;
}

/** リポジトリのルートからの相対パス（/ 区切り）。リポジトリの外なら null。 */
export function relPath(root, target) {
  const rel = path.relative(root, path.resolve(root, target)).split(path.sep).join("/");
  return rel.startsWith("..") || path.isAbsolute(rel) ? null : rel;
}

/** agent が rel を書いてよいか。deny が最優先。戻り値は { ok, reason }。 */
export function canWrite(scopes, agent, rel) {
  const scope = scopes[agent];
  if (!scope) return { ok: false, reason: `${agent} は AIDD のエージェントではないため、変更できません。` };
  const match = (globs) => globs.some((g) => matchGlob(rel, g));
  if (match(scope.deny)) return { ok: false, reason: `${agent} は ${rel} を変更できません（deny に当たる）。` };
  if (match(scope.allow)) return { ok: true };
  return { ok: false, reason: `${agent} は ${rel} を変更できません（書き込み範囲外）。` };
}
