// プロダクトリードのコミット（コミットの検査）。検査を通ったときだけコミットする。
// 通らなければ何もコミットせず、違反を出して終了コード 2 で終わる。判定できない場合も 2。
//
// 使い方:
//   node .claude/aidd/bin/commit.mjs --agent <エージェント名> --agent-id <ID> --stage <工程名> --started-at <起動の時刻>
//        --head-before <起動の前の HEAD> --log-file <パス> [--state <状態>] -m <メッセージ>   サブエージェントの成果物と作業ログ
//   node .claude/aidd/bin/commit.mjs --orchestrator -m <メッセージ> <ファイル…>   プロダクトリード自身の書き込み（末尾が / ならフォルダの下の変更すべて）
//   node .claude/aidd/bin/commit.mjs --merge -m <メッセージ>                       main の取り込みと、衝突を解いた後
//   node .claude/aidd/bin/commit.mjs --core -m <メッセージ>                        /aidd-init の最初のコミット
//
// --agent は、サブエージェントの成果物と status.yaml の作業ログを 1 つのコミットにする。検査を先にし、記録を後にする。
// 順番を逆にすると、自分で書いた status.yaml を scope-check が範囲外の変更として止めるためである。
//   (0) HEAD が起動の前から動いていれば、同じブランチで先に進んだだけなら git reset --soft で戻し、すべてをそのサブエージェントの
//       変更として検査する。それ以外（ブランチの切り替えなど）は、直させずに打ち切る（出力の先頭が【打ち切り】。捨てて人に返す）
//       .claude/、CLAUDE.md、書き込み範囲の定義が変わっていても同じ
//   (1) 作業ツリーの未コミットの変更を、すべてそのサブエージェントのものとして検査する。違反なら何も書かず、
//       再開の回数（--agent-id ごと）を数えて、同じサブエージェントを再開して直させる案内を出す（上限を超えたら打ち切る）
//   (2) 通れば status.yaml の log に作業ログを足し（ほかの行の書式は変えない）、--state があれば state を変え、スキーマ検証する
//   (3) 検査をもう一度せずに、検査したファイルと status.yaml だけを 1 つのコミットにする。(2)(3) で失敗したら status.yaml を元に戻す
// どの使い方でも、コミットの前に、ステージした中身が検査したファイルだけかを確認し、git の hook を動かさない。
// hook（husky など。npm install で有効になることがある）が、検査の後にファイルを書き換えてコミットに入れないようにするためである。
// 作業ログ（--log-file）は、プロダクトリードが Write で書いたファイル。1 行目が起動の記録（--started-at の時刻）、
// 2 行目以降が完了の記録（今の時刻）。コマンドの文字列に入れないので、guard-bash の規則と Git Bash のパス変換を受けない。
// この中で実行する git は Bash のツールを通らないので、guard-bash の git commit の拒否の対象にならない。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const fail = (msg) => {
  console.error(msg);
  process.exit(2);
};

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const VALUED = ["-m", "--agent", "--agent-id", "--stage", "--started-at", "--head-before", "--log-file", "--state"];
const { resolveRoot } = await import(new URL("../lib/root.mjs", import.meta.url).href);
const root = resolveRoot();   // 実行したフォルダの作業ツリー（git worktree なら worktree）。aidd/lib/root.mjs
const git = (...a) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const lib = (f) => import(pathToFileURL(path.join(root, ".claude/aidd/lib", f)).href);
const { matchGlob } = await lib("scopes.mjs");   // 点で始まる名前にも一致する glob

// プロダクトリードが書くファイル。状態、人の答え、壁打ちのメモ、スクリプトと検査の出力
// 見た目の基準（specs/_current/<領域>/screenshots/）は、verify.mjs が差し替える
// 各領域のデザインシステムの写し（specs/_current/<領域>/mock/project/ds/）は、mock-render.mjs が _tech/ds/ から写す
const ORCHESTRATOR_FILES = ["specs/*/status.yaml", "specs/*/hearing/questions.yaml", "specs/*/hearing/brainstorm.md", "specs/*/results/**", "specs/_references/**", "specs/_current/*/screenshots/**", "specs/_current/*/mock/project/ds/**"];
// コアのファイル。.claude/ の下は、点で始まる名前（node_modules の中など）も含めるので、glob でなく前方一致で見る
const isCore = (f) => ["CLAUDE.md", ".mcp.json", ".gitignore"].includes(f) || f.startsWith(".claude/");
const match = (f, globs) => globs.some((g) => matchGlob(f, g));
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * ステージした中身を確認してからコミットする。allowed を渡したときは、ステージしたファイルがその中に収まることを確認する
 * （名前の変更は元と先の両方で見る）。git の hook は、存在しないフォルダを hooksPath にして動かさない。
 */
function commitStaged(message, allowed = null) {
  if (allowed) {
    const staged = git("diff", "--cached", "--name-only", "--no-renames", "-z").split("\0").filter(Boolean);
    const extra = staged.filter((f) => !allowed.includes(f));
    if (extra.length) throw new Error(`検査していないファイルがステージされています：${extra.join("、")}`);
  }
  const common = git("rev-parse", "--git-common-dir").trim();
  const noHooks = path.join(path.isAbsolute(common) ? common : path.join(root, common), "aidd", "no-hooks");
  git("-c", `core.hooksPath=${noHooks}`, "commit", "-q", "-m", message);
}

try {
  const message = opt("-m");
  if (!message) fail("コミットのメッセージを -m で渡してください。");
  const mode = ["--agent", "--orchestrator", "--merge", "--core"].filter((m) => args.includes(m));
  if (mode.length !== 1) fail("--agent、--orchestrator、--merge、--core のどれか 1 つを指定してください。");

  const { changedFiles } = await lib("workspace.mjs");
  const { validateFiles } = await lib("validate.mjs");

  let merging = true;
  try {
    git("rev-parse", "-q", "--verify", "MERGE_HEAD");
  } catch {
    merging = false;
  }
  const files = changedFiles(root);

  if (mode[0] === "--agent") await commitAgent(files, merging);

  if (files.length === 0 && !merging) {
    console.log("コミットする変更がありません。");
    process.exit(0);
  }
  const violations = [];
  let toAdd = ["-A"];
  if (mode[0] === "--orchestrator") {
    const given = args.filter((a, i) => !a.startsWith("--") && !VALUED.includes(args[i - 1]) && a !== "-m").map((f) => f.split(path.sep).join("/"));
    if (given.length === 0) fail("--orchestrator では、コミットするファイルを並べてください。");
    // 末尾が / のものはフォルダとして、その下の変わったファイル（消したものも）に広げる（mock-render と verify の画像）
    const listed = given.flatMap((g) => (g.endsWith("/") ? files.filter((f) => f.startsWith(g)) : [g]));
    for (const f of listed) if (!match(f, ORCHESTRATOR_FILES)) violations.push(`${f}：プロダクトリードが書くファイルではありません。`);
    for (const f of files) if (!listed.includes(f)) violations.push(`${f}：指定していないファイルが変わっています。サブエージェントの変更なら --agent でコミットしてください。`);
    violations.push(...validateFiles(root, listed.filter((f) => /\.(ya?ml|json)$/.test(f))));
    toAdd = ["--", ...listed];
  } else if (mode[0] === "--merge") {
    if (!merging) violations.push("マージの途中ではありません。");
    const unresolved = git("diff", "--name-only", "--diff-filter=U").split("\n").filter(Boolean);
    for (const f of unresolved) violations.push(`${f}：衝突が解けていません。`);
    violations.push(...(await lib("commit-checks.mjs")).changedArtifactViolations(root));
  } else {
    for (const f of files) if (!isCore(f)) violations.push(`${f}：コアのファイルではありません。`);
  }

  if (violations.length) fail(`検査に通らないため、コミットしませんでした。\n- ${violations.join("\n- ")}`);
  git("add", ...toAdd);
  commitStaged(message, mode[0] === "--orchestrator" ? toAdd.slice(1) : null);
  console.log(`コミットしました：${git("rev-parse", "--short", "HEAD").trim()} ${message}`);
} catch (e) {
  fail(`コミットの検査を判定できませんでした（${e.message}）。何もコミットしていません。`);
}

/** --agent：サブエージェントの成果物と作業ログを 1 つのコミットにする。 */
async function commitAgent(files, merging) {
  const agent = opt("--agent");
  const agentId = opt("--agent-id");
  const stage = opt("--stage");
  const startedAt = opt("--started-at");
  const headBefore = opt("--head-before");
  const logFile = opt("--log-file");
  const state = opt("--state");
  const message = opt("-m");
  if (!agent || !agentId || !stage || !startedAt || !headBefore || !logFile) {
    fail("--agent では、--agent-id、--stage、--started-at、--head-before、--log-file が必要です。");
  }
  if (merging) fail("マージの途中です。main の取り込みと衝突を解いた後は --merge でコミットしてください。");
  const { changedFiles, currentTicket, countBlock, readBlocks, resetBlocks, blockNote, loadLimits, YAML } = await lib("workspace.mjs");
  const { agentViolations, harnessChanges, RESUME_HINT } = await lib("commit-checks.mjs");
  const { validateFiles } = await lib("validate.mjs");
  const key = `${agentId}-resume`;

  let notes;
  try {
    notes = readFileSync(logFile, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } catch (e) {
    fail(`作業ログのファイルを読めません（${logFile}：${e.message}）。`);
  }
  if (notes.length < 2) fail("作業ログのファイルには、1 行目に起動の記録、2 行目以降に完了の記録を書いてください。");
  const ticket = currentTicket(root);
  if (!ticket) fail("今のブランチが aidd/<ticket-id> ではないため、チケットを特定できません。");
  // (0) HEAD の動き。同じブランチで先に進んだだけなら戻して、すべてをこのサブエージェントの変更として検査する
  const head = git("rev-parse", "HEAD").trim();
  if (head !== git("rev-parse", headBefore).trim()) {
    let ahead = false;
    try {
      git("merge-base", "--is-ancestor", headBefore, "HEAD");
      ahead = true;
    } catch { /* 先祖でなければ、ブランチを切り替えたか履歴を書き換えた */ }
    if (!ahead) {
      resetBlocks(root, key);
      fail("【打ち切り】サブエージェントが作業の場所（HEAD）を、起動の前のコミットから先に進める以外の形で動かしました。直させずに、起動の前のコミットに戻し、このサブエージェントの変更をすべて捨てて人に返してください。何もコミットしていません。");
    }
    git("reset", "-q", "--soft", headBefore);
    files.splice(0, files.length, ...changedFiles(root));
  }

  const statusRel = `specs/${ticket}/status.yaml`;
  const statusPath = path.join(root, statusRel);
  if (!existsSync(statusPath)) fail(`${statusRel} がありません。`);

  // ハーネスの定義の書き換え
  const harness = harnessChanges(root, agent);
  if (harness.length) {
    resetBlocks(root, key);
    fail(`【打ち切り】ハーネスの定義（${harness.join("、")}）が変わっています。直させずに、このサブエージェントの変更をすべて捨てて人に返してください。何もコミットしていません。`);
  }

  // (1) 検査（記録を書く前）
  const violations = files.length ? agentViolations(root, agent) : [];
  if (agent === "test-writer") violations.push(...redViolations(root, ticket, statusPath, files, YAML));
  if (agent === "implementer" || agent === "test-writer") violations.push(...verifyViolations(root, ticket, files));
  if (violations.length) {
    const limit = loadLimits(root).stop_blocks ?? 3;
    const n = countBlock(root, key, violations.join("\n"));
    if (n > limit) {
      resetBlocks(root, key);
      fail(`【打ち切り】検査に通らないため、記録もコミットもしませんでした。\n- ${violations.join("\n- ")}\n再開の回数が上限（${limit} 回）を超えました。このサブエージェントの変更をすべて捨てて人に返してください。`);
    }
    fail(`検査に通らないため、記録もコミットもしませんでした。\n- ${violations.join("\n- ")}\n${RESUME_HINT}\n（再開 ${n}/${limit} 回目）`);
  }

  // (2) 記録
  const original = readFileSync(statusPath, "utf8");
  const restore = () => {
    writeFileSync(statusPath, original);
    try {
      git("reset", "-q", "--", statusRel, ...files);
    } catch { /* ステージしていなければ何もしない */ }
  };
  try {
    const resumed = readBlocks(root, key);
    const entries = notes.map((note, i) => ({ at: i === 0 ? startedAt : now(), stage, note }));
    if (resumed > 0) entries[entries.length - 1].note += `（差し戻し ${resumed} 回：${blockNote(root, key)}）`;
    writeFileSync(statusPath, appendLog(YAML, original, entries, state));
    const errors = validateFiles(root, [statusRel]);
    if (errors.length) {
      restore();
      fail(`status.yaml の記録がスキーマに合わないため、記録もコミットもしませんでした。\n- ${errors.join("\n- ")}`);
    }
    // (3) 1 つのコミット（検査したファイルと status.yaml だけ）。files は変わったファイルのすべてなので、パスを渡さずに足す
    // （git rm で index からも消えたパスを渡すと git add が失敗するため）。検査したものだけかは commitStaged が確認する
    git("add", "-A");
    commitStaged(message, [...files, statusRel]);
  } catch (e) {
    restore();
    fail(`記録とコミットに失敗しました（${e.message}）。status.yaml を元に戻し、何もコミットしていません。`);
  }
  resetBlocks(root, key);
  console.log(`コミットしました：${git("rev-parse", "--short", "HEAD").trim()} ${message}`);
  process.exit(0);
}

/**
 * status.yaml の log に作業ログを足し、state を変えた文を返す。ほかの行の書式（行末のコメントの桁など）を変えないよう、
 * 行を文として足す。足した結果をパースし直して確認し、合わなければ YAML の文書として書き直す（その場合は書式が変わりうる）。
 */
function appendLog(YAML, original, entries, state) {
  const line = (e) => {
    const d = new YAML.Document(e);
    d.contents.flow = true;
    return d.toString({ lineWidth: 0 }).trim();
  };
  const before = YAML.parse(original) ?? {};
  const expected = (text) => {
    try {
      const after = YAML.parse(text) ?? {};
      const rest = (o) => JSON.stringify({ ...o, log: null, state: null });
      return JSON.stringify(after.log) === JSON.stringify([...(before.log ?? []), ...entries])
        && (state ? after.state === state : after.state === before.state) && rest(after) === rest(before);
    } catch {
      return false;
    }
  };
  const lines = original.replace(/\r\n/g, "\n").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  if (state) {
    const s = lines.findIndex((l) => /^state:/.test(l));
    if (s !== -1) lines[s] = lines[s].replace(/^state:([ \t]*)[^#]*?([ \t]+#.*)?$/, (_, sp, c) => `state:${sp || " "}${YAML.stringify(state).trim()}${c ?? ""}`);
  }
  const k = lines.findIndex((l) => /^log:/.test(l));
  let indent = "  ";
  let at = lines.length;
  if (k === -1) {
    lines.push("log:");
    at = lines.length;
  } else {
    lines[k] = lines[k].replace(/^log:[ \t]*\[\][ \t]*/, "log:");
    let end = k;
    for (let j = k + 1; j < lines.length && !/^[^\s#]/.test(lines[j]); j++) {
      const m = lines[j].match(/^(\s*)- /);
      if (m) indent = m[1];
      if (/^\s+\S/.test(lines[j])) end = j;               // 字下げした行だけを log の中身とみなす
    }
    at = end + 1;
  }
  lines.splice(at, 0, ...entries.map((e) => `${indent}- ${line(e)}`));
  const text = `${lines.join("\n")}\n`;
  if (expected(text)) return text;
  const doc = YAML.parseDocument(original);
  if (!doc.get("log")) doc.set("log", doc.createNode([]));
  const seq = doc.get("log");
  seq.flow = false;
  for (const e of entries) {
    const node = doc.createNode(e);
    node.flow = true;
    seq.add(node);
  }
  if (state) doc.set("state", state);
  return doc.toString({ lineWidth: 0 });
}

/**
 * implementer と test-writer のコミットに検証の根拠（results/verify.json）があれば、状態によらず、同じコミットで変わったほかのファイルより後に
 * 書かれていること（test-writer は、検証中にテストを直して流したときと、実装中を飛ばして検証を流したとき）。
 * verify.mjs の出力（results/ と、差し替えた見た目の基準）は比べない。passed は見ない。
 * 検証を流したかは、完了の報告のときにプロダクトリードが verify.json の有無で見る（止まったときは流していなくてよい）。
 * verify.mjs --measure は verify.json の更新の時刻を前の検証のときに戻すので、この検査はその形に頼る（--measure の後にコードを直し、
 * 検証だけを流し直した逆の順は、gate2-report が計測の started_at で拾う）。
 */
function verifyViolations(root, ticket, files) {
  const v = `specs/${ticket}/results/verify.json`;
  const vPath = path.join(root, v);
  if (!files.includes(v) || !existsSync(vPath)) return [];
  const at = statSync(vPath).mtimeMs;
  const output = (f) => f.startsWith(`specs/${ticket}/results/`) || /^specs\/_current\/[^/]+\/screenshots\//.test(f);
  const later = files.filter((f) => !output(f) && existsSync(path.join(root, f)) && statSync(path.join(root, f)).mtimeMs > at);
  return later.length ? [`${later.join("、")}：${v} を流した後に変わっています。最後に verify.mjs を流し直してください。`] : [];
}

/**
 * テスト作成中の test-writer のコミットで、Red の根拠（results/red-run.json）が、同じコミットで変わったほかのすべてのファイルより
 * 後に書かれていること。流した後にテスト、ヘルパー、テストの設定、受け口のどれかを直したら、流し直させる。
 * 説明のファイル（results/red-result.md）は流した結果を読んで書くものなので比較しない。
 * red-run.json のほかに変えたファイルが red-result.md だけで、red-run.json が既にあれば、Red の根拠を求めない（テストを変えていないので
 * 流し直さなくてよい。まだ無ければ求める）。
 * ほかの状態（検証中にスクリーンショットのテストを直すなど）では、Red の根拠を上書きしないので見ない。
 */
function redViolations(root, ticket, statusPath, files, YAML) {
  if ((YAML.parse(readFileSync(statusPath, "utf8")) ?? {}).state !== "テスト作成中") return [];
  const red = `specs/${ticket}/results/red-run.json`;
  const note = `specs/${ticket}/results/red-result.md`;
  const redPath = path.join(root, red);
  if (files.includes(note) && files.every((f) => f === red || f === note) && existsSync(redPath)) return [];
  if (!files.includes(red) || !existsSync(redPath)) {
    return [`${red}：テストを書き終えたら、最後に run-capture.mjs で流して Red の根拠を残してください。`];
  }
  const at = statSync(redPath).mtimeMs;
  const later = files.filter((f) => f !== red && f !== note && existsSync(path.join(root, f)) && statSync(path.join(root, f)).mtimeMs > at);
  return later.length ? [`${later.join("、")}：${red} を流した後に変わっています。最後に run-capture.mjs で流し直してください。`] : [];
}
