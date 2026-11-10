// 作業ツリーの状態の取り出し（scope-check、validate-artifacts --changed、commit.mjs で共通に使う）。
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";

export { YAML };

const git = (root, args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/**
 * 変わったファイル（リポジトリのルートからの相対パス）。
 * マージの途中は、main から入ってステージされた変更を除き、衝突したファイルと作業ツリーで変えたファイルだけを返す。
 */
export function changedFiles(root) {
  let merging = true;
  try {
    git(root, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]);
  } catch {
    merging = false;
  }
  const out = git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const entries = out.split("\0").filter(Boolean);
  const files = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const [x, y, file] = [e[0], e[1], e.slice(3)];
    // 名前の変更は元の名前が次の要素に入る。元の名前も返す（git mv で範囲外のファイルを消したのを見逃さないため）
    const from = x === "R" || x === "C" ? entries[++i] : null;
    if (merging) {
      const conflicted = "DAU".includes(x) && "DAU".includes(y) && (x === "U" || y === "U" || x === y);
      if (!conflicted && y === " ") continue;               // ステージだけの変更は main から入ったもの
    }
    files.push(file);
    if (x === "R" && from) files.push(from);
  }
  return files;
}

/** 今のブランチのチケットの ID（aidd/<ticket-id>）。それ以外のブランチなら null。 */
export function currentTicket(root) {
  const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  const m = branch.match(/^aidd\/(\d{3}-[a-z0-9-]+)$/);
  return m ? m[1] : null;
}

/** 回数と違反の文の記録の置き場所（作業ツリーの外。git-common-dir/aidd/stop-blocks/）。 */
function blockPath(root, key) {
  const common = git(root, ["rev-parse", "--git-common-dir"]).trim();
  const dir = path.join(path.isAbsolute(common) ? common : path.join(root, common), "aidd", "stop-blocks");
  return { dir, f: path.join(dir, key.replace(/[^A-Za-z0-9_.-]/g, "_")) };
}

/**
 * コミットの検査の違反を直すために、同じサブエージェントを再開した回数を数える（limits.stop_blocks）。
 * 違反の文も横に残す（成功したときの作業ログに要約を入れる）。戻り値は、今回を含めた回数。
 */
export function countBlock(root, key, note = "") {
  const { dir, f } = blockPath(root, key);
  mkdirSync(dir, { recursive: true });
  const n = (existsSync(f) ? Number(readFileSync(f, "utf8")) || 0 : 0) + 1;
  writeFileSync(f, String(n));
  if (note) writeFileSync(`${f}.txt`, `${existsSync(`${f}.txt`) ? readFileSync(`${f}.txt`, "utf8") : ""}--- ${n} 回目\n${note}\n`);
  return n;
}

/** 今の回数（記録が無ければ 0）。 */
export function readBlocks(root, key) {
  const { f } = blockPath(root, key);
  return existsSync(f) ? Number(readFileSync(f, "utf8")) || 0 : 0;
}

/** 残した違反の文の要約（回ごとの最初の行）。 */
export function blockNote(root, key) {
  const { f } = blockPath(root, key);
  if (!existsSync(`${f}.txt`)) return "";
  const parts = readFileSync(`${f}.txt`, "utf8").split(/^--- \d+ 回目$/m).map((x) => x.trim()).filter(Boolean);
  return parts.map((x) => x.split("\n")[0].slice(0, 80)).join(" / ");
}

/**
 * 回数と違反の文の記録を消す。コミットに成功したとき、上限を超えて捨てるとき、ハーネスの定義が変わっていて捨てるときに呼ぶ。
 * 同じサブエージェントを次に再開したとき（SendMessage）、前の回数を持ち越さないためである。
 */
export function resetBlocks(root, key) {
  const { f } = blockPath(root, key);
  rmSync(f, { force: true });
  rmSync(`${f}.txt`, { force: true });
}

/** 運用パラメータ（defaults.yaml の上に specs/_current/_tech/harness.yaml を重ねる）。 */
export function loadLimits(root) {
  const read = (f) => (existsSync(f) ? YAML.parse(readFileSync(f, "utf8")) ?? {} : {});
  const d = read(path.join(root, ".claude/aidd/defaults.yaml"));
  const h = read(path.join(root, "specs/_current/_tech/harness.yaml"));
  return { ...(d.limits ?? {}), ...(h.limits ?? {}) };
}
