import fs from "node:fs";
import { PNG } from "pngjs";
import {webkit, devices} from "playwright-core";
const browser=await webkit.launch({headless:true});
const page=await browser.newPage({...devices["iPhone 13"],viewport:{width:390,height:844}});
const errors=[],bad=[];
page.on("pageerror", e=>{errors.push(String(e)); console.log("WEBKIT JS ERROR",String(e).slice(0,500));});
page.on("response",r=>{if(r.status()>=400)bad.push(r.status()+" "+r.url());});
page.on("requestfailed",r=>{bad.push(r.url()+" "+r.failure());});
page.on("console",m=>{if(m.type()==="error")console.log("WEBKIT CONSOLE",m.text().slice(0,400));});
await page.goto("http://127.0.0.1:8975/go-v8/index.html",{waitUntil:"domcontentloaded",timeout:30000});
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
const picture=PNG.sync.read(fs.readFileSync("site/ci-webkit-menu.png"));
let uiPixels=0,area=0;
for(let y=120;y<picture.height-80;y+=3)for(let x=25;x<picture.width-25;x+=3){
 const i=(y*picture.width+x)*4;
 area++;if(picture.data[i]<220||picture.data[i+1]<220||picture.data[i+2]<220)uiPixels++;
}
const uiRatio=uiPixels/Math.max(area,1);
console.log("WEBKIT VISUAL UI COVERAGE",uiRatio.toFixed(4));
console.log("WEBKIT ENGINE FLAGS",JSON.stringify(await page.evaluate(()=>{
 const r=window.cr_getC2Runtime?.();
 return {ij:r?.Ij,currentLayout:r?.wa?.name,engineProgress:r?.gd,frame:r?.Vd,textureGl:!!r?.H};
})));
await page.setViewportSize({width:844,height:390});
await page.waitForTimeout(5000);
const land=PNG.sync.read(await page.screenshot({path:"site/ci-webkit-landscape.png",timeout:20000}));
let painted=0,pixels=0;
for(let y=30;y<land.height-30;y+=3)for(let x=60;x<land.width-60;x+=3){
 const i=(y*land.width+x)*4;pixels++;
 if(land.data[i]<220||land.data[i+1]<220||land.data[i+2]<220)painted++;
}
const landscapeRatio=painted/Math.max(1,pixels);
console.log("WEBKIT LANDSCAPE UI COVERAGE",landscapeRatio.toFixed(4));
const dictionaries=await page.evaluate(()=>{
 const r=window.cr_getC2Runtime?.();
 return {status:window.__mdzLocaleStatus,ready:window.__mdzLocaleReady,
  sample:[540,543,544,911].map(id=>({id,first:r?.S?.[id]?.q?.[0]?.rd?.[1]?.[0]?.[0],
   tenth:r?.S?.[id]?.q?.[0]?.rd?.[10]?.[0]?.[0]}))};
});
console.log("WEBKIT TEXT FIX",JSON.stringify(dictionaries));
console.log("WEBKIT FAILED RESOURCES",bad.slice(0,25),"TOTAL",bad.length);
await browser.close();
if(!dictionaries.ready||dictionaries.sample.some(x=>typeof x.first!=="string"||!x.first||x.first==="0")||!last.bootStarted||last.layout!=="Menu"||last.loadedLayouts<7||last.progress<0.99||Math.max(uiRatio,landscapeRatio)<0.015||bad.length||errors.length){
 throw Error("iPhone WebKit engine failed to load Menu: "+JSON.stringify(last));
}
console.log("PASS WEBKIT: iPhone-sized WebKit reaches fully loaded Construct 2 Menu layout.");
