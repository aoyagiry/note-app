// 見た目の回帰テスト。受け入れた見た目を specs/_current/<領域>/screenshots/ に 1 組だけ持ち、
// verify.mjs が、e2e のスクリーンショットを main とのマージの基点にある基準と画素で比較する。
// 基準は手元の OS で作るので、名前に OS を付ける（何人かで使うときは OS ごとの基準になる）。
import { execFileSync } from "node:child_process";
import pixelmatch from "pixelmatch";
import pngjs from "pngjs";

const { PNG } = pngjs;

/** 基準の名前に付ける OS の名前。 */
export const osName = () => ({ darwin: "mac", win32: "win", linux: "linux" }[process.platform] ?? process.platform);

/** e2e のスクリーンショットの名前（<領域>--<SCR の ID>…png）から領域を取る。名前の形でなければ null。 */
export const areaOfShot = (file) => file.match(/^([a-z][a-z0-9]*(?:-[a-z0-9]+)*)--SCR-[^/]+\.png$/)?.[1] ?? null;

/** スクリーンショットの基準のパス（リポジトリのルートから）。 */
export const baselinePath = (file) => `specs/_current/${areaOfShot(file)}/screenshots/${file.replace(/\.png$/, `-${osName()}.png`)}`;

/** ref の時点の基準（Buffer）。無ければ null。 */
export function baselineAt(root, ref, rel) {
  try {
    return execFileSync("git", ["-C", root, "show", `${ref}:${rel}`], { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 << 20 });
  } catch {
    return null;
  }
}

/**
 * 2 つの PNG（Buffer）を比較する。ratio は違う画素の割合（0〜1）、diff は違う所に色を付けた PNG（Buffer）。
 * 大きさが違えば、ratio を 1 にし、diff は作らない（並びが変わったので、前と後を並べて見る）。
 */
export function comparePng(before, after) {
  const a = PNG.sync.read(before), b = PNG.sync.read(after);
  if (a.width !== b.width || a.height !== b.height) return { ratio: 1, diff: null };
  const out = new PNG({ width: a.width, height: a.height });
  const n = pixelmatch(a.data, b.data, out.data, a.width, a.height, { threshold: 0.1 });
  return { ratio: n / (a.width * a.height), diff: PNG.sync.write(out) };
}
