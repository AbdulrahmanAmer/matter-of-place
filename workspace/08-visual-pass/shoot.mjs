// usage: node shoot.mjs <outdir> [base]
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire("E:/Matter Of Place/launch/package.json");
const puppeteer = require("puppeteer-core");
const out = process.argv[2];
const base = process.argv[3] || "http://127.0.0.1:8080";
const routes = ["/","/properties","/property/oak-hill-residence","/property/tiburon-waterline","/markets","/california","/california/guide","/california/bay-area","/stories","/stories/shade-as-a-material","/editorial-standard","/submit","/exposure","/about","/contact","/faq","/legal","/does-not-exist"];
const sizes = [[1440,900],[390,844]];
const b = await puppeteer.launch({executablePath:"C:/Users/DELL/.cache/puppeteer/chrome/win64-154.0.8037.57/chrome-win64/chrome.exe",headless:true});
const report = [];
for (const [w,h] of sizes) {
  const p = await b.newPage();
  await p.setViewport({width:w,height:h,deviceScaleFactor:1});
  const errs=[]; p.on("console",m=>{if(m.type()==="error")errs.push(m.text())}); p.on("pageerror",e=>errs.push(String(e)));
  for (const r of routes) {
    errs.length=0;
    await p.goto(base+r,{waitUntil:"networkidle0",timeout:60000}).catch(()=>{});
    // trigger reveal-on-scroll content
    await p.evaluate(async()=>{const H=document.body.scrollHeight;for(let y=0;y<H;y+=500){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,60));}window.scrollTo(0,0);await new Promise(r=>setTimeout(r,400));});
    const m = await p.evaluate(()=>{const dw=document.documentElement.clientWidth;const bad=[];document.querySelectorAll("body *").forEach(e=>{const rc=e.getBoundingClientRect();if(rc.width>0&&rc.right>dw+1&&getComputedStyle(e).position!=="fixed"){bad.push(e.tagName+"."+String(e.className).slice(0,40)+" r="+Math.round(rc.right))}});return {sw:document.documentElement.scrollWidth,dw,bad:bad.slice(0,6),title:document.title}});
    const name = (r==="/"?"home":r.slice(1).replace(/\//g,"_"))+"-"+w+".png";
    await p.screenshot({path:`${out}/${name}`,fullPage:true});
    report.push({r,w,...m,errs:[...errs]});
    console.log(r,w,m.sw>m.dw?"OVERFLOW "+m.sw:"ok",m.bad.length?JSON.stringify(m.bad):"",errs.length?"ERR "+errs[0].slice(0,80):"");
  }
  await p.close();
}
writeFileSync(out+"/report.json",JSON.stringify(report,null,1));
await b.close();
