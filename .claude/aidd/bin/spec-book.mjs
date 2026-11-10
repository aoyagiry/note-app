// 仕様の全体のページを作り直す。中身は lib/spec-book.mjs。人が仕様の全体を読みたいと言ったときに、
// プロダクトリードが流して open で開く。Gate のページ（approval-draft.mjs と gate2-report.mjs）は、自分のページを作るたびに同じものを作る。
//
// 使い方：node .claude/aidd/bin/spec-book.mjs [<ticket-id>]
//   チケットを渡すと specs/<ticket-id>/results/spec-book.html に、渡さなければ（チケットの途中でないとき）
//   <git の共通の場所>/aidd/tmp/spec-book.html に書き、書いたパスを出す。コミットしない
// 作れなければ終了コード 2。
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

try {
  const ticket = process.argv[2] ?? null;
  if (ticket?.startsWith("--")) throw new Error(`知らない引数です：${ticket}`);
  const { resolveRoot } = await import(new URL("../lib/root.mjs", import.meta.url).href);
  const root = resolveRoot();
  const { writeSpecBook } = await import(pathToFileURL(path.join(root, ".claude/aidd/lib/spec-book.mjs")).href);
  let file;
  if (ticket) {
    if (!existsSync(path.join(root, "specs", ticket))) throw new Error(`specs/${ticket} がありません`);
    file = path.join(root, "specs", ticket, "results", "spec-book.html");
  } else {
    const common = execFileSync("git", ["-C", root, "rev-parse", "--git-common-dir"], { encoding: "utf8" }).trim();
    file = path.join(path.resolve(root, common), "aidd", "tmp", "spec-book.html");
  }
  writeSpecBook(root, file, { ticket });
  const rel = path.relative(root, file);
  console.log(rel.startsWith("..") ? file : rel);
} catch (e) {
  console.error(`仕様の全体のページを作れませんでした（${e.message}）。`);
  process.exit(2);
}
