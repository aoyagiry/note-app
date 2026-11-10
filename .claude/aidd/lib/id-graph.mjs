// 仕様の ID とつながり（uses）を読み取る。traceability-check、spec-diff、approval-draft、gate2-report で共通に使う。
// 現行仕様（specs/_current/）、ticket-plan.yaml、チケットの計画の決め事を読み、項目を次のキーで引けるようにする。
//   現行仕様の項目：「<領域>/<ID>」（例：rooms/REQ-register、rooms/AC-register-1、_intent/GOAL-001、_shared/RULE-id、_shared/AC-id-1、_tech/TECH-language）
//   領域の目的：「<領域>/purpose」
//   ticket-plan.yaml の行：「TICKET/<チケット ID>」、later：「LATER/<id>」
//   計画の決め事：「<番号>/PD-<番号>」（例：003/PD-001）
// 読む場所は、作業ツリー（ref が null）か git の ref（main など）。
// 読めない YAML、同じ ID、無い ref は、空や上書きにせず例外にする（使う側は「判定できない」として終了コード 2 で止まる）。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";

export const CURRENT = "specs/_current";
export const PLAN_FILE = "specs/ticket-plan.yaml";
export const BASES = ["_intent", "_shared", "_tech"];
const SHARED = { terms: "terms", rules: "rules", nfr: "nfr" };

/** キーの種類（REQ、AC、RULE など。領域の目的は PURPOSE）。 */
export function kindOf(key) {
  if (/^(TICKET|LATER)\//.test(key)) return key.slice(0, key.indexOf("/"));
  const last = key.slice(key.lastIndexOf("/") + 1);
  return last === "purpose" ? "PURPOSE" : last.split("-")[0];
}
/** キーの最後の ID（rooms/REQ-register なら REQ-register）。 */
export const idOf = (key) => key.slice(key.lastIndexOf("/") + 1);
export const isBase = (area) => BASES.includes(area);

// ---------- 読む場所 ----------
/** 作業ツリー（ref が null）か git の ref を読む道具。 */
export function reader(root, ref = null) {
  if (ref === null) {
    return {
      ref,
      text: (rel) => {
        const f = path.join(root, rel);
        return existsSync(f) && statSync(f).isFile() ? readFileSync(f, "utf8") : null;
      },
      files: (dir) => {
        const out = [];
        const walk = (rel) => {
          const full = path.join(root, rel);
          if (!existsSync(full)) return;
          for (const name of readdirSync(full)) {
            const r = `${rel}/${name}`;
            if (statSync(path.join(root, r)).isDirectory()) walk(r);
            else out.push(r);
          }
        };
        walk(dir);
        return out;
      },
    };
  }
  const key = `${root}\0${ref}`;
  if (!refReaders.has(key)) {
    try {
      execFileSync("git", ["-C", root, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { stdio: "ignore" });
    } catch {
      throw new Error(`git の ${ref} が見つかりません`);
    }
    refReaders.set(key, refReader(root, ref));
  }
  return refReaders.get(key);
}
// 同じ ref の読み手は使い回す（1 回の実行の中で ref は動かない）
const refReaders = new Map();
// specs/ の下の文章のファイルは、ls-tree と cat-file --batch で一度に読む。
// ファイルごとに git show を起動すると、Windows では 1 回に約 0.1 秒かかり、traceability-check の 1 回が 10 秒になるため
const BATCH_EXT = /\.(ya?ml|json|md)$/;
function refReader(root, ref) {
  const git = (...a) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 << 20 });
  let all = null;     // specs/ の下のファイルの名前
  let texts = null;   // specs/ の下の文章のファイルの名前 → 中身
  const load = () => {
    if (all !== null) return;
    const blobs = git("ls-tree", "-r", "-z", ref, "specs/").split("\0").filter(Boolean).map((l) => {
      const tab = l.indexOf("\t");
      const [, type, oid] = l.slice(0, tab).split(" ");
      return { type, oid, path: l.slice(tab + 1) };
    }).filter((b) => b.type === "blob");
    const wanted = blobs.filter((b) => BATCH_EXT.test(b.path));
    const read = new Map();
    if (wanted.length === 0) {
      [all, texts] = [blobs.map((b) => b.path), read];
      return;
    }
    const out = execFileSync("git", ["-C", root, "cat-file", "--batch"], {
      input: wanted.map((b) => b.oid).join("\n") + "\n", stdio: ["pipe", "pipe", "ignore"], maxBuffer: 256 << 20,
    });
    let pos = 0;
    for (const b of wanted) {
      const nl = out.indexOf(10, pos);   // 「<oid> blob <size>」の行
      const size = Number(out.toString("latin1", pos, nl).split(" ")[2]);
      read.set(b.path, out.toString("utf8", nl + 1, nl + 1 + size));
      pos = nl + 1 + size + 1;
    }
    [all, texts] = [blobs.map((b) => b.path), read];
  };
  return {
    ref,
    text: (rel) => {
      if (rel.startsWith("specs/") && BATCH_EXT.test(rel)) {
        load();
        return texts.get(rel) ?? null;
      }
      try { return git("show", `${ref}:${rel}`); } catch { return null; }
    },
    files: (dir) => {
      load();
      return all.filter((f) => f.startsWith(`${dir}/`));
    },
  };
}

/** YAML（と JSON）を読む。読めなければ、ファイルと版（ref が null なら作業ツリー）を名指す例外にする。 */
export function parseYaml(text, rel, ref = null) {
  try {
    return YAML.parse(text) ?? {};
  } catch (e) {
    throw new Error(`${rel} を YAML として読めません（${ref ?? "作業ツリー"}）：${e.message.split("\n")[0]}`);
  }
}
const yamlOf = (rd, rel) => {
  const t = rd.text(rel);
  return t === null ? null : parseYaml(t, rel, rd.ref);
};

/** 現行仕様の領域の名前（_intent、_shared、_tech、rooms、journeys/signup など）。 */
export function areaNames(rd) {
  const names = new Set();
  for (const f of rd.files(CURRENT)) {
    const parts = f.slice(CURRENT.length + 1).split("/");
    if (isBase(parts[0])) names.add(parts[0]);
    else if (parts[parts.length - 1] === "requirements.yaml" && parts.length === (parts[0] === "journeys" ? 3 : 2)) names.add(parts.slice(0, -1).join("/"));
  }
  return [...names].sort();
}

/**
 * 仕様一式を読み、項目の索引を作る。rd は reader() の戻り値（省略すると作業ツリー）。
 * 戻り値の items は Map<キー, { key, kind, item, area, file, parent }>。具体例（AC）の parent は親の要件（REQ）か共通の要件（RULE）のキー。
 */
export function buildIndex(root, rd = reader(root)) {
  const items = new Map();
  const add = (key, item, extra) => {
    if (items.has(key)) throw new Error(`同じ ID ${key} が 2 か所にあります（${items.get(key).file}、${extra.file}。${rd.ref ?? "作業ツリー"}）`);
    items.set(key, { key, kind: kindOf(key), item, ...extra });
  };
  const areas = areaNames(rd);
  for (const area of areas) {
    const file = (f) => `${CURRENT}/${area}/${f}`;
    if (area === "_intent") {
      const intent = yamlOf(rd, file("intent.yaml")) ?? {};
      for (const x of [...(intent.goals ?? []), ...(intent.facts ?? [])]) add(`_intent/${x.id}`, x, { area, file: file("intent.yaml") });
    } else if (area === "_shared") {
      for (const [f, k] of Object.entries(SHARED)) for (const x of yamlOf(rd, file(`${f}.yaml`))?.[k] ?? []) {
        // 共通の要件の代表の具体例は、領域の要件と同じく、要件の行から外して具体例として入れる
        const { examples, ...rest } = x;
        add(`_shared/${x.id}`, k === "rules" ? rest : x, { area, file: file(`${f}.yaml`) });
        if (k === "rules") for (const e of examples ?? []) add(`_shared/${e.id}`, e, { area, file: file(`${f}.yaml`), parent: `_shared/${x.id}` });
      }
    } else if (area === "_tech") {
      for (const x of yamlOf(rd, file("tech.yaml"))?.tech ?? []) add(`_tech/${x.id}`, x, { area, file: file("tech.yaml") });
      for (const x of yamlOf(rd, file("acceptance.yaml"))?.acceptance ?? []) add(`_tech/${x.id}`, x, { area, file: file("acceptance.yaml") });
    } else {
      const spec = yamlOf(rd, file("requirements.yaml")) ?? {};
      const f = file("requirements.yaml");
      if (spec.purpose !== undefined) add(`${area}/purpose`, { statement: spec.purpose }, { area, file: f });
      for (const r of spec.requirements ?? []) {
        const { examples, ...rest } = r;
        add(`${area}/${r.id}`, rest, { area, file: f });
        for (const e of examples ?? []) add(`${area}/${e.id}`, e, { area, file: f, parent: `${area}/${r.id}` });
      }
      for (const n of spec.nfr ?? []) add(`${area}/${n.id}`, n, { area, file: f });
    }
  }
  const plan = yamlOf(rd, PLAN_FILE) ?? {};
  for (const t of plan.tickets ?? []) add(`TICKET/${t.id}`, t, { area: null, file: PLAN_FILE });
  for (const l of plan.later ?? []) add(`LATER/${l.id}`, l, { area: null, file: PLAN_FILE });
  for (const f of rd.files("specs")) {
    const m = f.match(/^specs\/(\d{3})-[a-z0-9-]+\/plan\/details\.yaml$/);
    if (m) for (const pd of yamlOf(rd, f)?.details ?? []) add(`${m[1]}/${pd.id}`, pd, { area: null, file: f });
  }
  return { items, areas, plan, rd };
}

/** 要件（REQ、RULE、NFR）の uses。 */
export const usesOf = (entry) => (Array.isArray(entry?.item?.uses) ? entry.item.uses.map(String) : []);

/** key を uses で指す項目のキー（直接に頼るものだけ）。 */
export function usedBy(index, key) {
  return [...index.items.values()].filter((e) => usesOf(e).includes(key)).map((e) => e.key);
}

/** 要件の下の具体例のキー。 */
export function examplesOf(index, reqKey) {
  return [...index.items.values()].filter((e) => e.parent === reqKey).map((e) => e.key);
}

/** テストを持つ具体例か（基盤の受入条件のうち、ci と human で確認するものは除く）。 */
export const needsTest = (entry) => entry.kind === "AC" && !(entry.area === "_tech" && ["ci", "human"].includes(entry.item?.checked_by));

// ---------- テストの中の AC-ID と PD-ID ----------
const TEST_SKIP = new Set([".git", "node_modules", ".claude", "coverage"]);
const CHECKS_DIR = `${CURRENT}/_tech/checks`;
/** テストのファイル（*.test.*、*.spec.*、specs/_current/_tech/checks/ の下）。 */
export function testFiles(root, d = root, out = []) {
  for (const name of readdirSync(d)) {
    if (TEST_SKIP.has(name)) continue;
    const full = path.join(d, name);
    const rel = path.relative(root, full).split(path.sep).join("/");
    if (statSync(full).isDirectory()) {
      if (rel === "specs") {
        if (existsSync(path.join(root, CHECKS_DIR))) testFiles(root, path.join(root, CHECKS_DIR), out);
        continue;
      }
      testFiles(root, full, out);
    } else if (isTestPath(rel)) out.push(rel);
  }
  return out;
}
/** テストのファイルのパスか（testFiles と同じ判定。git の版のファイルの一覧に当てる）。 */
export const isTestPath = (rel) => rel.startsWith(`${CHECKS_DIR}/`)
  || (!rel.startsWith("specs/") && !rel.split("/").some((x) => TEST_SKIP.has(x))
      && /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel.slice(rel.lastIndexOf("/") + 1)));
// テスト名の AC-ID：領域を付けた形（rooms/AC-register-1、_tech/AC-ci-1、journeys/signup/AC-flow-1）。
// 末尾の -<番号> の後に英数字とハイフンが続かないところで区切る（AC-a-1 と AC-a-12 を見分ける）
export const TEST_AC = /(?<![\w/-])((?:[a-z][a-z0-9-]*\/)?_?[a-z][a-z0-9-]*)\/(AC-(?:[a-z0-9]+-)+?\d+)(?![A-Za-z0-9-])/g;
export const TEST_PD = /(?<![\w/-])(\d{3})\/(PD-\d{3})(?![A-Za-z0-9-])/g;
/** テストの中の「<領域>/AC-…」と「<番号>/PD-xxx」を集める。戻り値は Map<キー, ["ファイル:行 テスト名", ...]> */
export function testRefs(root) {
  const refs = new Map();
  const put = (k, where) => {
    if (!refs.has(k)) refs.set(k, []);
    refs.get(k).push(where);
  };
  for (const f of testFiles(root)) {
    readFileSync(path.join(root, f), "utf8").split("\n").forEach((line, i) => {
      const where = `${f}:${i + 1} ${line.trim().slice(0, 120)}`;
      for (const m of line.matchAll(TEST_AC)) put(`${m[1]}/${m[2]}`, where);
      for (const m of line.matchAll(TEST_PD)) put(`${m[1]}/${m[2]}`, where);
    });
  }
  return refs;
}

// ---------- 比較する ----------
export const canon = (x) => (Array.isArray(x) ? x.map(canon) : x && typeof x === "object"
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canon(x[k])])) : x);
/** 項目から id を除いたもの（ID を付け替えただけかを、中身で比較するため）。 */
export const stripId = ({ id, ...rest } = {}) => rest;
export const sameItem = (a, b) => JSON.stringify(canon(a ?? {})) === JSON.stringify(canon(b ?? {}));
