import {webkit, devices} from "playwright-core";
const browser=await webkit.launch({headless:true});
const page=await browser.newPage({...devices["iPhone 13"],viewport:{width:390,height:844}});
const errors=[],bad=[];
page.on("pageerror", e=>{errors.push(String(e)); console.log("WEBKIT JS ERROR",String(e).slice(0,500));});
page.on("response",r=>{if(r.status()>=400)bad.push(r.status()+" "+r.url());});
page.on("requestfailed",r=>{bad.push(r.url()+" "+r.failure());});
page.on("console",m=>{if(m.type()==="error")console.log("WEBKIT CONSOLE",m.text().slice(0,400));});
await page.goto("http://127.0.0.1:8975/go-v4/index.html",{waitUntil:"domcontentloaded",timeout:30000});
let last={};
for (const delay of [8000,15000,18000]) {
 await page.waitForTimeout(delay);
 last=await page.evaluate(()=>{
   const rt=window.cr_getC2Runtime?.();
   return {
     bootStarted:!!rt, layout:rt?.Xv, progress:rt?.Ml,
     loadedLayouts:rt?.He?.length||0,
     errors:window.__mdzErrors?.slice(-6),
     canvas:document.querySelector("#c2canvas")?.width
   };
 });
 console.log("WEBKIT STATE",JSON.stringify(last));
 await page.screenshot({path:"site/ci-webkit-menu.png",timeout:20000});
}
console.log("WEBKIT FAILED RESOURCES",bad.slice(0,25),"TOTAL",bad.length);
await browser.close();
if(!last.bootStarted||last.layout!=="Menu"||last.loadedLayouts<7||last.progress<0.99||bad.length||errors.length){
 throw Error("iPhone WebKit engine failed to load Menu: "+JSON.stringify(last));
}
console.log("PASS WEBKIT: iPhone-sized WebKit reaches fully loaded Construct 2 Menu layout.");
