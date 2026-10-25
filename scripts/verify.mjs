import { chromium } from "playwright-core";
import fs from "node:fs";
import { PNG } from "pngjs";

const candidates = ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/opt/google/chrome/chrome", "/usr/bin/chromium"];
const exe = candidates.find(x => fs.existsSync(x));
if (!exe) throw Error("No installed Chromium/Chrome found on CI");
console.log("Browser:", exe);
const browser = await chromium.launch({
  executablePath: exe, headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader",
         "--enable-webgl", "--autoplay-policy=no-user-gesture-required"]
});
const page = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const errors=[];
const resources=[];
page.on("pageerror", e => {errors.push(String(e)); console.log("JS ERROR",String(e).slice(0,300));});
page.on("console", m => {if(m.type()==="error") console.log("CONSOLE",m.text().slice(0,300));});
page.on("response", r => {if(r.status()>=400) resources.push(r.status()+" "+r.url());});
page.on("requestfailed", r => {resources.push("FAILED "+r.url()+" "+r.failure());});
const url="http://127.0.0.1:8975/go-v5/index.html";
console.log("Opening",url);
await page.goto(url,{waitUntil:"domcontentloaded",timeout:30000});
let final=null;
for (const delay of [5000,15000,20000]) {
  await page.waitForTimeout(delay);
  const state=await page.evaluate(() => {
    let rt=window.cr_getC2Runtime?.();
    let canvas=document.querySelector("canvas");
    return {
      bootStarted: !!rt, targetLayout: rt?.Xv, initialized:rt?.Ml,
      layouts:rt?.He?.map(x=>x.name), active: rt?.running_layout?.name,
      runtimeFlags:rt ? Object.keys(rt).filter(k=>/layout|ready|loading|start|progress/i.test(k)).slice(0,20) : [],
      canvas:{width:canvas?.width,height:canvas?.height},
      jsErrors:window.__mdzErrors?.slice(0,10),
      docs:document.body.textContent.slice(0,120)
    };
  });
  console.log("GAME STATE",JSON.stringify(state));
  final=state;
  await page.screenshot({path:"site/ci-menu-test.png",timeout:20000});
}
const picture=PNG.sync.read(fs.readFileSync("site/ci-menu-test.png"));
let uiPixels=0, area=0;
for(let y=120;y<picture.height-80;y+=3)for(let x=25;x<picture.width-25;x+=3){
  const off=(y*picture.width+x)*4,r=picture.data[off],g=picture.data[off+1],b=picture.data[off+2];
  area++;if(r<220||g<220||b<220)uiPixels++;
}
const uiRatio=uiPixels/Math.max(area,1);
console.log("VISUAL UI COVERAGE",uiRatio.toFixed(4));
console.log("ENGINE FLAGS",JSON.stringify(await page.evaluate(()=>{
 const r=window.cr_getC2Runtime?.();
 return {ij:r?.Ij,currentLayout:r?.wa?.name,engineProgress:r?.gd,readyCount:r?.uk?.filter(x=>x.src&&!x.complete&&!x.loaded).length,
   imgs:r?.uk?.length,frame:r?.Vd,clock:r?.Tl,canvasWidth:r?.width,canvasHeight:r?.height,textureGl:!!r?.H};
})));
await page.setViewportSize({width:844,height:390});
await page.waitForTimeout(5000);
const landscapeBuffer=await page.screenshot({path:"site/ci-landscape-menu.png",timeout:20000});
const land=PNG.sync.read(landscapeBuffer);
let painted=0, pixels=0;
for(let y=30;y<land.height-30;y+=3)for(let x=60;x<land.width-60;x+=3){
 const i=(y*land.width+x)*4;pixels++;
 if(land.data[i]<220||land.data[i+1]<220||land.data[i+2]<220)painted++;
}
const landscapeRatio=painted/Math.max(1,pixels);
console.log("LANDSCAPE UI COVERAGE",landscapeRatio.toFixed(4));
console.log("FAILED RESOURCES",resources.slice(0,35),"TOTAL",resources.length);
await browser.close();
if(errors.length || resources.length || !final.bootStarted || final.targetLayout!=="Menu" || final.initialized<0.99 || Math.max(uiRatio,landscapeRatio)<0.015) {
 throw Error("Game failed automated boot verification: "+JSON.stringify(final));
}
console.log("PASS: Construct 2 runtime started, forced real Menu layout, no script or resource errors");
