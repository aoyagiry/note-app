// 作業ツリーのルートの決め方（hook、commit.mjs、検査スクリプトで共通に使う）。
// cwd（hook では入力の cwd、スクリプトでは実行したフォルダ）が git の作業ツリーの中なら、その作業ツリーの最上位を使う。
// CLAUDE_PROJECT_DIR は Claude Code を起動したフォルダを指すので、git worktree で作業していると元のリポジトリになり、
// worktree の中の書き込みが範囲外と判定されるため。
// git の作業ツリーでないとき（テスト用のフォルダなど）だけ、CLAUDE_PROJECT_DIR を使う。
// 最上位は git rev-parse --show-cdup で cwd からの相対として求める。--show-toplevel は実体のパス（macOS の /private/var など）を
// 返し、書き込み先のパスと書き方がずれて、相対パスを正しく取れなくなるため。
// node の組み込みだけを使う。hook がこのファイルを読むのはルートを決める前なので、ルートの node_modules に頼れない。
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";

/** dir を含む git の作業ツリーの最上位。git の作業ツリーでなければ null。 */
export function topOf(dir) {
  try {
    const cdup = execFileSync("git", ["-C", dir, "rev-parse", "--show-cdup"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return path.resolve(dir, cdup);
  } catch {
    return null;
  }
}

/**
 * 作業ツリーのルート。input は hook の入力（スクリプトでは省く）。
 * CLAUDE_PROJECT_DIR が同じ作業ツリーを指すときは、その書き方を使う。process.cwd() は実体のパスを返すため、
 * 書き方がずれないようにする。
 */
export function resolveRoot(input = {}) {
  const dir = input.cwd ?? process.cwd();
  const top = topOf(dir);
  const pd = process.env.CLAUDE_PROJECT_DIR;
  if (top && pd && sameDir(top, pd)) return pd;
  return top ?? pd ?? dir;
}

function sameDir(a, b) {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}
