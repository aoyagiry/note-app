// Gate 1 の承認のページ（目的の文書の「人への問い方」）。仕様のファイルから機械で作り、仕様に入ったものは必ず載せる。
// 話したことから書いた下書き（要件と具体例と画面）を主にし、AI が提案して問いで決まる要件と具体例は「AI の提案と問い」に、
// それを決める問いと一緒に分けて載せる。
// 仕様の変更は、どれかの節にちょうど 1 回載る。問いの about が指す変更を、その問いのものとする（先の問いが取る）。
// プロダクトリードが実行し、全文を PR の本文にする（本文はファイルで gh pr edit --body-file に渡す）。
// 同じ中身の HTML（手元の PNG を相対パスで指す）を書き、ブラウザで見せる。会話には要点（approval-summary.md）を出す。
// 画面の相談の始まり（status.yaml に consult_started を書いたコミット）から後に、画面文の一覧とモックが変わった所は、
// 要点の先頭に「画面の相談で直した所」として出す（人がキャンバスで直したか、人のコメントで描き直したもの）。
// ページを作るたびに、同じフォルダに仕様の全体のページ（spec-book.html。lib/spec-book.mjs。コミットしない）も作り直し、ページの上のリンクと、
// 影響の行の要件から指す。作れなければ知らせて、承認のページは作る。
// 最新の仕様のレビューの結果に指摘が残っていれば、「仕様のレビューで残った指摘」の節に出す（上限で「ここで打ち切る」と答えた後に残ったもの）。
//
// 使い方：node .claude/aidd/bin/approval-draft.mjs <ticket-id>
//   書き出し先は specs/<ticket-id>/results/approval-draft.md。HTML と要点は同じフォルダの
//   approval-draft.html と approval-summary.md。比較する元は origin/main とのマージの基点
// 判定できなければ終了コード 2。
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// 承認のページだけの見た目。影響の行の下に畳んだもとの要件
const DRAFT_CSS = ".why details { margin-top: 2px; } .why details summary { cursor: pointer; color: var(--acc); font-size: .85rem; }";

const args = process.argv.slice(2);
try {
  const ticket = args[0];
  if (!ticket || ticket.startsWith("--")) throw new Error("チケットの ID を渡してください");
  const { resolveRoot } = await import(new URL("../lib/root.mjs", import.meta.url).href);
  const root = resolveRoot();
  const lib = (f) => import(pathToFileURL(path.join(root, ".claude/aidd/lib", f)).href);
  const { specDiff, defaultFrom } = await lib("spec-diff.mjs");
  const { buildIndex, isBase, reader, parseYaml, sameItem, stripId } = await lib("id-graph.mjs");
  const { exampleLine, ticketPurpose, areaHeading, readYaml, designDiff, DESIGN_FILE, DS_DIR, isBaseCss, BASE_CSS_LABEL, answered } = await lib("render.mjs");
  const { esc, gwt, page, codeSpan, clean, swatch, rawList, shot: shotOf } = await lib("page.mjs");
  const { ticketScreens, ticketParts, groupParts, partAreaName, readsOf, imageLine, githubRepo, VARIANT_LABEL } = await lib("screens.mjs");
  const { idNames, anchorOf, tryWriteSpecBook } = await lib("spec-book.mjs");
  const git = (...a) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

  const d = specDiff(root, { ticket, from: defaultFrom(root) });
  const index = buildIndex(root);
  const out = path.resolve(root, `specs/${ticket}/results/approval-draft.md`);
  const { title, purpose } = ticketPurpose(ticket, index);
  const status = readYaml(root, `specs/${ticket}/status.yaml`);
  const repo = githubRepo(root);
  const screens = ticketScreens(root, ticket);
  // 画面の文（画面文の一覧）の変更。描いた画面に見えている新しい文は畳み、変えた文と、描いた画面の無い文は開く
  const { textsDiff, textsArea, textsMd, textsHtml } = await lib("texts.mjs");
  const textsRows = textsDiff(root, d.from);
  const drawn = new Set(screens.map((s) => `${s.area}/${s.id}`));
  const textsFolded = textsRows.filter((r) => r.change === "added" && drawn.has(`${textsArea(r)}/${r.screen}`));
  const textsOpen = textsRows.filter((r) => !textsFolded.includes(r));
  const textsName = (r) => screens.find((s) => s.area === textsArea(r) && s.id === r.screen)?.title ?? r.screen;
  const textsFoldedLabel = `描いた画面に見えている新しい文（${textsFolded.length} 件）`;
  const byKey = new Map(d.changes.map((c) => [c.key, c]));

  // ---------- 画面の相談で直した所 ----------
  // 起点は、status.yaml に consult_started を書いた最後のコミット（相談をやり直したら、その始まり）。status.yaml の履歴を新しい順にたどり、
  // consult_started.at が作業ツリーの値と同じコミットのうち、最も古いもの（同じ値が続く間）とする。
  // そこから後の画面文の一覧の変わりと、モックの元（画面の元、画面例、画面の CSS、共通部品）の変わりを出す。相談の後は、人が直接直したか人のコメントで描き直したものなので、分けない
  const consultFrom = (() => {
    const rel = `specs/${ticket}/status.yaml`;
    const now = status?.consult_started?.at;
    if (!now) return null;
    let commits = [];
    try { commits = git("log", "--format=%H", "--", rel).split("\n").filter(Boolean); } catch { return null; }
    const atOf = (c) => { const t = reader(root, c).text(rel); return t ? parseYaml(t, rel, c).consult_started?.at : null; };
    let from = null;
    for (const c of commits) {
      if (String(atOf(c)) === String(now)) from = c;
      else if (from) break;
    }
    return from;
  })();
  const parts = ticketParts(root, ticket);
  const consult = (() => {
    if (!consultFrom) return null;
    const texts = textsDiff(root, consultFrom);
    const mocks = git("diff", "--name-only", "-z", consultFrom, "--", "specs/_current").split("\0").filter((f) => /\/mock\/project\/[^/]+\.(?:dc\.html|css)$/.test(f));
    // 描き直した artboard は主の幅の 1 枚で示す。共通部品は、名前ごとに最初の領域の artboard
    const boards = mocks.length ? screens.filter((s) => s.main && [...readsOf(root, s.mock)].some((f) => mocks.includes(f))) : [];
    const partShots = groupParts(parts).map((g) => g.parts[0]).filter((p) => mocks.includes(p.mock) || mocks.includes(p.css));
    return texts.length || boards.length || partShots.length ? { texts, boards, partShots } : null;
  })();
  const boardLabel = (s) => (s.ac ? `${s.title}：${s.example ? exampleLine(s.example) : s.ac}` : s.variant ? `${s.title}：${VARIANT_LABEL[s.variant] ?? s.variant}（モックだけ）` : `${s.title}（開いたとき）`);
  const partLabel = (p) => `共通部品「${p.name}」`;
  const CONSULT_NOTE = "画面の相談を始めてから、あなたがキャンバスで直した所と、あなたのコメントで描き直した所です。";
  const consultShots = consult ? `描き直した画面（${consult.partShots.length + consult.boards.length} 枚）` : "";

  // ---------- 問いと、その about が指す変更（先の問いが取る。ちょうど 1 回載せるため） ----------
  const questions = readYaml(root, `specs/${ticket}/hearing/questions.yaml`)?.questions ?? [];
  // about は領域を付けた形（rooms/REQ-x、_intent/GOAL-001、TICKET/002-x）が正。前が無い形（GOAL-001）は、末尾が一致する変更が 1 つだけなら当てる
  // 変わっていない要件を指していても、その具体例が変わっていれば、その要件の問いとする。具体例の親は、要件か共通の要件
  const isParent = (k) => ["REQ", "RULE"].includes(k);
  const resolve = (about) => {
    const a = String(about);
    if (byKey.has(a) || (isParent(index.items.get(a)?.kind) && d.changes.some((c) => c.parent === a))) return a;
    if (a.includes("/")) return null;
    const hits = d.changes.map((c) => c.key).filter((k) => k.endsWith(`/${a}`));
    return hits.length === 1 ? hits[0] : null;
  };
  // 要件の文も変わっているなら、具体例を指す about は要件に直す（要件と具体例を同じ問いに付け、2 か所に分けない）
  const toRule = (k) => { const c = byKey.get(k); return c?.kind === "AC" && c.parent && byKey.has(c.parent) ? c.parent : k; };
  const claimed = new Map();   // 変更のキー → 問いの番号
  questions.forEach((q, i) => {
    for (const a of q.about ?? []) {
      const r = resolve(a);
      const k = r && toRule(r);
      if (!k || claimed.has(k)) continue;
      claimed.set(k, i);
      // 要件を指す問いは、その要件の具体例の変更も一緒に見せる（答えで具体例も変わるため）
      if (isParent((byKey.get(k) ?? index.items.get(k))?.kind)) for (const c of d.changes) if (c.parent === k && !claimed.has(c.key)) claimed.set(c.key, i);
    }
  });

  // ---------- デザインシステムの変更 ----------
  // 値（design.yaml）か土台の CSS（_tech/ds/<フォルダ>/base.css）を変えたら、確認してほしいことに出す
  const dsChanged = d.files.tech_docs.includes(DESIGN_FILE) || d.files.tech_docs.some(isBaseCss);
  const { now: dsNow, before: dsBefore, diff: dsDiff, base: dsBase } = dsChanged ? designDiff(root, d.from) : { now: readYaml(root, DESIGN_FILE), before: null, diff: [], base: [] };
  // 値か土台の CSS を変えて撮り直した、仕様の変更の無い領域の画面の元
  const changedAreas = new Set(d.changes.map((c) => c.area));
  const restyled = dsDiff.length || dsBase.length ? screens.filter((s) => !s.ac && !s.variant && !changedAreas.has(s.area)) : [];
  // 同じ見た目なので代表の画面例にまとめた具体例（also）から、代表の画面例（主の幅）を引く。具体例のキーは ticketScreens が決めたもの
  // （共通の要件の代表の具体例なら _shared/AC-…）
  const sameAs = (key) => screens.find((x) => x.main && x.also.some((y) => y.acKey === key));
  // 要件と具体例の横に置く画面例は、主の幅（canvas.yaml の widths の先頭）の 1 枚だけ。もう一方の幅は「画面」の節に回す
  const exampleBoards = (c) => (c.change !== "removed" ? screens.filter((x) => x.ac && x.main && x.acKey === c.key) : []);
  // 前の領域の具体例を、中身を変えずに共通の要件の代表に移したもの（spec-changes.yaml の renames）。今と後の同じ文の対を出さず、
  // 移したことを 1 行で言う
  const movedToShared = (c) => c.change === "modified" && c.renamed_from && c.area === "_shared" && sameItem(stripId(c.before), stripId(c.after));
  const MOVED = "共通の要件の代表に移した";

  // 要件の行。変わっていない要件は、今の文を見出しにする（具体例だけが変わった）
  const reqLine = (req) => {
    const c = byKey.get(req);
    if (c?.change === "removed") return [`- ~~${c.before.statement}~~（この要件は無くなります）`];
    if (c?.change === "modified" && c.before.statement !== c.after.statement) return [`- 今：${c.before.statement}`, `- 後：${c.after.statement}`];
    return [`- ${index.items.get(req)?.item?.statement ?? c?.before?.statement ?? req}`];
  };
  const BASE_NOTE = `${BASE_CSS_LABEL}：`;
  const RESTYLED = `デザインシステムの${[dsDiff.length && "値（色など）", dsBase.length && "土台の CSS"].filter(Boolean).join("と")}が変わって、見た目が変わる画面`;
  const CANVAS_NOTE = "今もキャンバスを直してかまいません。直したら、最後の問いで「キャンバスにコメントを送ったか、直接直した」を選んでください。写しを取って、仕様と画面文の一覧に戻します。";
  const affectsNote = "AI は、これらへの影響と、前の仕様とのぶつかりを深く確認しています。";
  const noAffects = "今あるものへの影響はありません（足すだけ）";
  const sharedLabel = { GOAL: "目的", FACT: "前提の事実", TERM: "用語", RULE: "共通の要件", NFR: "非機能要件" };
  // 公開の後でないと確認できない非機能要件は、そう添える
  const AFTER_RELEASE = "（公開の後に確認する）";
  const sharedText = (c, x) => (c.kind === "TERM" ? `${x.name}：${x.definition}` : c.kind === "GOAL" ? `${x.statement}（実現の目安：${x.success}）` : `${x.statement}${c.kind === "NFR" && x.after_release ? AFTER_RELEASE : ""}`);
  // 先に要るチケットは、ほかの依存をたどれば含まれるものを外して示す（ticket-plan.yaml の depends_on はそのまま）
  const depsOf = (id) => index.items.get(`TICKET/${id}`)?.item?.depends_on ?? [];
  const reach = (id, seen = new Set()) => { for (const d of depsOf(id)) if (!seen.has(d)) { seen.add(d); reach(d, seen); } return seen; };
  const directDeps = (deps = []) => deps.filter((d) => !deps.some((o) => o !== d && reach(o).has(d)));
  // 名前、目的、直接の依存が同じで、範囲か依存の書き方だけを変えた行に添える文
  const scopeNote = (b, a) => {
    const diff = (k, label) => {
      const x = b.scope?.[k] ?? [], y = a.scope?.[k] ?? [];
      return [...y.filter((t) => !x.includes(t)).map((t) => `${label}に「${t}」を足す`), ...x.filter((t) => !y.includes(t)).map((t) => `${label}から「${t}」を外す`)];
    };
    const notes = [...diff("includes", "できること"), ...diff("excludes", "作らないもの")];
    return notes.length ? notes.join("、") : "先に要るチケットの書き方を変える";
  };
  // チケットは ID（002-reserve など。人も /aidd-run で使う）と名前で示す
  const ticketTitle = (id) => `${id} ${index.items.get(`TICKET/${id}`)?.item?.title ?? ""}`.trim();
  const RELEASE = "（公開のチケット）";
  const ticketRow = (x, kind) => (kind === "LATER" ? `後のチケットに回す：${x.title}（${x.reason}）` : `${x.id} ${x.title}${x.release ? RELEASE : ""}：${x.purpose}${x.depends_on?.length ? `（先に${directDeps(x.depends_on).map((id) => `「${ticketTitle(id)}」`).join("、")}）` : ""}`);
  /** 要件と具体例以外の変更を 1 行にする。 */
  const itemLine = (c) => {
    if (["_intent", "_shared"].includes(c.area) && sharedLabel[c.kind]) {
      if (c.change === "added") return `- ${sharedLabel[c.kind]}：${sharedText(c, c.after)}`;
      if (c.change === "removed") return `- ~~${sharedLabel[c.kind]}：${sharedText(c, c.before)}~~（無くなります）`;
      return `- ${sharedLabel[c.kind]}　今：${sharedText(c, c.before)}　後：${sharedText(c, c.after)}`;
    }
    if (c.kind === "NFR") return c.change === "removed" ? `- ~~品質：${c.before.statement}~~（無くなります）` : `- 品質：${c.after.statement}${c.after.after_release ? AFTER_RELEASE : ""}`;
    if (c.kind === "TECH") return c.change === "removed" ? `- ~~技術の選択：${c.before.summary}~~（やめます）` : `- 技術の選択：${c.after.summary}`;
    if (["TICKET", "LATER"].includes(c.kind)) {
      if (c.change === "added") return `- ${ticketRow(c.after, c.kind)}`;
      if (c.change === "removed") return `- ~~${ticketRow(c.before, c.kind)}~~（無くなります）`;
      if (ticketRow(c.before, c.kind) === ticketRow(c.after, c.kind)) return `- ${ticketRow(c.after, c.kind)}（${scopeNote(c.before, c.after)}）`;
      return `- 今：${ticketRow(c.before, c.kind)}\n  後：${ticketRow(c.after, c.kind)}`;
    }
    if (c.kind === "AC" && c.area === "_tech") {
      if (c.change === "added") return `- ${exampleLine(c.after)}`;
      if (c.change === "removed") return `- ~~${exampleLine(c.before)}~~（無くなります）`;
      return `- 今：${exampleLine(c.before)}\n  後：${exampleLine(c.after)}`;
    }
    if (c.key.endsWith("/purpose")) return c.change === "modified" ? `- 目的　今：${c.before.statement}　後：${c.after.statement}` : `- 目的：${(c.after ?? c.before).statement}`;
    return `- ${(c.after ?? c.before)?.statement ?? (c.after ?? c.before)?.summary ?? c.key}`;
  };

  // システム全体の目的、前提、共通の要件は、種類（目的、前提の事実、用語、共通の要件、非機能要件）ごとにまとめる。それ以外（要件と具体例の形のもの）は後ろに。
  // 共通の要件の代表の具体例は、共通の要件のまとまりに入れ、その共通の要件の下に出す
  const sharedAc = (c) => c.kind === "AC" && c.area === "_shared";
  const sharedGroups = (cs) => [
    ...Object.entries(sharedLabel).map(([k, label]) => ({ label, kind: k, cs: cs.filter((c) => (c.kind === k || (k === "RULE" && sharedAc(c))) && ["_intent", "_shared"].includes(c.area)) })).filter((g) => g.cs.length),
    ...(cs.some((c) => !sharedLabel[c.kind] && !sharedAc(c)) ? [{ label: null, cs: cs.filter((c) => !sharedLabel[c.kind] && !sharedAc(c)) }] : []),
  ];
  // まだ答えていない問いが取った変更は「AI の提案と問い」に、残り（答えた問いで決まったものを含む）は下書きの各節に載せる（ちょうど 1 回）
  const free = (c) => !claimed.has(c.key) || answered(questions[claimed.get(c.key)]);
  const mine = (i) => (answered(questions[i]) ? [] : d.changes.filter((c) => claimed.get(c.key) === i));
  // 答えた問いで決まった変更の、問いの番号（1 から）。要件と具体例の節でラベルを付ける
  const decidedBy = (c) => (c && claimed.has(c.key) && answered(questions[claimed.get(c.key)]) ? claimed.get(c.key) + 1 : null);
  const decidedNote = (n) => `AI の提案。問い ${n} の答えで決まった`;
  const decidedQs = questions.map((q, i) => answered(q) && d.changes.some((c) => claimed.get(c.key) === i));
  // 後で変えにくい技術の選択（問いが取ったものは問いの所に出す）
  const hardTech = d.changes.filter((c) => c.kind === "TECH" && c.change !== "removed" && c.after.alternatives && free(c));
  const hardCount = hardTech.length + (dsChanged ? 1 : 0);
  // 今あるものへの影響の一覧：今の spec-diff の行と、プロダクトリードが status.yaml に足した行（source: lead）
  const affects = [...d.affects, ...(status?.affects ?? []).filter((r) => r.source !== "spec-diff")];
  // 行ごとに、何が変わるかの前と後（before_after）を添える。要件の行（name がもとの要件の全文。main の取り込みで
  // 重なった要件の行も）は、行を変わること（reason と before_after）だけにし、もとの要件の文は、下書きと要点では最初の 1 文だけを添え、
  // ページでは行の下に畳む。ほかの行（チケットの行、文書など）の name は短い名前なので、今のまま前に置く
  const isReqRow = (r) => /(?:^|\/)(?:REQ|RULE|NFR)-/.test(r.key ?? "") || r.kind === "main-overlap";
  const firstSentence = (t) => { const x = String(t); const i = x.indexOf("。"); return i >= 0 && i < x.length - 1 ? `${x.slice(0, i + 1)}…` : x; };
  const changeText = (r) => `${r.reason}${r.before_after ? `。${r.before_after}` : ""}`;
  const affectLine = (r) => (isReqRow(r) ? `${changeText(r)}（もとの要件：${firstSentence(r.name)}）` : `${r.name}：${changeText(r)}`);
  // 仕様のレビューで残った指摘：最新の仕様のレビューの結果（reviews/spec/ の番号の最も大きいファイル）の指摘。指摘を直した後はレビューを
  // もう一度通すので、残るのは上限で「ここで打ち切る」と答えた後の回だけ（aidd-run の段 1 の 6）。ID と直し方の案は出さない。
  // 指摘と場面の文の中の ID は、仕様の全体のページと同じ道具で、指す項目の文にする
  const remaining = (() => {
    const dir = `specs/${ticket}/reviews/spec`;
    const files = existsSync(path.join(root, dir)) ? readdirSync(path.join(root, dir)).filter((f) => /^\d+-c\d+\.yaml$/.test(f)).sort((a, b) => parseInt(a, 10) - parseInt(b, 10)) : [];
    const findings = files.length ? readYaml(root, `${dir}/${files.at(-1)}`)?.findings ?? [] : [];
    const { nameIds } = idNames(index);
    return findings.map((f) => {
      const area = String(f.where ?? "").match(/^(.+)\/(?:REQ|RULE|NFR|TERM|FACT|GOAL|AC)-/)?.[1];
      return { what: nameIds(f.what, { area }), scene: f.scene ? nameIds(f.scene, { area }) : null };
    });
  })();
  const REMAINING_NOTE = "仕様のレビューが最後の回に挙げ、直していない指摘です。この内容で作ってよいかを、承認の前に見てください。";
  const open = questions.filter((q) => !answered(q)).length;
  // 冒頭の数（0 のものは出さない）：[数, 名前, 単位]
  // 変わる画面の数は、幅ごとの撮り分けを 1 つに数える
  const screenCount = new Set(screens.map((s) => `${s.area}/${s.id}/${s.ac ?? s.variant ?? ""}`)).size;
  const counts = [[questions.length, "問い", "個"], [hardCount, "後で変えにくいもの", "個"], [screenCount, "変わる画面", "枚"]].filter(([n]) => n);
  const canvases = [...new Map([...screens, ...parts.flatMap((p) => p.rep)].filter((s) => s.canvas).map((s) => [s.canvas, s.area])).entries()];

  // ---------- 下書きの組み立て（PR の本文とページで同じ中身を、同じ順に並べる。仕様の変更はちょうど 1 回載る） ----------
  // 要件（asRule。共通の要件のまとまりでは共通の要件も）と、具体例の親を、要件と具体例のまとまりにする。親の変更は 1 回だけ載せる
  const groupRules = (cs, asRule = (c) => c.kind === "REQ") => {
    const isRuleish = (c) => asRule(c) || (c.kind === "AC" && c.parent);
    const reqs = [...new Set(cs.filter(isRuleish).map((c) => (c.kind === "AC" ? c.parent : c.key)))];
    return [
      ...reqs.map((req) => ({ type: "rule", req, examples: cs.filter((x) => x.kind === "AC" && x.parent === req) })),
      ...cs.filter((x) => !isRuleish(x) && !reqs.includes(x.key)).map((c) => ({ type: "item", c })),
    ];
  };
  const asSharedRule = (c) => c.kind === "RULE";
  const restyledFiles = new Set(restyled.map((s) => s.file));
  // 要件と具体例（か AI の提案と問い）の具体例の横に、主の幅の画面例を置く具体例
  const shownAc = new Set(d.changes.filter((c) => c.kind === "AC" && c.parent && c.change !== "removed").map((c) => c.key));
  const gallery = [];
  for (const area of [...new Set(screens.filter((s) => !restyledFiles.has(s.file)).map((s) => s.area))]) {
    for (const id of [...new Set(screens.filter((x) => x.area === area && !restyledFiles.has(x.file)).map((x) => x.id))]) {
      const boards = screens.filter((x) => x.area === area && x.id === id);
      // 画面の元は幅ごとに 1 枚。最初の幅を代表にし、ほかの幅は後ろに並べる
      const bases = boards.filter((x) => !x.ac && !x.variant);
      const base = bases[0];
      const name = boards[0].title;
      const label = base ? (base.change === "added" ? "新しい画面" : "変わる画面") : boards.some((x) => x.change === "added") ? "画面例を足す" : "画面例を描き直す";
      // 具体例の横に出ない画面例（前のチケットの画面例の描き直しと、主の幅でない幅）と、モックだけの画面（読み込み中、長い値）を、画面例の後ろに並べる
      const rest = [...boards.filter((x) => x.ac && (!shownAc.has(x.acKey) || !x.main)), ...boards.filter((x) => x.variant)];
      if (!base && !rest.length) continue;   // 画面例がすべて要件と具体例にあれば、中身の無い見出しを出さない
      const w = (s) => (s.width && bases.length + rest.length > 1 && new Set(boards.map((x) => x.width)).size > 1 ? `（${s.width}）` : "");
      gallery.push({ name, label, base, rest: [...bases.slice(1).map((s) => ({ s, text: `開いたとき${w(s)}` })),
        ...rest.map((s) => ({ s, text: `${s.variant ? `${VARIANT_LABEL[s.variant] ?? s.variant}（モックだけ）` : s.example ? exampleLine(s.example) : s.ac}${w(s)}`, other: !!s.ac && shownAc.has(s.acKey) }))] });
    }
  }
  // 変えた共通部品は、名前ごとに 1 回だけ、最初の領域の共通部品の artboard と代表の画面の元（主の幅）を出し、ほかの領域と読む画面は数で示す。
  // 代表がこのチケットの画面の節にもう出ていれば、代表の画像は繰り返さない
  const galleryFiles = new Set(gallery.flatMap((g) => [g.base?.file, ...g.rest.map((r) => r.s.file)]).filter(Boolean));
  const partGroups = groupParts(parts).map((g) => {
    const first = g.parts[0];
    const rep = first.rep.find((s) => s.main) ?? null;
    const others = [...new Set(g.parts.slice(1).map(partAreaName).filter(Boolean))];
    const readers = g.parts.reduce((n, p) => n + p.readers.length, 0);
    const note = `この部品を読む画面（画面の元と画面例）は ${readers} 枚あり、${rep ? `代表の 1 枚「${rep.title}」` : "代表の画面はまだ無く、部品だけ"}を見せています。${others.length ? `${others.map((n) => `「${n}」`).join("、")}にも同じ部品があり、同じに変わります。` : ""}`;
    return { name: g.name, first, label: g.change === "added" ? "新しい部品" : "変わる部品", rep: rep && !galleryFiles.has(rep.file) ? rep : null, note };
  });
  const hasScreens = gallery.length > 0 || partGroups.length > 0;   // 画面の節があるか（キャンバスの知らせを置く所）
  const freeChanges = d.changes.filter(free);
  // 領域は、問いの所に回した変更しか無くても挙げる（「あと N つ」で、提案があることを下書きの側でも分かるように）
  const areas = [...new Set(d.changes.map((c) => c.area).filter((a) => a && !isBase(a)))].sort();
  // 領域ごとの、問いの所に回した要件の数（要件と具体例の節に「あと N つ」と添える）
  const proposedIn = (area) => groupRules(d.changes.filter((c) => c.area === area && !free(c))).filter((b) => b.type === "rule").length;
  const shared = freeChanges.filter((c) => ["_intent", "_shared"].includes(c.area));
  const techAc = freeChanges.filter((c) => c.kind === "AC" && c.area === "_tech");
  // 基盤の受入条件は観点ごとにまとめる。人と CI が確認するものを開いて先に、テストで確認するもの（作りの細部）は畳む
  const aspectLabel = { commands: "検証のコマンドが動く", "test-levels": "テストが成功と失敗を正しく出す", "design-tokens": "コードの見た目の値がデザインシステムと同じ", "design-base": "コードの土台の CSS がデザインシステムと同じ", "test-report": "テストの結果を決めた形で出す", errors: "想定外の失敗でもエラーの詳細を外に出さない",
    structure: "ファイルの構成と設定が決めた技術どおり", "dev-env": "開発環境を作れる", "write-scopes": "作る役がテストを変えられない", ci: "PR で検証が走る", deploy: "デプロイの仕組みが動く", "visual-regression": "見た目の回帰テストが変化を見つける" };
  // 誰が確認するかで先に分ける（人、CI、AI のテスト）。AI のテストで確認するものは畳む
  const whoGroups = [["human", "あなたが確認するもの"], ["ci", "CI が確認するもの"]];
  const acOf = (c) => c.after ?? c.before;
  const byAspect = (cs) => [...new Set(cs.map((c) => acOf(c).aspect ?? ""))].map((a) => ({ label: aspectLabel[a] ?? a, cs: cs.filter((c) => (acOf(c).aspect ?? "") === a) }));
  const techFolded = techAc.filter((c) => !["human", "ci"].includes(acOf(c).checked_by));
  const folded = freeChanges.filter((c) => c.kind === "TECH" && c.change !== "removed" && !c.after.alternatives);
  const techGone = freeChanges.filter((c) => c.kind === "TECH" && c.change === "removed");
  const rows = freeChanges.filter((c) => ["TICKET", "LATER"].includes(c.kind));
  // 全部の行が並ぶのは一覧を作る 000 だけ。ほかのチケットでは、自分の行（/aidd-new で足した）と、変えたほかのチケットの行に分けて見出しを付ける
  const rowGroups = ticket.startsWith("000-") ? [{ id: "tickets", title: "チケットの一覧", cs: rows }]
    : [{ id: "this-ticket", title: "このチケット", cs: rows.filter((c) => c.key === `TICKET/${ticket}`) }, { id: "tickets", title: "内容が変わるチケット", cs: rows.filter((c) => c.key !== `TICKET/${ticket}`) }].filter((g) => g.cs.length);
  // デザインシステムの値と正本（tokens.css、base.css）は「確認してほしいこと」の見た目で見せる
  const docs = d.files.tech_docs.filter((f) => f !== DESIGN_FILE && !f.startsWith(DS_DIR));
  // 使う人と範囲のカード：項目（使う人、できること、作らないもの）ごとに、{ group, text, mark } の並び。
  // scope.includes は使う人ごとの主な操作（overall-hearing）なので「できること」と呼び、「<使う人>：<すること>」は使う人ごとにまとめる（group）。前があって変わったものは、mark に足す（added）か無くなる（removed）
  const userText = (u) => (u.description ? `${u.name}：${u.description}` : u.name);
  const scopeLines = (before, after, hasBefore) => {
    const names = after.users.map((u) => u.name);
    const split = (t) => { const m = String(t).match(/^(.+?)：(.+)$/); return m && names.includes(m[1]) ? { group: m[1], text: m[2] } : { group: null, text: String(t) }; };
    const marked = (b, a, grouped) => {
      const rows = [...a.map((t) => ({ t, mark: hasBefore && !b.includes(t) ? "added" : null, kept: hasBefore && b.includes(t) })), ...b.filter((t) => !a.includes(t)).map((t) => ({ t, mark: "removed" }))];
      // 使う人ごとのまとまりは使う人の順に先に、使う人の名前の付かないものは後ろに
      const rank = (x) => (x.group === null ? names.length : names.indexOf(x.group));
      return rows.map(({ t, mark, kept }) => ({ ...(grouped ? split(t) : { group: null, text: t }), mark, kept: !!kept })).sort((x, y) => rank(x) - rank(y));
    };
    const lines = [
      { k: "使う人", rows: marked(before.users.map(userText), after.users.map(userText), false) },
      { k: "できること", rows: marked(before.scope.includes ?? [], after.scope.includes ?? [], true) },
      { k: "作らないもの", rows: laterKept(marked(before.scope.excludes ?? [], after.scope.excludes ?? [], false)) },
    ].filter((x) => x.rows.length);
    return lines.length ? lines : null;
  };
  // 作らないもののうち後のチケットで作る行（「007-session-change で作る」）は、線で消さない。言い直しただけなら新しい文だけを
  // 「言い直した」として残し、外しただけなら「このチケットでは作らない」と書く（線で消すと後でも作らないように読める）
  function laterKept(rows) {
    // 後のチケットの番号。このチケット自身を指す行は、後のチケットの行として扱わない（外したなら、このチケットで作るので今のまま線で消す）
    const later = (t) => { const id = String(t).match(/(\d{3})(?:-[\w-]+)?\s*で作る/)?.[1] ?? null; return id === ticket.slice(0, 3) ? null : id; };
    const addedLater = new Set(rows.filter((r) => r.mark === "added" && later(r.text)).map((r) => later(r.text)));
    return rows.flatMap((r) => {
      const id = r.mark === "removed" ? later(r.text) : null;
      if (!id) return [r];
      if (addedLater.has(id)) return [];   // 同じチケットを指す新しい行がある：言い直し
      return [{ ...r, mark: "later" }];
    }).map((r) => (r.mark === "added" && later(r.text) && rows.some((x) => x.mark === "removed" && later(x.text) === later(r.text)) ? { ...r, mark: "reworded" } : r));
  }
  const intentLines = d.intent ? scopeLines(d.intent.before, d.intent.after, d.intent.before.users.length > 0) : null;
  // このチケットで作る範囲：ticket-plan.yaml の自分の行の範囲（000 と、一覧に行の無い 001 には出さない）。
  // 使う人は、できることの頭に名前が出る人だけを、intent.yaml の説明で出す（行から取り出したものなので印を付けない）。この回で行の範囲を変えたら、前の行と比較して印を付ける
  const ownRow = ticket.startsWith("000-") ? null : index.items.get(`TICKET/${ticket}`)?.item;
  const ticketScopeLines = ownRow ? (() => {
    const allUsers = readYaml(root, "specs/_current/_intent/intent.yaml")?.users ?? [];
    const users = allUsers.filter((u) => (ownRow.scope?.includes ?? []).some((t) => String(t).startsWith(`${u.name}：`)));
    const was = d.changes.find((c) => c.key === `TICKET/${ticket}` && c.change === "modified")?.before;
    return scopeLines({ users, scope: was?.scope ?? {} }, { users, scope: ownRow.scope ?? {} }, !!was);
  })() : null;
  const markText = { added: "（足す）", removed: "（無くなる）", reworded: "（言い直した）", later: "（このチケットでは作らない）" };

  // ---------- PR の本文（Markdown） ----------
  function buildMd() {
    const img = (rel, alt) => imageLine(root, rel, alt);
    const L = [`# ${title}（Gate 1：承認）`, ""];
    const S = [`# ${title}：Gate 1 の承認のページの要点`, ""];
    const both = (...xs) => { L.push(...xs); S.push(...xs); };
    both(`**目的**：${purpose}`, "");
    if (consult) {
      // 要点では、描き直した画面を画面ごとにまとめる（画面例の具体例の文は長いので、ページで見せる）
      const byTitle = [...new Set(consult.boards.map((x) => x.title))].map((t) => {
        const bs = consult.boards.filter((x) => x.title === t);
        const n = (f) => bs.filter(f).length;
        const what = [n((x) => !x.ac && !x.variant) && "開いたとき", n((x) => x.ac) && `画面例 ${n((x) => x.ac)} 枚`, n((x) => x.variant) && `モックだけの画面 ${n((x) => x.variant)} 枚`].filter(Boolean);
        return `${t}（${what.join("と")}）`;
      });
      const boardItems = [...consult.partShots.map(partLabel), ...byTitle];
      S.push("**画面の相談で直した所**", "", CONSULT_NOTE, "", ...(boardItems.length ? [`- 描き直した画面：${boardItems.join("、")}`] : []),
        ...consult.texts.map((r) => `- 文（${textsName(r)}の${r.where}）：${r.change === "added" ? `「${r.text}」を足す` : r.change === "removed" ? `「${r.before}」を消す` : `「${r.before}」を「${r.text}」に`}`), "");
      // 文の直しは開き、描き直した画面は畳む（相談で要件を直すと、描き直した画面例が数十枚になる）
      L.push("## 画面の相談で直した所", "", CONSULT_NOTE, "", ...(consult.texts.length ? textsMd(consult.texts, textsName) : []));
      if (boardItems.length) {
        L.push(`<details><summary>${consultShots}</summary>`, "");
        for (const p of consult.partShots) L.push(`#### ${partLabel(p)}`, "", img(`specs/${ticket}/results/mock/${p.file}`, partLabel(p)), "");
        for (const s of consult.boards) L.push(`#### ${boardLabel(s)}`, "", img(`specs/${ticket}/results/mock/${s.file}`, boardLabel(s)), "");
        L.push("</details>", "");
      }
    }
    if (affects.length) both("**今あるものへの影響**", "", ...affects.map((r) => `- ${affectLine(r)}`), "", affectsNote, "");
    else both(`**今あるものへの影響**：${noAffects}`, "");
    if (counts.length) both(`**このチケットで決めること**：${counts.map(([n, k, u]) => `${k} ${n} ${u}`).join("、")}`, "");
    for (const [c, area] of canvases) both(`キャンバス${canvases.length > 1 ? `「${area}」` : ""}（直接直したり、コメントを送ったりできます）：${c}`);
    // キャンバスは主に段 2 の相談で直すが、Gate 1 のページを見ている間も直せる。
    // 下書きとページでは、画面を見て直したくなる所（画面の節の頭）に置く。画面の節が無ければリンクの後
    if (canvases.length) { S.push("", CANVAS_NOTE, ""); L.push("", ...(hasScreens ? [] : [CANVAS_NOTE, ""])); }
    const exScreen = (c, pad) => {
      const ss = exampleBoards(c);
      if (ss.length) return ss.map((x) => `${pad}${img(`specs/${ticket}/results/mock/${x.file}`, "画面")}`);
      const rep = c.change !== "removed" && sameAs(c.key);
      return rep ? [`${pad}同じ画面：${rep.example?.then ?? rep.ac}`] : [];
    };
    const exLines = (c) => {
      if (c.change === "added") return [`  - ${exampleLine(c.after)}`, ...exScreen(c, "    ")];
      if (movedToShared(c)) return [`  - ${exampleLine(c.after)}（${MOVED}。結果は今のまま）`, ...exScreen(c, "    ")];
      if (c.change === "removed") return [`  - ~~${exampleLine(c.before)}~~（この具体例は無くなります）`];
      return [`  - 今：${exampleLine(c.before)}`, `  - 後：${exampleLine(c.after)}`, ...exScreen(c, "    ")];
    };
    // 答えた問いで決まったものは、最初の行の後ろに「（AI の提案。問い N の答えで決まった）」と添える
    const tag = (lines, c) => { const n = decidedBy(c); return n ? [`${lines[0]}（${decidedNote(n)}）`, ...lines.slice(1)] : lines; };
    const blocksMd = (blocks) => blocks.flatMap((b) => (b.type === "rule"
      ? [...tag(reqLine(b.req), byKey.get(b.req)), ...b.examples.flatMap((x) => (decidedBy(byKey.get(b.req)) && decidedBy(x) === decidedBy(byKey.get(b.req)) ? exLines(x) : tag(exLines(x), x)))]
      : tag(itemLine(b.c).split("\n"), b.c)));

    if (remaining.length) L.push("## 仕様のレビューで残った指摘", "", REMAINING_NOTE, "", ...remaining.map((f) => `- ${f.what}${f.scene ? `（場面：${f.scene}）` : ""}`), "");
    if (hardCount) {
      L.push("## 確認してほしいこと（後で変えにくいもの）", "");
      for (const c of hardTech) {
        const t = c.after;
        L.push(tag([`### ${t.summary}`], c)[0], "", `- なぜ決めるか：${t.background}`, `- 選んだ理由：${t.reason ?? ""}`);
        for (const a of t.alternatives) L.push(`- 選ばなかった案：${a.option}（${a.effect}）`);
        L.push(`- 後から変えるとき：${t.if_changed}`, "");
      }
      if (dsChanged && dsNow) {
        L.push("### 見た目（デザインシステム）", "", `- デザインシステム：${dsNow.url}`);
        if (!dsBefore) {
          if (dsNow.mood) L.push(`- 雰囲気：${dsNow.mood}`);
          L.push("- ライトモードとダークモードの見本：デザインシステムのページで見られます");
        } else {
          for (const v of dsDiff) L.push(`- ${v.name}　今：${v.before ?? "（無し）"}　後：${v.after ?? "（無し）"}`);
          if (dsBase.length) L.push("", BASE_NOTE, "", ...dsBase.map((l) => `- ${l.side}：${codeSpan(l.text)}`));
          for (const s of restyled) L.push("", `${s.title}（${RESTYLED}）`, "", img(`specs/${ticket}/results/mock/${s.file}`, s.title));
        }
        L.push("- 後から変えるとき：機能のチケットでも変えられます。変えると、その値を使うすべての画面の見た目が変わります", "");
      }
    }
    // このチケットで変わった行だけを開き、前からの行は畳む（前が無ければ、すべて開く）
    const scopeMd = (lines) => {
      const list = (xs) => {
        const out = [];
        const groups = [...new Set(xs.map((x) => x.group))];
        for (const g of groups) {
          const line = (x) => (x.mark === "removed" ? `~~${x.text}~~${markText.removed}` : `${x.text}${markText[x.mark] ?? ""}`);
          // 使う人の名前の付かないものは、使う人のまとまりがあれば「そのほか」の下にまとめる（HTML と同じ）
          if (g || groups.length > 1) out.push(`- ${g ?? "そのほか"}`, ...xs.filter((x) => x.group === g).map((x) => `  - ${line(x)}`));
          else out.push(...xs.map((x) => `- ${line(x)}`));
        }
        return out;
      };
      const kept = lines.flatMap(({ k, rows: xs }) => (xs.some((x) => x.kept) ? [`**${k}**`, "", ...list(xs.filter((x) => x.kept)), ""] : []));
      for (const { k, rows: xs } of lines) {
        const shown = xs.filter((x) => !x.kept);
        if (shown.length) L.push(`**${k}**`, "", ...list(shown), "");
      }
      if (kept.length) L.push("<details><summary>前からの行（このチケットでは変わりません）</summary>", "", ...kept, "</details>", "");
    };
    if (ticketScopeLines) {
      L.push("## このチケットで作る範囲", "");
      scopeMd(ticketScopeLines);
    }
    if (areas.length) {
      L.push("## 要件と具体例", "");
      for (const area of areas) {
        const n = proposedIn(area);
        L.push(`### ${areaHeading(index, area)}`, "", ...blocksMd(groupRules(freeChanges.filter((c) => c.area === area))), "");
        if (n) L.push(`（この領域には、まだ答えていない問いで決まる要件が、あと ${n} 個あります。「AI の提案と問い」で見られます）`, "");
      }
    }
    const items = (cs) => blocksMd(cs.map((c) => ({ type: "item", c })));
    if (shared.length) {
      L.push("## システム全体の目的、前提、共通の要件", "");
      for (const g of sharedGroups(shared)) {
        if (g.kind === "RULE") L.push(`**${g.label}**`, "", ...blocksMd(groupRules(g.cs, asSharedRule)), "");
        else if (g.label) L.push(`**${g.label}**`, "", ...g.cs.map((c) => tag([c.change === "removed" ? `- ~~${sharedText(c, c.before)}~~（無くなります）` : c.change === "modified" ? `- 今：${sharedText(c, c.before)}　後：${sharedText(c, c.after)}` : `- ${sharedText(c, c.after)}`], c)[0]), "");
        else L.push(...blocksMd(groupRules(g.cs)), "");
      }
    }
    if (intentLines) {
      L.push("## 使う人と範囲", "");
      scopeMd(intentLines);
    }
    for (const g of rowGroups) L.push(`## ${g.title}`, "", ...items(g.cs), "");
    if (techAc.length) {
      const groupsMd = (cs) => byAspect(cs).flatMap((g) => [`**${g.label}**`, "", ...g.cs.flatMap((c) => tag(itemLine(c).split("\n"), c)), ""]);
      L.push("## 基盤の受入条件", "");
      for (const [who, label] of whoGroups) { const cs = techAc.filter((c) => acOf(c).checked_by === who); if (cs.length) L.push(`### ${label}`, "", ...cs.flatMap((c) => tag(itemLine(c).split("\n"), c)), ""); }
      if (techFolded.length) L.push(`<details><summary>AI がテストで確認するもの（${techFolded.length} 件）</summary>`, "", ...groupsMd(techFolded), "</details>", "");
    }
    if (questions.length) {
      L.push("## AI の提案と問い", "");
      questions.forEach((q, i) => {
        L.push(`### 問い ${i + 1}：${q.question}`, "");
        if (answered(q) && !(q.options ?? []).some((o) => o.label === q.answer)) L.push(`**答え**：${q.answer}`, "");
        for (const o of q.options ?? []) L.push(`- ${o.label}${[o.label === q.proposal && "提案", answered(q) && o.label === q.answer && "答え"].filter(Boolean).map((x) => `（${x}）`).join("")}：${o.effect ?? ""}`);
        if (q.options?.length) L.push("");
        if (q.reason) L.push(`提案の理由：${q.reason}`, "");
        const cs = mine(i);
        if (cs.length) L.push("AI が提案している要件と具体例：", "", ...blocksMd(groupRules(cs)), "");
        if (decidedQs[i]) L.push(`この答えで決まった要件と具体例は、要件と具体例の節に「問い ${i + 1} の答えで決まった」と添えて載せています。`, "");
      });
    }
    if (gallery.length || partGroups.length) {
      L.push("## 画面", "");
      if (canvases.length) L.push(CANVAS_NOTE, "");
      for (const g of gallery) {
        L.push(`### ${g.name}（${g.label}）`, "");
        if (g.base) L.push(img(`specs/${ticket}/results/mock/${g.base.file}`, g.name), "");
        for (const r of g.rest) L.push(`#### ${r.text}`, "", img(`specs/${ticket}/results/mock/${r.s.file}`, `${g.name}：${r.text}`), "");
      }
      for (const g of partGroups) {
        L.push(`### 共通部品「${g.name}」（${g.label}）`, "", g.note, "", img(`specs/${ticket}/results/mock/${g.first.file}`, `共通部品「${g.name}」`), "");
        if (g.rep) L.push(`#### ${g.rep.title}（代表の画面）`, "", img(`specs/${ticket}/results/mock/${g.rep.file}`, g.rep.title), "");
      }
    }
    if (textsRows.length) {
      L.push("## 画面の文", "", ...textsMd(textsOpen, textsName));
      if (textsFolded.length) L.push(`<details><summary>${textsFoldedLabel}</summary>`, "", ...textsMd(textsFolded, textsName), "</details>", "");
    }
    if (folded.length) L.push("<details><summary>ほかの技術の選択（" + folded.length + " 件。後から変えても手間が小さいものです）</summary>", "", ...items(folded).map((l) => l.replace("- 技術の選択：", "- ")), "", "</details>", "");
    if (techGone.length) L.push(...items(techGone), "");
    if (docs.length) L.push("## 技術文書の変更", "", ...docs.map((f) => `- ${f.split("/").pop()}`), "");
    // 要点：冒頭と、問いの数、ページの場所だけ（要件と具体例、問いの中身はページで見る）
    if (questions.length) S.push("AI が提案した要件と具体例は、問いと一緒にページの「AI の提案と問い」で見られます。", "");
    S.push(status?.pr && repo ? `全文と画面の画像は PR にもあります：https://github.com/${repo}/pull/${status.pr}` : "全文と画面の画像は PR にもあります", "");
    return { L, S };
  }

  const md = buildMd();
  const htmlDir = path.dirname(out);
  mkdirSync(htmlDir, { recursive: true });
  // 仕様の全体のページ（同じフォルダ。相対のリンクで指す）。作れなくても承認のページは作る
  const BOOK = "spec-book.html";
  const book = tryWriteSpecBook(root, path.join(htmlDir, BOOK), { ticket }, "承認のページ");
  writeFileSync(out, clean(md.L));
  const html = path.join(htmlDir, "approval-draft.html");
  writeFileSync(html, buildHtml());
  const summary = path.join(htmlDir, "approval-summary.md");
  writeFileSync(summary, clean(md.S));
  console.log(`Gate 1 の承認のページを書きました：${path.relative(root, out)}`);
  console.log(`手元のページを書きました：${path.relative(root, html)}`);
  console.log(`要点を書きました：${path.relative(root, summary)}`);

  // ---------- 手元のページ（HTML。PR の本文と同じ中身を、カード、表、画像の並びで見せる。PNG は相対パスで指す） ----------
  function buildHtml() {
    const e = esc;
    const inline = (s) => e(s).replace(/(https?:\/\/[^\s<）]+)/g, '<a href="$1">$1</a>').replace(/~~([^~]+)~~/g, "<del>$1</del>");
    const shot = (file, alt) => shotOf(root, htmlDir, `specs/${ticket}/results/mock/${file}`, alt, "の画像はまだありません");
    // ラベル：要件と具体例の節では変わり方を、AI の提案と問いの節では「AI の提案」を先に書く
    const chip = (kind, text, ai) => `<span class="chip ${ai ? "hot" : kind}">${ai ? `AI の提案（${text}）` : text}</span>`;
    // 答えた問いで決まったもののラベル（その問いへ飛べる）
    const decChip = (c) => { const n = decidedBy(c); return n ? `<a class="chip dec" href="#q${n}">${decidedNote(n)}</a>` : ""; };
    // 新しい要件の下の具体例は、どれも新しいので「具体例」とだけ付ける（要件のラベルで分かる）
    const exHtml = (c, ai, underNew = false, dec = "") => {
      // 画面例は主の幅の 1 枚だけを置く（もう一方の幅は「画面」の節）
      const ss = exampleBoards(c);
      const s = ss[0] ?? null;
      const rep = !s && c.change !== "removed" ? sameAs(c.key) : null;
      const pic = s ? shot(s.file, "画面") : rep ? `<div><p class="aux">同じ画面：${e(rep.example?.then ?? rep.ac)}</p>${shot(rep.file, "同じ画面")}</div>` : "";
      if (c.change === "added") return `<div class="ex"><div class="ex-text"><div class="tags">${underNew ? chip("", "具体例") : chip("ok", "新しい具体例", ai)}${dec}</div>${gwt(c.after)}</div>${pic}</div>`;
      if (c.change === "removed") return `<div class="ex gone"><div class="ex-text"><div class="tags">${chip("bad", "無くなる具体例", ai)}${dec}</div><del>${gwt(c.before)}</del></div></div>`;
      if (movedToShared(c)) return `<div class="ex"><div class="ex-text"><div class="tags">${chip("", MOVED, ai)}${dec}</div>${gwt(c.after)}</div>${pic}</div>`;
      return `<div class="ex"><div class="ex-text"><div class="tags">${chip("warn", "変わる具体例", ai)}${dec}</div><div class="was"><div class="lbl">今まで</div>${gwt(c.before)}</div><div class="now"><div class="lbl">これから</div>${gwt(c.after)}</div></div>${pic}</div>`;
    };
    const blocksHtml = (blocks, ai = false) => blocks.map((b) => {
      if (b.type === "rule") {
        const c = byKey.get(b.req);
        const dec = decChip(c);
        let head;
        if (c?.change === "removed") head = `<div class="tags">${chip("bad", "無くなる要件", ai)}${dec}</div><p class="stmt"><del>${e(c.before.statement)}</del></p>`;
        else if (c?.change === "modified" && c.before.statement !== c.after.statement) head = `<div class="tags">${chip("warn", "変わる要件", ai)}${dec}</div><div class="was"><div class="lbl">今まで</div><p class="stmt">${e(c.before.statement)}</p></div><div class="now"><div class="lbl">これから</div><p class="stmt">${e(c.after.statement)}</p></div>`;
        else head = `<div class="tags">${c?.change === "added" ? chip("ok", "新しい要件", ai) : chip("", b.examples.length ? "要件は今のまま（具体例が変わる）" : "要件は今のまま", ai)}${dec}</div><p class="stmt">${e(index.items.get(b.req)?.item?.statement ?? c?.before?.statement ?? b.req)}</p>`;
        return `<div class="rule${ai ? " proposed" : ""}"><div class="rule-head">${head}</div>${b.examples.map((x) => exHtml(x, ai, c?.change === "added", decidedBy(x) !== decidedBy(c) ? decChip(x) : "")).join("")}</div>`;
      }
      return `<div class="item${ai ? " proposed" : ""}"><div class="txt">${inline(itemLine(b.c).replace(/^- /, "")).replace(/\n\s*/g, "<br>")}</div>${ai ? '<span class="chip hot">AI の提案</span>' : decChip(b.c)}</div>`;
    }).join("");

    // 影響の行。要件の行は、変わることだけを出し、もとの要件の全文を行の下に畳む。要件が今の仕様にあれば、仕様の全体のページのその要件へリンクする
    const ba = (r) => (r.before_after ? `<br><span class="aux">${e(r.before_after)}</span>` : "");
    const affectHtml = (r) => {
      if (!isReqRow(r)) return `<li><b>${e(r.name)}</b>：${e(r.reason)}${ba(r)}</li>`;
      const link = book && r.key && index.items.has(r.key) ? `<p><a href="${BOOK}#${anchorOf(r.key)}" target="_blank">仕様の全体で、この要件を読む ↗</a></p>` : "";
      return `<li>${e(r.reason)}${ba(r)}<details class="orig"><summary>もとの要件</summary><p>${e(r.name)}</p>${link}</details></li>`;
    };
    const H = [];
    // 変わる画面の数は、画面の節があるときだけ、その節へのリンクにする（画面例がすべて要件と具体例の横に出ると、画面の節は無い）
    H.push(`<header class="top"><div class="eyebrow">Gate 1：承認</div><h1>${e(title)}</h1><p class="lede">${e(purpose)}</p>`,
      `<div class="stats">${questions.length ? `<a class="stat${open ? " hot" : ""}" href="#proposals"><b>${questions.length}</b><span>問い</span></a>` : ""}`,
      `${hardCount ? `<a class="stat" href="#check"><b>${hardCount}</b><span>後で変えにくいもの</span></a>` : ""}${screenCount ? (hasScreens ? `<a class="stat" href="#screens"><b>${screenCount}</b><span>変わる画面</span></a>` : `<div class="stat"><b>${screenCount}</b><span>変わる画面</span></div>`) : ""}`,
      `<div class="stat"><b class="${affects.length ? "aff-some" : "aff-none"}">${affects.length}</b><span>今あるものへの影響</span></div></div>`,
      `<div class="why"><b>今あるものへの影響</b>${affects.length ? `<ul>${affects.map(affectHtml).join("")}</ul><p>${affectsNote}</p>` : `<p>${noAffects}</p>`}</div>`);
    if (book || canvases.length || (status?.pr && repo)) {
      H.push(`<div class="links">`);
      // リンクは、何を開くかの見出しと、下線付きの「開く」で、押せることが分かる形にする
      if (book) H.push(`<a class="golink" href="${BOOK}" target="_blank"><span class="gk">仕様の全体</span><span class="go">仕様の全体を読む ↗</span></a>`);
      for (const [c, area] of canvases) H.push(`<a class="golink" href="${e(c)}" target="_blank"><span class="gk">画面のキャンバス${canvases.length > 1 ? `（${e(area)}）` : ""}</span><span class="go">キャンバスを開く ↗</span></a>`);
      if (status?.pr && repo) H.push(`<a class="golink" href="https://github.com/${e(repo)}/pull/${e(status.pr)}" target="_blank"><span class="gk">GitHub の PR #${e(status.pr)}</span><span class="go">PR を開く ↗</span></a>`);
      H.push(`</div>`);
    }
    if (canvases.length && !hasScreens) H.push(`<p class="note">${e(CANVAS_NOTE)}</p>`);
    H.push(`</header>`);
    const nav = [];
    const sec = (id, t, body) => { nav.push([id, t]); return `<section id="${id}"><h2>${t}</h2>${body}</section>`; };
    const B = [];
    const items = (cs) => blocksHtml(cs.map((c) => ({ type: "item", c })));
    // 画面の相談で直した所は、最初の節にする（要点の先頭）
    if (consult) B.push(sec("consult", "画面の相談で直した所", `<p class="note">${e(CONSULT_NOTE)}</p>${consult.texts.length ? textsHtml(consult.texts, textsName, e) : ""}`
      + (consult.partShots.length || consult.boards.length ? `<details><summary>${e(consultShots)}</summary><div class="gallery">${[...consult.partShots.map((p) => `<figure>${shot(p.file, partLabel(p))}<figcaption>${e(partLabel(p))}</figcaption></figure>`),
        ...consult.boards.map((s) => `<figure>${shot(s.file, boardLabel(s))}<figcaption>${e(boardLabel(s))}</figcaption></figure>`)].join("")}</div></details>` : "")));
    // このチケットで変わった行だけを開き、前からの行は畳む（前が無ければ、すべて開く）
    const scopeHtml = (lines) => {
      const open = lines.map(({ k, rows }) => ({ k, rows: rows.filter((x) => !x.kept) })).filter((x) => x.rows.length);
      const kept = lines.map(({ k, rows }) => ({ k, rows: rows.filter((x) => x.kept) })).filter((x) => x.rows.length);
      return `${open.length ? scopeCards(open) : ""}${kept.length ? `<details><summary>前からの行（このチケットでは変わりません）</summary>${scopeCards(kept)}</details>` : ""}`;
    };
    const scopeCards = (lines) => `<div class="scope-cards">${lines.map(({ k, rows: xs }) => {
      // 使う人は「名前：説明」の名前を太字にする
      const text = (x) => (k === "使う人" && x.text.includes("：") ? `<b>${e(x.text.slice(0, x.text.indexOf("：")))}</b>：${e(x.text.slice(x.text.indexOf("：") + 1))}` : e(x.text));
      const chipOf = { added: ["ok", "足す"], removed: ["bad", "無くなる"], reworded: ["", "言い直した"], later: ["", "このチケットでは作らない"] };
      const li = (x) => `<li${x.mark ? ` class="${x.mark}"` : ""}>${x.mark === "removed" ? `<del>${text(x)}</del>` : text(x)}${x.mark ? `<span class="chip ${chipOf[x.mark][0]}">${chipOf[x.mark][1]}</span>` : ""}</li>`;
      const groups = [...new Set(xs.map((x) => x.group))];
      const cls = { 使う人: "users", できること: "inc", 作らないもの: "exc" }[k];
      return `<div class="sc ${cls}"><h3>${k}</h3><ul>${groups.map((g) => (g ? `<li class="grp"><b>${e(g)}</b><ul>${xs.filter((x) => x.group === g).map(li).join("")}</ul></li>`
        : groups.length > 1 ? `<li class="grp"><b>そのほか</b><ul>${xs.filter((x) => !x.group).map(li).join("")}</ul></li>` : xs.filter((x) => !x.group).map(li).join(""))).join("")}</ul></div>`;
    }).join("")}</div>`;
    if (remaining.length) B.push(sec("remaining", "仕様のレビューで残った指摘", `<p class="note">${e(REMAINING_NOTE)}</p><div class="cards">${remaining.map((f) => `<div class="item"><div class="txt"><p>${e(f.what)}</p>${f.scene ? `<p class="aux">場面：${e(f.scene)}</p>` : ""}</div><span class="chip warn">直していない</span></div>`).join("")}</div>`));
    if (hardCount) {
      const parts = hardTech.map((c) => {
        const t = c.after;
        return `<article class="card"><h3>${e(t.summary)} ${decChip(c)}</h3><dl class="kv"><dt>なぜ決めるか</dt><dd>${e(t.background)}</dd><dt>選んだ理由</dt><dd>${e(t.reason ?? "")}</dd>${t.alternatives.map((a) => `<dt>選ばなかった案</dt><dd>${e(a.option)}（${e(a.effect)}）</dd>`).join("")}<dt>後から変えるとき</dt><dd>${e(t.if_changed)}</dd></dl></article>`;
      });
      if (dsChanged && dsNow) {
        let ds = `<article class="card"><h3>見た目（デザインシステム）</h3><p><a href="${e(dsNow.url)}">デザインシステムを開く</a></p>`;
        if (!dsBefore) ds += `${dsNow.mood ? `<div class="callout"><b>雰囲気</b><p>${e(dsNow.mood)}</p></div>` : ""}<p class="note">ライトモードとダークモードの見本は、デザインシステムのページで見られます。</p>`;
        else {
          if (dsDiff.length) ds += `<div class="table-wrap"><table><thead><tr><th>値の名前</th><th>今</th><th>後</th></tr></thead><tbody>${dsDiff.map((v) => `<tr><td>${e(v.name)}</td><td>${swatch(v.before)}</td><td>${swatch(v.after)}</td></tr>`).join("")}</tbody></table></div>`;
          if (dsBase.length) ds += `<div class="sub">${e(BASE_CSS_LABEL)}</div>${rawList(dsBase)}`;
          if (restyled.length) ds += `<div class="sub">${e(RESTYLED)}</div><div class="gallery">${restyled.map((s) => `<figure>${shot(s.file, s.title)}<figcaption>${e(s.title)}</figcaption></figure>`).join("")}</div>`;
        }
        parts.push(ds + `<p class="note">後から変えるとき：機能のチケットでも変えられます。変えると、その値を使うすべての画面の見た目が変わります。</p></article>`);
      }
      B.push(sec("check", "確認してほしいこと", `<p class="note">後から変えると手間が大きいものです。選んだ案で良ければ、何もしなくて構いません。</p>${parts.join("")}`));
    }
    if (ticketScopeLines) B.push(sec("ticket-scope", "このチケットで作る範囲", scopeHtml(ticketScopeLines)));
    if (areas.length) B.push(sec("rules", "要件と具体例", `<p class="note">あなたと話したことから、AI が書いた仕様です。話したことと合っているかを見てください。${open ? "AI が自分で提案した要件のうち、まだ答えていない問いで決まるものは、「AI の提案と問い」に分けています。" : ""}</p>` + areas.map((a) => {
      const n = proposedIn(a);
      return `<h3>${e(areaHeading(index, a))}</h3>${blocksHtml(groupRules(freeChanges.filter((c) => c.area === a)))}${n ? `<p class="more"><a href="#proposals">この領域には、まだ答えていない問いで決まる要件が、あと ${n} 個あります（「AI の提案と問い」で見られます）</a></p>` : ""}`;
    }).join("")));
    // 共通の要件の 1 件：種類の名前を外した中身。目的は実現の目安、用語は名前を分けて見せる。変えたものは今までとこれから
    const sharedBody = (c, x) => (c.kind === "GOAL" ? `<p>${e(x.statement)}</p><p class="aux"><span class="lbl">実現の目安</span>${e(x.success)}</p>`
      : c.kind === "TERM" ? `<p><b>${e(x.name)}</b>：${e(x.definition)}</p>` : `<p>${e(x.statement)}</p>`);
    const sharedCard = (c) => {
      const body = c.change === "removed" ? `<del>${sharedBody(c, c.before)}</del>`
        : c.change === "modified" ? `<div class="was"><div class="lbl">今まで</div>${sharedBody(c, c.before)}</div><div class="now"><div class="lbl">これから</div>${sharedBody(c, c.after)}</div>`
        : sharedBody(c, c.after);
      return `<div class="item card2${c.change === "removed" ? " gone" : ""}"><div class="txt">${body}</div>${decChip(c)}</div>`;
    };
    if (shared.length) B.push(sec("shared", "システム全体の目的、前提、共通の要件", sharedGroups(shared).map((g) => (g.kind === "RULE"
      ? `<div class="kgroup"><h3>${g.label}</h3>${blocksHtml(groupRules(g.cs, asSharedRule))}</div>`
      : g.label
      ? `<div class="kgroup"><h3>${g.label}</h3><div class="cards">${g.cs.map(sharedCard).join("")}</div></div>`
      : blocksHtml(groupRules(g.cs)))).join("")));
    if (intentLines) B.push(sec("intent", "使う人と範囲", scopeHtml(intentLines)));
    // チケットの 1 件：名前、目的、先に要るチケット（名前で）。後のチケットに回すものは理由
    const ticketBody = (x, kind) => (kind === "LATER" ? `<b>${e(x.title)}</b><p>${e(x.reason)}</p>`
      : `<span class="tid">${e(x.id)}</span><b>${e(x.title)}</b><p>${e(x.purpose)}</p>${x.depends_on?.length ? `<div class="tags"><span class="lbl">先に</span>${directDeps(x.depends_on).map((id) => `<span class="chip">${e(ticketTitle(id))}</span>`).join("")}</div>` : ""}`);
    const ticketCard = (c) => {
      const body = c.change === "removed" ? `<del>${ticketBody(c.before, c.kind)}</del>`
        : c.change === "modified" && ticketRow(c.before, c.kind) === ticketRow(c.after, c.kind) ? `${ticketBody(c.after, c.kind)}<p class="aux">${e(scopeNote(c.before, c.after))}</p>`
        : c.change === "modified" ? `<div class="was"><div class="lbl">今まで</div>${ticketBody(c.before, c.kind)}</div><div class="now"><div class="lbl">これから</div>${ticketBody(c.after, c.kind)}</div>`
        : ticketBody(c.after, c.kind);
      return `<div class="item tcard${c.change === "removed" ? " gone" : ""}"><div class="txt">${body}</div>${decChip(c)}</div>`;
    };
    for (const g of rowGroups) {
      const ticketRows = g.cs.filter((c) => c.kind === "TICKET"), laterRows = g.cs.filter((c) => c.kind === "LATER");
      B.push(sec(g.id, g.title, `${ticketRows.length ? `<div class="cards tickets">${ticketRows.map(ticketCard).join("")}</div>` : ""}${laterRows.length ? `<h3>後のチケットに回すもの</h3><div class="cards tickets">${laterRows.map(ticketCard).join("")}</div>` : ""}`));
    }
    // 基盤の受入条件の 1 件：前提、すること、結果の枠と、誰が確認するか
    const techCard = (c) => {
      const tags = `<div class="tags">${c.change === "removed" ? chip("bad", "無くなる") : c.change === "modified" ? chip("warn", "変わる") : ""}${decChip(c)}</div>`;
      if (c.change === "removed") return `<div class="ex solo gone"><div class="ex-text">${tags}<del>${gwt(c.before)}</del></div></div>`;
      if (c.change === "modified") return `<div class="ex solo"><div class="ex-text">${tags}<div class="was"><div class="lbl">今まで</div>${gwt(c.before)}</div><div class="now"><div class="lbl">これから</div>${gwt(c.after)}</div></div></div>`;
      return `<div class="ex solo"><div class="ex-text">${tags}${gwt(c.after)}</div></div>`;
    };
    const techGroups = (cs) => byAspect(cs).map((g) => `<div class="kgroup"><h4>${e(g.label)}</h4><div class="cards">${g.cs.map(techCard).join("")}</div></div>`).join("");
    // 開いて見せる側（人と CI）は数が少ないので、観点の小見出しを付けずにカードを並べる
    const whoHtml = whoGroups.map(([who, label]) => { const cs = techAc.filter((c) => acOf(c).checked_by === who); return cs.length ? `<div class="who"><h3>${label}</h3><div class="cards">${cs.map(techCard).join("")}</div></div>` : ""; }).join("");
    if (techAc.length) B.push(sec("techac", "基盤の受入条件", `<p class="note">技術の土台ができたことを、何で確認するかです。</p>${whoHtml}${techFolded.length ? `<details><summary>AI がテストで確認するもの（${techFolded.length} 件）</summary>${techGroups(techFolded)}</details>` : ""}`));
    if (questions.length) B.push(sec("proposals", "AI の提案と問い", `${questions.map((q, i) => {
      const cs = mine(i);
      const inOpts = (q.options ?? []).some((o) => o.label === q.answer);
      return `<article class="q" id="q${i + 1}"><div class="q-head"><span class="qno">問い ${i + 1}</span></div><h3>${e(q.question)}</h3>${answered(q) && !inOpts ? `<div class="callout ans"><b>答え</b><p>${e(q.answer)}</p></div>` : ""}`
        + (q.options?.length ? `<div class="opts">${q.options.map((o) => { const chosen = answered(q) && q.answer === o.label; return `<div class="opt${o.label === q.proposal ? " prop" : ""}${chosen ? " chosen" : ""}">${o.label === q.proposal || chosen ? `<div class="tags">${o.label === q.proposal ? '<span class="chip acc">提案</span>' : ""}${chosen ? '<span class="chip ok">答え</span>' : ""}</div>` : ""}<b>${e(o.label)}</b><p>${e(o.effect ?? "")}</p></div>`; }).join("")}</div>` : "")
        + (q.reason ? `<div class="callout"><b>提案の理由</b><p>${e(q.reason)}</p></div>` : "")
        + (cs.length ? `<div class="decides"><div class="sub">AI が提案している要件と具体例</div>${blocksHtml(groupRules(cs), true)}</div>` : "")
        + (decidedQs[i] ? `<p class="more">この答えで決まった要件と具体例は、要件と具体例の節に「問い ${i + 1} の答えで決まった」のラベルを付けて載せています。</p>` : "")
        + `</article>`;
    }).join("")}`));
    // 画面の節の頭に、キャンバスを今も直せることと、キャンバスへのリンクを置く
    const canvasLead = canvases.length ? `<p class="note">${e(CANVAS_NOTE)}</p><p class="note">${canvases.map(([c, area]) => `<a href="${e(c)}" target="_blank">キャンバス${canvases.length > 1 ? `（${e(area)}）` : ""}を開く ↗</a>`).join("　")}</p>` : "";
    if (gallery.length || partGroups.length) B.push(sec("screens", "画面", `${canvasLead}<p class="note">このチケットで足す新しい画面と変わる画面を、開いたときの姿で並べています。前のチケットで描いた画面例を、今回の変更に合わせて描き直したものと、要件と具体例の横に置いていない幅の画面例も、ここに並べます。</p><div class="gallery">${gallery.flatMap((g) => [
      ...(g.base ? [`<figure>${shot(g.base.file, g.name)}<figcaption><b>${e(g.name)}</b>　<span class="chip ${g.base.change === "added" ? "ok" : "warn"}">${g.label}</span><br>開いたときの画面（${e(g.base.area)}）</figcaption></figure>`] : []),
      ...g.rest.map((r) => `<figure>${shot(r.s.file, `${g.name}：${r.text}`)}<figcaption><b>${e(g.name)}</b>　${r.s.variant ? '<span class="chip">モックだけの画面</span>' : !r.s.ac ? `<span class="chip ${g.base?.change === "added" ? "ok" : "warn"}">${g.label}</span>` : r.other ? '<span class="chip">要件と具体例の画面例（ほかの幅）</span>' : '<span class="chip warn">前のチケットの画面例を描き直した</span>'}<br>${e(r.text)}</figcaption></figure>`)]).join("")}</div>`
      + partGroups.map((g) => `<h3>共通部品「${e(g.name)}」 <span class="chip ${g.label === "新しい部品" ? "ok" : "warn"}">${g.label}</span></h3><p class="note">${e(g.note)}</p><div class="gallery"><figure>${shot(g.first.file, `共通部品「${g.name}」`)}<figcaption>共通部品の artboard</figcaption></figure>${g.rep ? `<figure>${shot(g.rep.file, g.rep.title)}<figcaption>${e(g.rep.title)}（代表の画面）</figcaption></figure>` : ""}</div>`).join("")));
    if (textsRows.length) B.push(sec("texts", "画面の文", `<p class="note">このチケットで足した文と変えた文です。</p>${textsHtml(textsOpen, textsName, e)}${textsFolded.length ? `<details><summary>${textsFoldedLabel}</summary>${textsHtml(textsFolded, textsName, e)}</details>` : ""}`));
    const misc = [];
    if (folded.length) misc.push(`<details><summary>ほかの技術の選択（${folded.length} 件。後から変えても手間が小さいもの）</summary>${items(folded)}</details>`);
    if (techGone.length) misc.push(items(techGone));
    if (docs.length) misc.push(`<h3>技術文書の変更</h3><ul class="items">${docs.map((f) => `<li>${e(f.split("/").pop())}</li>`).join("")}</ul>`);
    if (misc.length) B.push(sec("misc", "そのほか", misc.join("")));
    H.push(`<nav class="tabs">${nav.map(([id, t]) => `<a href="#${id}">${t}</a>`).join("")}</nav>`, ...B);

    return page(`${title}（Gate 1：承認）`, H.join("\n"), DRAFT_CSS);
  }
} catch (e) {
  console.error(`Gate 1 の承認のページを作れませんでした（${e.message}）。`);
  process.exit(2);
}
