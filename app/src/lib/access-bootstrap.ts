// The accessibility settings' storage key and head script, with no DOM code, so the server's CSP allowlist
// (src/server/lib/csp-allowlist.ts) can import the exact text it hashes; src/lib/access.ts reads and writes the choice.

export const ACCESS_KEY = "mop-access";

/**
 * The head script: the stored choice drawn on <html> before the first paint, on public pages only. Plain ES5 with no
 * backslash, so its exact text can sit in CSP_INLINE_ALLOWLIST and be hashed.
 */
export const ACCESS_BOOTSTRAP = `(function(){try{if(location.pathname.indexOf("/admin")===0)return;var p=JSON.parse(localStorage.getItem("${ACCESS_KEY}")||"{}"),r=document.documentElement,f=["contrast","spacing","font","links","still"];if(p.text===1||p.text===2)r.setAttribute("data-text",String(p.text));if(p.vision==="deutan"||p.vision==="protan"||p.vision==="tritan")r.setAttribute("data-vision",p.vision);for(var i=0;i<f.length;i++)if(p[f[i]]===true)r.setAttribute("data-"+f[i],"")}catch(e){}})()`;
