// 成果物のスキーマ検証。次の 2 つの使い方がある。
//   PostToolUse（Edit|Write）：書いた 1 ファイルを検証し、違反を書いたエージェントへ返す（終了コード 2）。
//                              書いた直後に気づくための補助なので、判定できないとき（ライブラリが読めないなど）は黙って通す
//   コミットの検査（--changed --no-stdin）：変わった YAML と JSON をまとめて検証し、違反があれば終了コード 2。
//                              commit.mjs が実行する。最後に必ず通る検査なので、判定できないときも終了コード 2 にする
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const fail = (msg) => {
  console.error(msg);
  process.exit(2);
};

try {
  const changedMode = process.argv.includes("--changed");
  // commit.mjs が実行するときは --no-stdin を付ける。標準入力が閉じられないと、読み取りが返らないため
  let raw = "";
  if (!process.argv.includes("--no-stdin")) {
    try {
      raw = readFileSync(0, "utf8");
    } catch {
      raw = "";
    }
  }
  const input = raw.trim() ? JSON.parse(raw) : {};
  const { resolveRoot } = await import(new URL("../aidd/lib/root.mjs", import.meta.url).href);
  const root = resolveRoot(input);   // 入力の cwd の作業ツリー（git worktree なら worktree）。aidd/lib/root.mjs
  const lib = (f) => import(pathToFileURL(path.join(root, ".claude/aidd/lib", f)).href);
  const { validateFiles } = await lib("validate.mjs");
  const { relPath } = await lib("scopes.mjs");

  if (!changedMode) {
    const target = input.tool_input?.file_path;
    if (!target) process.exit(0);
    const rel = relPath(root, target);
    if (rel === null) process.exit(0);
    const errors = validateFiles(root, [rel]);
    if (errors.length) fail(`成果物の検証に違反しています。直してください。\n- ${errors.join("\n- ")}`);
    process.exit(0);
  }

  const { changedFiles } = await lib("workspace.mjs");
  const files = changedFiles(root).filter((f) => /\.(ya?ml|json)$/.test(f));
  const errors = validateFiles(root, files);
  if (errors.length) fail(`成果物の検証に違反しています。直してください。\n- ${errors.join("\n- ")}`);
  process.exit(0);
} catch (e) {
  if (!process.argv.includes("--changed")) process.exit(0);
  fail(`成果物を検証できませんでした（${e.message}）。`);
}
