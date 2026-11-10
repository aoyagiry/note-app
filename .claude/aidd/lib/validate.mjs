// 成果物のスキーマ検証。validate-artifacts の hook と、プロダクトリードのコミット前の検証で共通に使う。
// ファイルの形の決め方：スクリプトが欄を読むか、ID でほかから指されるものは YAML（か JSON）にして、ここでスキーマを当てる。
// 人か AI が文として読むだけのもの（計画、Red の理由、壁打ちのメモ、_notes、下書き）は Markdown にする。
// スキーマで検査していることは YAML にする理由にしない（検査があるのは YAML だからなので）。新しいファイルを足すときもこれで決める。
// ライブラリ（yaml、ajv）が読めないときの扱いは呼び出し側が決める（validate-artifacts の hook を参照）。
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import Ajv2020 from "ajv/dist/2020.js";

const AIDD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_DIR = path.join(AIDD_DIR, "schemas");

const ajv = new Ajv2020({ allErrors: true, strict: false });
for (const f of readdirSync(SCHEMA_DIR).filter((f) => f.endsWith(".schema.json"))) {
  ajv.addSchema(JSON.parse(readFileSync(path.join(SCHEMA_DIR, f), "utf8")), f.replace(".schema.json", ""));
}

const CUR = "specs/_current/";
// 機械が読むファイルだけを検証する（目的の文書の「スキーマ検証」）
const SHARED = { "terms.yaml": "shared-terms", "rules.yaml": "shared-rules", "nfr.yaml": "nfr" };
const TECH = { "tech.yaml": "tech", "toolchain.yaml": "toolchain", "write-scopes.json": "write-scopes",
  "acceptance.yaml": "tech-acceptance", "harness.yaml": "harness", "design.yaml": "design-system", "texts.yaml": "texts" };
const TICKET = { "status.yaml": "status", "hearing/questions.yaml": "questions", "spec-changes.yaml": "spec-changes",
  "plan/details.yaml": "details", "screen-changes.yaml": "screen-changes" };

/** リポジトリのルートからの相対パス（/ 区切り）から、当てるスキーマの名前を返す。対象外なら null。 */
export function schemaFor(rel) {
  const p = rel.split(path.sep).join("/");
  if (p === ".claude/aidd/defaults.yaml") return "harness";
  if (p === "specs/ticket-plan.yaml") return "ticket-plan";
  if (p.startsWith(CUR)) {
    const rest = p.slice(CUR.length).split("/");
    if (rest[0] === "_intent") return rest.join("/") === "_intent/intent.yaml" ? "system-intent" : null;
    if (rest[0] === "_shared") return rest.length === 2 && /\.ya?ml$/.test(rest[1]) ? SHARED[rest[1]] ?? "unknown-shared" : null;
    if (rest[0] === "_tech") return rest.length === 2 ? TECH[rest[1]] ?? null : null;
    // 領域（<領域>/requirements.yaml）と流れの領域（journeys/<流れ>/requirements.yaml）。画面のある領域は mock/canvas.yaml も
    const depth = rest[0] === "journeys" ? 3 : 2;
    if (rest.length === depth + 1 && rest.slice(depth - 1).join("/") === "mock/canvas.yaml") return "canvas";
    // 画面文の一覧（領域だけ。流れの領域には置かない）
    if (rest.length === 2 && rest[0] !== "journeys" && rest[1] === "texts.yaml") return "texts";
    return rest.length === depth && rest[depth - 1] === "requirements.yaml" ? "requirements" : null;
  }
  const m = p.match(/^specs\/\d{3}-[^/]+\/(.+)$/);
  if (!m) return null;
  if (TICKET[m[1]]) return TICKET[m[1]];
  if (/^reviews\/[a-z-]+\/\d{2,}-c\d+\.yaml$/.test(m[1])) return "review";
  return null;
}

function parse(file) {
  const text = readFileSync(file, "utf8");
  return file.endsWith(".json") ? JSON.parse(text) : YAML.parse(text);
}

/**
 * 1 ファイルを検証し、違反の配列を返す（空なら合格）。
 */
export function validateFile(root, rel) {
  const name = schemaFor(rel);
  if (name === null) return [];
  if (name === "unknown-shared") return [`${rel}: 共通仕様のファイルは terms、rules、nfr の 3 つだけである`];
  let data;
  try {
    data = parse(path.join(root, rel));
  } catch (e) {
    return [`${rel}: 読み取れない（${e.message}）`];
  }
  const errors = [];
  const check = (schema) => {
    if (!ajv.validate(schema, data)) {
      for (const e of ajv.errors) errors.push(`${rel}: ${e.instancePath || "/"} ${e.message}（${schema}）`);
    }
  };
  check(name);
  return errors;
}

/** 複数のファイルをまとめて検証する。戻り値は違反の配列。 */
export function validateFiles(root, rels) {
  return rels.flatMap((rel) => (existsSync(path.join(root, rel)) ? validateFile(root, rel) : []));
}
