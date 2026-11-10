// PreToolUse（Bash、PowerShell）：善意でも起きる害の大きい操作だけを止める。判定できない場合は拒否する（終了コード 2）。
// PowerShell も同じ規則で読む。Windows のメインセッションは PowerShell のツールも持つため。
//
// - すべての呼び出し：承認の投稿（/aidd-approve を含むコメント、PR の Approve）と、承認のスクリプト（.claude/aidd/bin/approve.mjs）の
//   実行。人が ! で実行するもの。読むことは止めない
// - すべての呼び出し：マシン全体の設定を変える操作（git config --global と --system、gh auth の setup-git、login、logout、refresh）。人が ! で実行する
// - メインセッション：aidd/ のブランチの上での素の git commit とコミットを作る git merge。コミットは commit.mjs で行う
// - サブエージェント：git push と、マシン全体を変えるインストール。コミットやブランチの移動は、commit.mjs が起動の前の HEAD と
//   比較して受けるので、文字列では止めない
//
// 文字列を組み立てれば迂回できる。わざと回り込むことは防がない（目的の文書の前提 B）。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const deny = (reason, tail = true) => {
  console.error(tail ? `${reason} 必要な場合は作業を止め、理由をプロダクトリードへ報告してください。` : reason);
  process.exit(2);
};

// コマンドの区切り（行頭、;、&、|、(、改行、空白）の直後にある語として探す
const word = (re) => new RegExp(String.raw`(^|[;&|(\n]|\s)` + re, "m");
// コマンドの位置（行頭、;、&、|、( の直後と、then、do の後。そこからの空白と環境変数の指定を飛ばす）にある語として探す。
// 引数や本文の中の語（JSDoc の @param {number} port、PR の本文やコミットのメッセージの git commit など）に当たらないようにする。
// インストールの規則と、メインセッションのコミットと取り込みの規則に使う
const command = (re) => new RegExp(String.raw`(^|[;&|(]|\bthen\b|\bdo\b)[ \t]*(?:\w+=\S*[ \t]+)*` + re, "m");

/**
 * ヒアドキュメントの本文を除いたコマンド。書くファイルの中身（設定の port: や、正規表現の |brew|）をコマンドと読まないため。
 * シェル（bash <<EOF、ssh host <<EOF など）に渡す本文はコマンドとして実行されるので、除かずに読む。
 * <<<（here-string）と、1<<2 のようなシフトはヒアドキュメントとみなさない（終わりの印は英字か _ で始まるものだけ）
 */
const SHELL_INPUT = /^(?:\w+=\S*\s+)*(?:sudo\s+)?(?:bash|sh|zsh|dash|ksh|ssh|eval|xargs)\b/;
function stripHeredocs(cmd) {
  const lines = cmd.split("\n");
  const out = [];
  const ends = [];                                    // 待っている終わりの印（1 行に複数あれば順に）
  for (const line of lines) {
    if (ends.length) {
      const [end, dash, keep] = ends[0];
      if ((dash ? line.replace(/^\t+/, "") : line) === end) ends.shift();
      else if (keep) out.push(line);
      continue;
    }
    out.push(line);
    for (const m of line.matchAll(/(?<!<)<<(?!<)(-?)[ \t]*(["']?)([A-Za-z_][\w.-]*)\2/g)) {
      const before = line.slice(0, m.index).split(/[;&|(]/).pop().trim();
      ends.push([m[3], m[1] === "-", SHELL_INPUT.test(before)]);
    }
  }
  return out.join("\n");
}

// 投稿のコマンド。承認の合言葉は、これと同じコマンドにあるときだけ拒否する。
// 状態ファイルの記録などの文面に合言葉が出ても、投稿でなければ止めない。gh api は、書き込みの指定があるときだけ投稿とみなす
const POSTING = /\bgh\s+(pr\s+(comment|review)|issue\s+comment)\b|\bcurl\b|\b(Invoke-RestMethod|irm|Invoke-WebRequest|iwr)\b/i;
const GH_API = /\bgh\s+api\b/;
const GH_API_WRITE = /\s(-X\s*POST|--method\s+POST|-f|-F|--field|--raw-field|--input)\b/i;
const isPosting = (cmd) => POSTING.test(cmd) || (GH_API.test(cmd) && GH_API_WRITE.test(cmd));

/** 投稿のコマンドが本文を読むファイル（--body-file、-F、gh api の -F k=@f と --input）。標準入力（-）は除く。 */
function bodyFiles(cmd) {
  const unquote = (s) => s.replace(/^["']|["']$/g, "");
  const out = [];
  for (const m of cmd.matchAll(/(?:--body-file(?:=|\s+)|--input\s+)("[^"]+"|'[^']+'|\S+)/g)) out.push(unquote(m[1]));
  for (const m of cmd.matchAll(/\s(?:-F|--field|-f|--raw-field)\s+("[^"]+"|'[^']+'|\S+)/g)) {
    const v = unquote(m[1]);
    const at = v.indexOf("=@");
    if (at !== -1) out.push(v.slice(at + 2));
    else if (!v.includes("=") && /\bgh\s+(pr|issue)\s+comment\b/.test(cmd)) out.push(v);   // gh pr comment の -F は --body-file の短い形
  }
  return out.filter((f) => f && f !== "-");
}
/** Git Bash の形（/c/Users/...）を Windows のパスに直し、作業の場所から読む。 */
function readBody(file, cwd) {
  let f = file;
  if (process.platform === "win32") {
    const m = f.match(/^\/([a-zA-Z])\/(.*)$/);
    if (m) f = `${m[1]}:/${m[2]}`;
  }
  return readFileSync(path.isAbsolute(f) ? f : path.join(cwd, f), "utf8");
}

const APPROVAL = [
  { re: word(String.raw`gh\s+pr\s+review\b[^\n]*(\s--approve\b|\s-a\b)`), why: "PR の Approve は人だけが行えます。" },
  { re: word(String.raw`gh\s+api\b[^\n]*reviews\b[^\n]*APPROVE`), why: "PR の Approve は人だけが行えます。" },
];
// マシン全体の設定を変える操作は、メインセッションでもサブエージェントでも止める
const MACHINE_WIDE = [
  { re: word(String.raw`git(\s+-[A-Za-z]\s+\S+|\s+--?[\w-]+(=\S+)?)*\s+config\b[^\n;&|]*\s--(global|system)\b`), why: "マシン全体の設定を変えます。人に理由を伝え、人が ! で実行するよう頼んでください。" },
  { re: word(String.raw`gh\s+auth\s+(setup-git|login|logout|refresh)\b`), why: "マシン全体の設定を変えます。人に理由を伝え、人が ! で実行するよう頼んでください。" },
];
// 承認のスクリプトの実行。.claude/aidd/bin/ の場所のものを node で起動する形だけを見る（読むだけのコマンドと、案件の approve.mjs は止めない）
const runsApprove = (cmd) => /aidd[\\/]+bin\b[^\n]*\bapprove\.mjs/.test(cmd) && /(^|[;&|(\s])node(\.exe)?\s/m.test(cmd);

const SUBAGENT = [
  { re: word(String.raw`git(\s+-[A-Za-z]\s+\S+|\s+--?[\w-]+(=\S+)?)*\s+push\b`), why: "push はプロダクトリードだけが行います。" },
  { re: command(String.raw`(sudo|brew|apt|apt-get|yum|dnf|port|pacman|snap|choco|winget|asdf)\b`),
    why: "マシン全体へのインストールは、人が ! で行うか、プロダクトリードが toolchain.yaml の setup で行います。" },
  { re: word(String.raw`mise\s+(install|use|i|u)\b`), why: "マシン全体へのインストールは、プロダクトリードが toolchain.yaml の setup で行います。" },
  { re: word(String.raw`(npm|pnpm|yarn)\s+(i|install|add)\b[^\n]*\s(-g|--global)\b`), why: "グローバルへのインストールは、プロダクトリードが setup で行います。" },
  { re: /\b(curl|wget)\b[^\n]*\|\s*(sh|bash|zsh)\b/, why: "取得したスクリプトの実行によるインストールは禁止です。" },
];

// コミットを作る操作（git の前の -C や -c の指定も許して探す）
const COMMIT = command(String.raw`git(\s+-[A-Za-z]\s+\S+|\s+--?[\w-]+(=\S+)?)*\s+(commit|revert|cherry-pick|am|merge\s+--continue)\b`);
// main の取り込み（git merge）は、コミットを作らない形だけを許す（--no-commit、--ff-only、--abort）。
// 衝突が無いと git merge はそのままコミットを作り、commit.mjs --merge の検査を通らないため
// merge の後に - が続くもの（merge-base、merge-tree など）は別のコマンドなので当てない
const MERGE = command(String.raw`git(\s+-[A-Za-z]\s+\S+|\s+--?[\w-]+(=\S+)?)*\s+merge(?![\w-])[^\n;&|]*`);
const mergeCommits = (cmd) => (cmd.match(new RegExp(MERGE.source, "gm")) ?? [])
  .some((m) => !/\s--(no-commit|ff-only|abort|quit)\b/.test(m));
/** 今のブランチが aidd/ のチケットのブランチか。判定できなければ（git の外など）、チケットのブランチではないとみなす。 */
function onTicketBranch(input) {
  try {
    const cwd = input.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
    const b = execFileSync("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return b.startsWith("aidd/");
  } catch {
    return false;                                     // git の外（リポジトリでない場所）では、チケットのブランチではない
  }
}

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const cmd = input.tool_input?.command;
  if (typeof cmd !== "string") deny("コマンドが分かりません。");
  const sub = !!input.agent_id;

  for (const { re, why } of APPROVAL) if (re.test(cmd)) deny(why);
  for (const { re, why } of MACHINE_WIDE) if (re.test(cmd)) deny(sub ? `${why}（サブエージェントは作業を止め、理由をプロダクトリードへ報告してください）` : why, false);
  if (runsApprove(cmd)) deny("承認のスクリプト（approve.mjs）は、人が ! で実行するものです。");
  if (isPosting(cmd)) {
    if (/\/aidd-approve/.test(cmd)) deny("承認（/aidd-approve）は人だけが投稿できます。");
    for (const f of bodyFiles(cmd)) {
      let body;
      try {
        body = readBody(f, input.cwd ?? process.cwd());
      } catch {
        deny(`投稿の本文のファイル（${f}）を読めないため、承認の投稿でないかを確認できません。先にファイルを書いてから投稿してください。`);
      }
      if (/\/aidd-approve/.test(body)) deny("承認（/aidd-approve）は人だけが投稿できます。");
    }
  }
  if (sub) {
    const code = stripHeredocs(cmd);
    for (const { re, why } of SUBAGENT) if (re.test(code)) deny(why);
    process.exit(0);
  }
  // メインセッション
  if (COMMIT.test(cmd) && onTicketBranch(input)) {
    deny("aidd/ のブランチの上では、git commit を直接実行できません。node .claude/aidd/bin/commit.mjs でコミットしてください（検査を通ったときだけコミットします）。");
  }
  if (mergeCommits(cmd) && onTicketBranch(input)) {
    deny("aidd/ のブランチの上では、コミットを作る git merge を実行できません。git merge --no-ff --no-commit origin/main で取り込み、node .claude/aidd/bin/commit.mjs --merge -m <メッセージ> でコミットしてください。");
  }
} catch (e) {
  deny(`コマンドを判定できませんでした（${e.message}）。`);
}
