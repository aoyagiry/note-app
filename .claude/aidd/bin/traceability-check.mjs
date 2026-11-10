// 止める検査（目的の文書の「traceability-check とスキーマ検証」「baseline-check」）。プロダクトリードと CI が実行する。
// 見るのは 2 つだけ：具体例とテストの対応と、参照切れ。
//
// 使い方：node .claude/aidd/bin/traceability-check.mjs <ticket-id> --stage <段> [--out <パス>]
//         node .claude/aidd/bin/traceability-check.mjs --stage baseline        main 全体（CI）
// 段：
//   before-approval  Gate 1 の承認のページを見せる前。uses の指す先がある、具体例の ID が親の要件の名前に合う、どの要件にも具体例がある
//   approval         承認を記録するとき。before-approval に加えて、答えていない問いが無い
//   tests            テストを書いた後。どの具体例と、このチケットの test: true の計画の決め事にもテストがあり、テストが指す具体例と決め事がある
//   verify           Gate 2 の提出の前。tests と approval に加えて、具体例と決め事ごとの実行の結果（results/examples.json）があり、すべて通った
//   baseline         main 全体。参照切れ、どの要件にも具体例がある、どの具体例にもテストがある
// 違反があれば終了コード 1、判定できなければ 2。
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const STAGES = ["before-approval", "approval", "tests", "verify", "baseline"];
try {
  const stage = opt("--stage");
  if (!STAGES.includes(stage)) throw new Error(`--stage は ${STAGES.join("、")} のどれか`);
  const ticket = stage === "baseline" ? null : args[0];
  if (stage !== "baseline" && (!ticket || ticket.startsWith("--"))) throw new Error("チケットの ID を渡してください");
  const { resolveRoot } = await import(new URL("../lib/root.mjs", import.meta.url).href);
  const root = resolveRoot();
  const lib = (f) => import(pathToFileURL(path.join(root, ".claude/aidd/lib", f)).href);
  const { buildIndex, usesOf, examplesOf, needsTest, testRefs, idOf, isBase, parseYaml } = await lib("id-graph.mjs");
  const readYaml = (rel) => (existsSync(path.join(root, rel)) ? parseYaml(readFileSync(path.join(root, rel), "utf8"), rel) : null);

  const index = buildIndex(root);
  const v = [];
  const add = (kind, key, message) => v.push({ kind, key, message });
  const num = ticket?.slice(0, 3);

  // 参照切れ、具体例の ID、具体例の無い要件
  for (const e of index.items.values()) {
    for (const u of usesOf(e)) if (!index.items.has(u)) add("broken_ref", e.key, `${e.key} の uses が指す ${u} がありません。`);
    // 親の名前は、種類の頭（REQ-、RULE-）を外したもの（共通の要件の代表の具体例も AC-<共通の要件の名前>-<番号>）
    if (e.kind === "AC" && e.parent && !idOf(e.key).startsWith(`AC-${idOf(e.parent).replace(/^[A-Z]+-/, "")}-`)) {
      add("example_id", e.key, `${e.key} の ID が、親の要件 ${e.parent} の名前に合いません（AC-<要件の名前>-<番号>）。`);
    }
    if (e.kind === "REQ" && !isBase(e.area) && examplesOf(index, e.key).length === 0) add("no_example", e.key, `${e.key} に具体例がありません。`);
  }
  if (["approval", "verify"].includes(stage)) {
    for (const q of readYaml(`specs/${ticket}/hearing/questions.yaml`)?.questions ?? []) {
      if (q.answer === undefined || q.answer === null || q.answer === "") add("unanswered", q.id, `${q.id}「${q.question}」に答えがありません。`);
    }
  }
  // 具体例とテストの対応
  if (["tests", "verify", "baseline"].includes(stage)) {
    const refs = testRefs(root);
    const wanted = [...index.items.values()].filter((e) => needsTest(e) || (num && e.key.startsWith(`${num}/PD-`) && e.item?.test === true));
    for (const e of wanted) if (!refs.has(e.key)) add("no_test", e.key, `${e.key} を確認するテストがありません（テストの名前に ${e.key} を入れる）。`);
    for (const [k, where] of refs) if (!index.items.has(k)) add("stale_test", k, `テストが指す ${k} がありません（${where[0]}）。`);
    if (stage === "verify") {
      const results = readYaml(`specs/${ticket}/results/examples.json`)?.examples;
      if (!results) add("no_results", null, `specs/${ticket}/results/examples.json がありません。検証のスクリプトを流してください。`);
      else {
        for (const e of wanted) {
          const r = results[e.key]?.result;
          if (r !== "passed") add("result", e.key, `${e.key} のテストの結果が ${r ?? "missing"} です（通っていないか、実行されていない）。`);
        }
      }
    }
  }
  const out = { stage, ticket, result: v.length ? "failed" : "passed", violations: v };
  const text = JSON.stringify(out, null, 2) + "\n";
  if (opt("--out")) {
    mkdirSync(path.dirname(path.resolve(root, opt("--out"))), { recursive: true });
    writeFileSync(path.resolve(root, opt("--out")), text);
  }
  if (v.length) {
    console.error(`traceability-check（${stage}）：違反が ${v.length} 件あります。\n- ${v.map((x) => x.message).join("\n- ")}`);
    process.exit(1);
  }
  console.log(`traceability-check（${stage}）：違反はありません。`);
} catch (e) {
  console.error(`traceability-check を判定できませんでした（${e.message}）。`);
  process.exit(2);
}
