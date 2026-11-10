// pin-fixed.mjs の型。案件の型の検査（strict で allowJs が無い）は、型の無い .mjs を読むと TS7016 で落ちるため。

/** 画面の下に固定した部品（el はタグとクラス、y と h は画面の中の位置と高さ） */
export interface Pinned {
  el: string;
  position: string;
  y: number;
  h: number;
}

/** 見えている要素のうち、画面の下に固定した部品（ブラウザの中で動く。page.evaluate に渡す） */
export declare function findPinned(): Pinned[];

/** 画面の下に固定した部品をページの下端に置き、置いた部品の数を返す（ブラウザの中で動く。page.evaluate に渡す） */
export declare function pinToBottom(): number;

/** pinToBottom で変えた style を元に戻す（ブラウザの中で動く。page.evaluate に渡す） */
export declare function unpin(): void;
