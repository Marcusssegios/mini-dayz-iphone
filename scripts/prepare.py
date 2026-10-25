#!/usr/bin/env python3
"""Build a clean Construct 2 web edition, starting directly in the real Menu layout."""
import io
import json
import re
import shutil
import urllib.request
import zipfile
from pathlib import Path

SOURCE = "https://raw.githubusercontent.com/DorinelMDZ/Mini-DayZ-IOS-PC/main/www.zip"
DEST = Path("site")
GAME = DEST / "go-v6"
if DEST.exists():
    shutil.rmtree(DEST)
GAME.mkdir(parents=True)
archive = urllib.request.urlopen(SOURCE, timeout=120).read()
with zipfile.ZipFile(io.BytesIO(archive)) as z:
    for entry in z.infolist():
        name = Path(entry.filename)
        if name.is_absolute() or ".." in name.parts:
            raise ValueError("Unsafe ZIP member: " + entry.filename)
        if name.parts and name.parts[0] != "www":
            raise ValueError("Unexpected archive structure: " + entry.filename)
        if entry.is_dir():
            continue
        target = GAME.joinpath(*name.parts[1:])
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(z.read(entry))

# Legacy dynamic UI audio was referenced but omitted from the archive.
# Reuse the source game's own compatible button-click sample.
for extension in ("ogg", "m4a"):
    source = GAME / "media" / ("empty_click." + extension)
    target = GAME / "media" / ("menu_click." + extension)
    if not source.is_file():
        raise RuntimeError("Missing native click sample: " + str(source))
    shutil.copyfile(source, target)

data_file = GAME / "data.js"
data = data_file.read_text(encoding="utf-8-sig")
# Construct 2 project[1] is the REAL start layout. "Loading" is an entire
# game layout whose transition to Menu depends on load events; skip it entirely.
replacement, count = re.subn(
    r'("project"\s*:\s*\[null\s*,\s*)"Loading"',
    r'\1"Menu"',
    data, count=1
)
if count != 1:
    raise RuntimeError("Unable to locate Construct 2 start layout")
# The original Menu waits for four legacy XML localization callbacks before drawing
# ANY buttons. On modern browsers those callbacks can stall, leaving only a logo.
# Execute that existing native Construct 2 menu initialization on layout start,
# while keeping the original drawing actions and controls.
model = json.loads(replacement)
menu_events = model["project"][6][1][1]
menu_open = menu_events[107]
if menu_open[0] != 0 or len(menu_open[6]) < 16:
    raise RuntimeError("Unexpected Menu_Events event data")
menu_open[5] = [[-1, 39, None, 1, False, False, False, 902026102500001, False]]
data_file.write_text(json.dumps(model, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print("Menu draw action now runs at layout startup (not gated by XML).")

index_file = GAME / "index.html"
html = index_file.read_text(encoding="utf-8-sig")
# Keep Construct 2 standard document-ready startup (no gated start button).
assert 'cr_createRuntime("c2canvas");' in html
# C2's service worker re-caches old broken files, so disable it BEFORE runtime.
boot = """<script>
window.C2_RegisterSW=function(){};
if ("serviceWorker" in navigator) {
 navigator.serviceWorker.getRegistrations().then(function(regs){
   regs.forEach(function(reg){reg.unregister();});
 }).catch(function(){});
}
window.__mdzErrors=[];
window.addEventListener("error",function(ev){
 window.__mdzErrors.push(String(ev.message || ev.target && ev.target.src || "resource error"));
},true);
window.addEventListener("unhandledrejection",function(ev){
 window.__mdzErrors.push(String(ev.reason));
});
// Real native Construct 2 menu recovery. No fake HTML menu or overlay.
(function(){
 var armedAt=0, attempts=0, timer;
 function ensure(){
   var rt=window.cr_getC2Runtime && window.cr_getC2Runtime();
   if(!rt || rt.Ij || !rt.wa || rt.wa.name!=="Menu" || typeof window.c2_callFunction!=="function")return;
   var existing=rt.S && rt.S[630] && rt.S[630].q && rt.S[630].q.length || 0;
   if(existing){window.__mdzMenuDrawn=existing;clearInterval(timer);return;}
   if(!armedAt){armedAt=Date.now();return;}
   if(Date.now()-armedAt<1600 || attempts>=4)return;
   attempts++;
   try {
     window.c2_callFunction("Device_check",[]);
     window.c2_callFunction("menu_draw_main",[]);
     var drawn=rt.S && rt.S[630] && rt.S[630].q && rt.S[630].q.length || 0;
     window.__mdzMenuDrawn=drawn;
     if(drawn)clearInterval(timer);
   }catch(err){window.__mdzErrors.push("Menu repair: "+String(err));}
   armedAt=Date.now();
 }
 timer=setInterval(ensure,350);
})();
</script>"""
html = html.replace('<script src="jquery-3.4.1.min.js"></script>', boot + '\n<script src="jquery-3.4.1.min.js"></script>', 1)
# Completely remove the registration function inside original index to avoid
# overriding our no-op and preserve the initial unmodified startup script.
sw_pattern = r'window\.C2_RegisterSW\s*=\s*function C2_RegisterSW\(\)\s*\{[\s\S]*?\n\s*\};'
html, sw_count = re.subn(sw_pattern, 'window.C2_RegisterSW = function(){};', html, count=1)
if sw_count != 1:
    raise RuntimeError("Original service worker registration not found")
index_file.write_text(html, encoding="utf-8")

# Fresh path is not controlled by prior /mini-dayz-iphone/ SW offline manifest.
(DEST / "index.html").write_text(
    '<!doctype html><html><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width,initial-scale=1">'
    '<meta http-equiv="refresh" content="0; url=go-v6/index.html">'
    '</head><body><a href="go-v6/index.html">Abrir Mini DayZ</a></body></html>',
    encoding="utf-8"
)
(DEST / ".nojekyll").touch()
print("Game files:", len(list(GAME.rglob("*"))))
print("Forced initial Construct 2 layout: Menu")
print("Disabled SW; normal engine startup restored.")
