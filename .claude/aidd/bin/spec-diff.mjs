// 仕様の差分と、今あるものへの影響の一覧を JSON で出す。プロダクトリードが実行する。
//
// 使い方：node .claude/aidd/bin/spec-diff.mjs <ticket-id> [--from <ref>] [--to <ref>] [--main-from <ref>] [--out <パス>]
//         node .claude/aidd/bin/spec-diff.mjs <ticket-id> --after-approval
//   --from      比較する元。既定は origin/main とのマージの基点（このチケットの差分）
//   --after-approval  承認の後に変わった項目（status.yaml の approval.commit から作業ツリーまで）を { from, changes, main_only } で出す。
//               承認の後に取り込んだ main の、ほかのチケットの変更は changes から除き、除いた項目の鍵を main_only に並べる
//   --to        比較する先。既定は作業ツリー
//   --main-from main の取り込みの前の origin/main。渡すと、そこから origin/main までに main が変えた項目と、このチケットが変える
//               項目の重なり（main_overlap）も出す
//   --out       書き出す先（例：specs/<ticket-id>/results/spec-diff.json）。省くと標準出力。
//               渡すと、status.yaml の affects の spec-diff の行も入れ替える（プロダクトリードが足した行は残す）
// 判定できなければ終了コード 2。
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
try {
  const ticket = args[0];
  if (!ticket || ticket.startsWith("--")) throw new Error("チケットの ID を渡してください");
  const { resolveRoot } = await import(new URL("../lib/root.mjs", import.meta.url).href);
  const root = resolveRoot();
  const { specDiff, defaultFrom, mergeAffects, readStatus, afterApproval } = await import(pathToFileURL(path.join(root, ".claude/aidd/lib/spec-diff.mjs")).href);
  if (args.includes("--after-approval")) {
    const approved = readStatus(root, ticket)?.approval?.commit;
    if (!approved) throw new Error(`specs/${ticket}/status.yaml に承認の記録（approval.commit）がありません`);
    const { main, changes } = afterApproval(root, ticket, approved);
    process.stdout.write(JSON.stringify({ from: approved, changes, main_only: [...main.keys] }, null, 2) + "\n");
    process.exit(0);
  }
  const result = specDiff(root, { ticket, from: opt("--from") ?? defaultFrom(root), to: opt("--to"), mainFrom: opt("--main-from") });
  const text = JSON.stringify(result, null, 2) + "\n";
  const out = opt("--out");
  if (out) {
    mkdirSync(path.dirname(path.resolve(root, out)), { recursive: true });
    writeFileSync(path.resolve(root, out), text);
    const statusPath = path.join(root, "specs", ticket, "status.yaml");
    if (existsSync(statusPath)) {
      writeFileSync(statusPath, mergeAffects(readFileSync(statusPath, "utf8"), result.affects));
    }
    console.log(result.affects.length ? `今あるものへの影響：${result.affects.map((r) => `${r.name}（${r.reason}）`).join("。")}` : "今あるものへの影響：なし（足すだけ）");
  } else {
    process.stdout.write(text);
  }
} catch (e) {
  console.error(`仕様の差分を出せませんでした（${e.message}）。`);
  process.exit(2);
}
