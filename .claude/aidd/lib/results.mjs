// 具体例と計画の決め事ごとの実行の結果。テストの機械が読める結果（JUnit XML）から作る。
// verify.mjs が使い、その出力（examples.json）を traceability-check（verify）と gate2-report が読む。
import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { buildIndex, needsTest, TEST_AC, TEST_PD } from "./id-graph.mjs";

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const attr = (attrs, name) => decode(attrs.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? "");

/** JUnit XML の testcase を { name, result } の配列にする。result は passed、failed、skipped のどれか。 */
export function parseJUnit(xml) {
  const out = [];
  for (const m of xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const body = m[2] ?? "";
    const result = /<(failure|error)\b/.test(body) ? "failed" : /<skipped\b/.test(body) ? "skipped" : "passed";
    out.push({ name: `${attr(m[1], "classname")} ${attr(m[1], "name")}`.trim(), result });
  }
  return out;
}

/**
 * 今のチケットで確認する具体例と計画の決め事ごとの結果。toolchain.yaml の test_reports の場所の JUnit XML を読む。
 * 戻り値は { reports: [ファイル], examples: { <キー>: { result: passed|failed|skipped|missing, tests: [名前] } } }。
 * missing は、その具体例を確認するテストが実行されていないこと（テストに名前があっても、結果に無ければ missing）。
 */
export function exampleResults(root, ticket) {
  const tc = YAML.parse(readFileSync(path.join(root, "specs/_current/_tech/toolchain.yaml"), "utf8")) ?? {};
  const reports = (tc.test_reports ?? []).flatMap((g) => globSync(g, { cwd: root })).sort();
  const cases = reports.flatMap((f) => parseJUnit(readFileSync(path.join(root, f), "utf8")));
  const num = ticket.slice(0, 3);
  const index = buildIndex(root);
  const keys = [...index.items.values()].filter((e) => needsTest(e) || (e.key.startsWith(`${num}/PD-`) && e.item?.test === true)).map((e) => e.key);
  const examples = Object.fromEntries(keys.map((k) => [k, { result: "missing", tests: [] }]));
  for (const c of cases) {
    const found = [...c.name.matchAll(TEST_AC)].map((m) => `${m[1]}/${m[2]}`).concat([...c.name.matchAll(TEST_PD)].map((m) => `${m[1]}/${m[2]}`));
    for (const k of found) {
      if (!examples[k]) continue;
      const e = examples[k];
      e.tests.push(`${c.name}（${c.result}）`);
      if (c.result === "failed" || e.result === "failed") e.result = "failed";
      else if (c.result === "passed") e.result = "passed";
      else if (e.result === "missing") e.result = "skipped";
    }
  }
  return { reports, examples };
}
