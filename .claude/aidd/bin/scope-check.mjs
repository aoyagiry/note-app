// サブエージェントの変更が、その役の書き込み範囲に収まるかを確認する。Bash 経由の書き込みも、ここで見つける。
// コミットの検査（commit.mjs の --agent）が実行する。
//
// 使い方：node .claude/aidd/bin/scope-check.mjs --agent <エージェント名>
//   作業ツリーの未コミットの変更を、すべてそのエージェントのものとして判定する。違反があれば終了コード 2 で一覧を出す。
// 違反は、プロダクトリードが同じサブエージェントを再開して直させる。判定できない場合は、すべて拒否する（終了コード 2）。
import path from "node:path";
import { pathToFileURL } from "node:url";

const fail = (msg) => {
  console.error(msg);
  process.exit(2);
};

try {
  const cliAgent = process.argv.includes("--agent") ? process.argv[process.argv.indexOf("--agent") + 1] : null;
  if (!cliAgent) fail("--agent <エージェント名> を渡してください。");
  const { resolveRoot } = await import(new URL("../lib/root.mjs", import.meta.url).href);
  const root = resolveRoot();   // 実行したフォルダの作業ツリー（git worktree なら worktree）。lib/root.mjs
  const lib = (f) => import(pathToFileURL(path.join(root, ".claude/aidd/lib", f)).href);
  const { agentName, loadScopes, canWrite } = await lib("scopes.mjs");
  const { changedFiles, currentTicket } = await lib("workspace.mjs");

  const agent = agentName(cliAgent);
  const files = changedFiles(root);
  if (files.length === 0) process.exit(0);
  const ticket = currentTicket(root);
  if (!ticket) fail("今のブランチが aidd/<ticket-id> ではないため、チケットを特定できません。");

  const scopes = loadScopes(root, ticket);
  const violations = files.map((f) => ({ f, r: canWrite(scopes, agent, f) })).filter(({ r }) => !r.ok).map(({ f, r }) => `${f}：${r.reason}`);
  if (violations.length === 0) process.exit(0);
  fail(`範囲外の変更があります。元に戻すか、範囲内の変更だけにしてください。\n- ${violations.join("\n- ")}`);
} catch (e) {
  fail(`変更の範囲を判定できませんでした（${e.message}）。`);
}
