// The router's own scroll-restoration script, emitted into every page because `src/router.tsx` sets
// `scrollRestoration: true`. TanStack gives it no `class="$tsr"` marker; its text is a constant of
// `@tanstack/router-core` (`scroll-restoration-inline.js` plus the storage key and a self-removal), so it changes
// only with a router upgrade, and the `csp-inline-rules` case fails then.
const SCROLL_RESTORATION = `(function(a,f){let l;try{l=JSON.parse(sessionStorage.getItem(a)||"{}")}catch{return}const n=l?.[f||history.state?.__TSR_key];let c=!1;for(const t in n){const e=n[t],o=e?.scrollX,s=e?.scrollY;if(Number.isFinite(o)&&Number.isFinite(s)){if(t==="window")scrollTo(o,s),c=!0;else if(t)try{const r=document.querySelector(t);r&&(r.scrollLeft=o,r.scrollTop=s)}catch{}}}if(c)return;const i=location.hash.slice(1);if(i){const t=history.state?.__hashScrollIntoViewOptions??!0;if(t){const e=document.getElementById(i);e&&e.scrollIntoView(t)}return}scrollTo(0,0)})("tsr-scroll-restoration-v1_3");document.currentScript.remove()`;

/**
 * The exact texts of executable inline scripts that `inlineHashes` may hash besides TanStack's `class="$tsr"`
 * scripts (SEC-03): a script of the app, or one the router emits without its marker. An entry is added only with
 * the commit that adds its script, and the `csp-inline-rules` case asserts every entry still occurs in a render.
 */
export const CSP_INLINE_ALLOWLIST: readonly string[] = [SCROLL_RESTORATION];
