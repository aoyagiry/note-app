// コマンドを実行し、コマンド、終了コード、標準出力、標準エラーを加工せずに JSON に保存する（テストを書く役が Red の red-run.json を残すのに使う）。
// 使い方: node run-capture.mjs <出力先.json> <コマンド> [<コマンド> ...]
//   コマンドは 1 つずつ引数で渡す（シェルで実行する）。結果は、渡した順に runs に入る。
//   コマンドには Red の印の環境変数（AIDD_RED=1）を渡す。e2e の設定は、この印があるときだけ待ちを短くし、パソコンの幅の project だけを流す
//   （architecture.md のテストの節）
// 実行したコマンドが 0 以外で終わっても、終了コードは 0 を返す（Red では失敗が期待どおりのため）。保存できなければ 2。
import { spawnSync, execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const [out, ...commands] = process.argv.slice(2);
if (!out || commands.length === 0) {
  console.error("使い方: node run-capture.mjs <出力先.json> <コマンド> [<コマンド> ...]");
  process.exit(2);
}
try {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const runs = commands.map((command) => {
    const started_at = new Date().toISOString();
    const r = spawnSync(command, { shell: true, env: { ...process.env, AIDD_RED: "1" }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return { command, exit_code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "", started_at, finished_at: new Date().toISOString() };
  });
  writeFileSync(out, JSON.stringify({ commit, runs }, null, 2) + "\n");
  for (const r of runs) console.log(`${r.exit_code}\t${r.command}`);
} catch (e) {
  console.error(`保存できませんでした（${e.message}）`);
  process.exit(2);
}
