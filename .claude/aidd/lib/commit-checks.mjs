// コミットの検査で、サブエージェントの成果物に当てる検査。commit.mjs の --agent が使う。
// 作業ツリーの未コミットの変更を、すべてそのサブエージェントのものとして判定する。そのため、プロダクトリードは
// 自分の書き込みを起動の前にコミットし、サブエージェントの実行中は書かない。
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { CODE_SCOPES } from "./scopes.mjs";

// 検査のスクリプト（.claude/ からのパス）と引数
const SCOPE_CHECK = (agent) => ["aidd/bin/scope-check.mjs", ["--agent", agent]];
const VALIDATE_CHANGED = ["hooks/validate-artifacts.mjs", ["--changed", "--no-stdin"]];
const runCheck = (root, [script, args]) => spawnSync("node", [path.join(root, ".claude", script), ...args], {
  env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
});
/** 検査のスクリプトを流し、違反の文（通れば null）を返す。 */
const violationOf = (root, check) => {
  const r = runCheck(root, check);
  return r.status === 0 ? null : `${path.basename(check[0])}：${(r.stderr || r.stdout).trim()}`;
};
/** 変わった YAML と JSON のスキーマの違反（説明の文の配列。無ければ空）。main の取り込みのコミットが使う。 */
export const changedArtifactViolations = (root) => [violationOf(root, VALIDATE_CHANGED)].filter(Boolean);

// サブエージェントが変えてはならないハーネスの定義。変わっていれば、直させずに捨てて人に返す。
// Bash で書き込み範囲や検査のライブラリを書き換えて検査を通すのを止める。
// 人の手元の設定（.claude/settings.local.json）は数えない。git の管理外にしていないと、どの起動も捨てることになるため
const HARNESS = [".claude", "CLAUDE.md", ":(exclude).claude/settings.local.json"];

/** ハーネスの定義のうち、変わったもの（無ければ空）。 */
export function harnessChanges(root, agent) {
  // 案件の書き込み範囲（CODE_SCOPES）は、基盤づくりで仕様担当が書くので、仕様担当のときだけ外す
  const paths = agent === "specification" ? HARNESS : [...HARNESS, CODE_SCOPES];
  const out = execFileSync("git", ["-C", root, "status", "--porcelain=v1", "--untracked-files=all", "--", ...paths], { encoding: "utf8" });
  return out.split("\n").filter(Boolean).map((l) => l.slice(3));
}

/** サブエージェントの変更の違反（説明の文の配列。無ければ空）。scope-check と validate-artifacts を実行する。 */
export function agentViolations(root, agent) {
  return [violationOf(root, SCOPE_CHECK(agent)), violationOf(root, VALIDATE_CHANGED)].filter(Boolean);
}

/** 違反の後の案内。種類で振り分けず、同じサブエージェントを再開して直させる。直させずに捨てる出力（commit.mjs の【打ち切り】）とは別にする。 */
export const RESUME_HINT = [
  "【プロダクトリードへ】サブエージェントの報告が「状態：停止」なら（最初からでも、再開の後でも）、この案内に従わず、再開しないで、aidd-run の「サブエージェントの起動と完了」の 3 の停止の扱いに従ってください。",
  "そうでなければ、同じサブエージェントを再開し（SendMessage）、この違反の全文と次の指示を渡して直させてください。",
  "- 直すのに、自分の書き込み範囲の外のファイルか人の判断が要るなら、直さずに「状態：停止」で返す。範囲の中で直せるものは、誰が起こしたかを問わず直す",
  "- してはいけない直し方：.claude/ と status.yaml を変える。テストや具体例を消して違反を消す",
  "再開したサブエージェントが停止で返ったときも、同じ停止の扱いに従ってください。",
].join("\n");
