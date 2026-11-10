// 承認のコメント（/aidd-approve）を、今のブランチの PR に投稿する。人が Claude Code の ! で実行する。
// AI の実行は guard-bash が拒否する。
//
// 使い方：
//   ! node .claude/aidd/bin/approve.mjs [<PR 番号>]     番号を省くと、今のブランチの PR に投稿する
//
// 合言葉はこのスクリプトの中で組み立て、シェルを通さずに gh を起動して渡す。Windows の Git Bash で
// 「/ で始まる引数」を渡すと、MSYS のパス変換で本文が C:/Program Files/Git/aidd-approve に変わり、承認と数えられないため。
// PR の元のブランチが aidd/ であることを確認してから投稿する。gh の起動先は環境変数 AIDD_GH で差し替えられる（テスト用）。
import { execFileSync } from "node:child_process";

const fail = (msg) => {
  console.error(msg);
  process.exit(2);
};
const [pr, ...rest] = process.argv.slice(2);
if (rest.length || (pr && !/^\d+$/.test(pr))) fail("PR の番号だけを渡すか、何も渡さずに実行してください（例：! node .claude/aidd/bin/approve.mjs）。");
// 起動先の差し替え（テスト用）。.mjs と .js は node で起動する（Windows では .cmd をシェルを通さずに起動できないため）
const ghCmd = process.env.AIDD_GH || "gh";
const [exe, pre] = /\.(m?js)$/.test(ghCmd) ? [process.execPath, [ghCmd]] : [ghCmd, []];
const gh = (...a) => execFileSync(exe, [...pre, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
try {
  const target = pr ? [pr] : [];
  const head = gh("pr", "view", ...target, "--json", "headRefName", "--jq", ".headRefName").trim();
  if (!head.startsWith("aidd/")) fail(`PR の元のブランチ（${head}）は aidd/ ではありません。チケットのブランチで実行するか、チケットの PR の番号を渡してください。`);
  const body = ["", "aidd-approve"].join("/");
  gh("pr", "comment", ...target, "--body", body);
  console.log(`${head} の PR に「${body}」を投稿しました。`);
} catch (e) {
  fail(`投稿できませんでした（${(e.stderr || e.message || "").toString().trim()}）。`);
}
