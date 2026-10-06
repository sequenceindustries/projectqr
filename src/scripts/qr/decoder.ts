/** jsQR, loaded on first use only (it is the largest script on the site). */
type JsQR = typeof import('jsqr').default;
let jsqr: Promise<JsQR> | null = null;
export function loadDecoder(): Promise<JsQR> {
  return (jsqr ??= import('jsqr').then((m) => m.default));
}
