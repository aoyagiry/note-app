// 画面の下に固定した部品のある画面の撮り方。mock-render.mjs と、案件の e2e の撮る支えの関数が読み、
// Playwright の page.evaluate に渡す（ブラウザの中で動く）。page.evaluate は関数の文だけを送るので、3 つの関数はそれぞれ外の名前を使わずに書く
// （固定した部品の見分け方は、findPinned と pinToBottom に同じものを書く）。
// 下に固定した部品は、計算した style で見分ける。sticky は bottom が auto でないもの。fixed は bottom の値が top の値より小さいもの
// （fixed の top と bottom は実際の px で返るので、auto かどうかでは見分けられない）。上に固定した見出しと、画面全体を覆う fixed は入らない。
// 使い方：部品があり、ページが画面より高いとき（document.documentElement.scrollHeight > innerHeight）だけ、画面の元は先に最初の 1 画面
// （<名前>--top.png）を撮り、pinToBottom で部品をページの下端に置いて全体を撮り、unpin で戻す。型の宣言は pin-fixed.d.mts。

/** 見えている要素のうち、画面の下に固定した部品。[{ el, position, y, h }]（el はタグとクラス、y と h は画面の中の位置と高さ） */
export function findPinned() {
  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const sticky = cs.position === "sticky" && cs.bottom !== "auto";
    const fixed = cs.position === "fixed" && parseFloat(cs.bottom) < parseFloat(cs.top);
    if (!sticky && !fixed) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    out.push({ el: [el.tagName.toLowerCase(), ...el.classList].join("."), position: cs.position, y: Math.round(r.top), h: Math.round(r.height) });
  }
  return out;
}

/**
 * 全体の画像のために、画面の下に固定した部品をページの下端に置く。画面の中身の CSS は変えず、その要素の style だけを変える。
 * sticky は position: static にする（流れの中の位置、ページの一番下までスクロールしたときの位置に戻る）。fixed は absolute にして幅と高さを決め、
 * 開いたときの画面の下からの距離を保ったまま、ページの下端に置く。元の style は window.__pinned に残し、unpin で戻す。置いた部品の数を返す。
 */
export function pinToBottom() {
  const docH = document.documentElement.scrollHeight;
  const saved = [];
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const sticky = cs.position === "sticky" && cs.bottom !== "auto";
    const fixed = cs.position === "fixed" && parseFloat(cs.bottom) < parseFloat(cs.top);
    if (!sticky && !fixed) continue;
    saved.push([el, el.getAttribute("style")]);
    if (sticky) {
      el.style.setProperty("position", "static", "important");
      continue;
    }
    const r = el.getBoundingClientRect();
    const set = (k, v) => el.style.setProperty(k, v, "important");
    set("box-sizing", "border-box");
    set("width", `${r.width}px`);
    set("height", `${r.height}px`);
    set("position", "absolute");
    set("right", "auto");
    set("bottom", "auto");
    set("left", "0px");
    set("top", "0px");
    // 位置を決める祖先の場所は分からないので、0 に置いて測り、ずれを足す
    const at = el.getBoundingClientRect();
    set("left", `${r.left - at.left}px`);
    set("top", `${docH - (innerHeight - r.bottom) - r.height - (at.top + scrollY)}px`);
  }
  window.__pinned = saved;
  return saved.length;
}

/** pinToBottom で変えた style を元に戻す（撮った後に、続けて操作するテストのため）。 */
export function unpin() {
  for (const [el, style] of window.__pinned ?? []) {
    if (style === null) el.removeAttribute("style");
    else el.setAttribute("style", style);
  }
  window.__pinned = [];
}
