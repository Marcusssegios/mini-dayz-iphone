import fs from "node:fs";
import { PNG } from "pngjs";
import {webkit, devices} from "playwright-core";
const browser=await webkit.launch({headless:true});
const page=await browser.newPage({...devices["iPhone 13"],viewport:{width:390,height:844}});
const errors=[],bad=[],audioRequests=[];
page.on("request",r=>{if(/\.(m4a|ogg)(?:\?|$)/i.test(r.url()))audioRequests.push(r.url());});
page.on("pageerror", e=>{errors.push(String(e)); console.log("WEBKIT JS ERROR",String(e).slice(0,500));});
page.on("response",r=>{if(r.status()>=400)bad.push(r.status()+" "+r.url());});
page.on("requestfailed",r=>{bad.push(r.url()+" "+r.failure());});
page.on("console",m=>{if(m.type()==="error")console.log("WEBKIT CONSOLE",m.text().slice(0,400));});
await page.goto("http://127.0.0.1:8975/go-v10/index.html",{waitUntil:"domcontentloaded",timeout:30000});
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
await page.touchscreen.tap(421,192);
await page.waitForTimeout(1200);
const sound=await page.evaluate(()=>({
  states:(window.__mdzAudioContexts||[]).map(c=>c.state),
  unlocks:window.__mdzAudioUnlocks,
  errors:window.__mdzAudioErrors,
  button:document.getElementById("mdz-audio-unlock")?.style.display,
  pluginReady:!!window.cr_getC2Runtime?.()?.aj
}));
console.log("WEBKIT SOUND CHECK",JSON.stringify(sound));
console.log("WEBKIT AUDIO CODECS",JSON.stringify({m4a:audioRequests.filter(x=>/\.m4a(?:\?|$)/i.test(x)).length,ogg:audioRequests.filter(x=>/\.ogg(?:\?|$)/i.test(x)).length,samples:audioRequests.slice(0,8)}));
console.log("WEBKIT FAILED RESOURCES",bad.slice(0,25),"TOTAL",bad.length);
// Prove the fallback works even if legacy XML/XPath completely fails in Safari.
const blocked=await browser.newPage({...devices["iPhone 13"],viewport:{width:390,height:844}});
let intercepted=0;
await blocked.route("**/l_eng_*.xml",route=>{intercepted++;return route.abort();});
await blocked.goto("http://127.0.0.1:8975/go-v10/index.html",{waitUntil:"domcontentloaded",timeout:30000});
await blocked.waitForFunction(()=>{
 const r=window.cr_getC2Runtime?.();
 return r && r.Ml>=0.99 && window.__mdzLocaleReady;
},null,{timeout:60000});
const blockedResult=await blocked.evaluate(()=>{
 const r=window.cr_getC2Runtime?.();
 return [540,543,544,911].map(id=>({id,value:r?.S?.[id]?.q?.[0]?.rd?.[1]?.[0]?.[0]}));
});
console.log("WEBKIT WITHOUT XML",JSON.stringify({intercepted,blockedResult}));
await blocked.screenshot({path:"site/ci-webkit-no-xml-fallback.png",timeout:20000});
await blocked.close();
if(intercepted<4||blockedResult.some(x=>typeof x.value!=="string"||!x.value||x.value==="0")){
 throw Error("Safari XML-free fallback failed: "+JSON.stringify(blockedResult));
}
// Regression: iOS often goes silent after backgrounding/reopening Safari.
// Simulate Construct 2 suspension, then recover with the real audio button.
await page.evaluate(()=>{
  const rt=window.cr_getC2Runtime?.();
  if(rt && rt.setSuspended) rt.setSuspended(true);
});
await page.waitForTimeout(350);
await page.locator("#mdz-audio-unlock").click({force:true});
await page.waitForTimeout(1000);
const recovered=await page.evaluate(()=>{
  const rt=window.cr_getC2Runtime?.();
  return {status:window.__mdzAudioStatus?.(), suspended:rt?.sl, layout:rt?.wa?.name};
});
console.log("WEBKIT BACKGROUND RECOVERY",JSON.stringify(recovered));
if(recovered.suspended||!recovered.status.states.includes("running")||
   recovered.status.errors.length||recovered.status.tests<1){
  throw Error("Safari failed to recover from game suspension: "+JSON.stringify(recovered));
}
// Explicit repair button must also unmute Construct 2's *game* sound flag.
const muteSetup=await page.evaluate(()=>{
 const plugin=window.cr_getC2Runtime?.()?.aj;
 const acts=plugin?.type?.plugin?.n;
 if(acts && typeof acts.zC==="function") acts.zC.call(plugin,0);
 return {supported:!!(acts && typeof acts.zC==="function"),
   silent:plugin?.Fa?.().silent};
});
console.log("WEBKIT GAME MUTE TEST SETUP",JSON.stringify(muteSetup));
if(!muteSetup.supported || !muteSetup.silent){
 throw Error("Could not simulate native game audio mute: "+JSON.stringify(muteSetup));
}
await page.locator("#mdz-audio-unlock").click({force:true});
const unmuted=await page.evaluate(()=>window.__mdzAudioStatus?.());
console.log("WEBKIT GAME UNMUTE",JSON.stringify(unmuted));
if(unmuted.silent)throw Error("Repair button did not unmute Construct 2 audio");
// Re-open the same URL in the same Safari/WebKit session, preserving cache.
await page.goto("about:blank");
await page.goto("http://127.0.0.1:8975/go-v10/index.html",{waitUntil:"domcontentloaded",timeout:30000});
await page.waitForFunction(()=>window.cr_getC2Runtime?.()?.Ml>=0.99,null,{timeout:90000});
await page.locator("#mdz-audio-unlock").click({force:true});
await page.waitForTimeout(1000);
const reopened=await page.evaluate(()=>{
 const rt=window.cr_getC2Runtime?.();
 return {status:window.__mdzAudioStatus?.(),progress:rt?.Ml,layout:rt?.wa?.name};
});
console.log("WEBKIT REOPEN AUDIO",JSON.stringify(reopened));
if(!reopened.status.states.includes("running")||reopened.status.errors.length||
   reopened.status.tests<1||reopened.progress<0.99||reopened.layout!=="Menu"){
 throw Error("Safari audio failed after reopening: "+JSON.stringify(reopened));
}
await browser.close();
if(!sound.states.includes("running")||sound.states.filter(x=>x!=="closed").some(x=>x!=="running")||sound.errors.length||!dictionaries.ready||dictionaries.sample.some(x=>typeof x.first!=="string"||!x.first||x.first==="0")||!last.bootStarted||last.layout!=="Menu"||last.loadedLayouts<7||last.progress<0.99||Math.max(uiRatio,landscapeRatio)<0.015||bad.length||errors.length){
 throw Error("iPhone WebKit engine failed to load Menu: "+JSON.stringify(last));
}
console.log("PASS WEBKIT: iPhone-sized WebKit reaches fully loaded Construct 2 Menu layout.");
