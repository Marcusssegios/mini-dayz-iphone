#!/usr/bin/env python3
"""Build a clean Construct 2 web edition, starting directly in the real Menu layout."""
import io
import json
import re
import subprocess
import shutil
import urllib.request
import zipfile
from xml.etree import ElementTree
from pathlib import Path

SOURCE = "https://raw.githubusercontent.com/DorinelMDZ/Mini-DayZ-IOS-PC/main/www.zip"
DEST = Path("site")
GAME = DEST / "go-v9"
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

# iOS Safari commonly selects AAC/M4A. The original archive omits many
# M4A counterparts, leaving footsteps, attacks and ambient sounds silent.
# Produce BOTH codec variants for every source audio stem.
ffmpeg = shutil.which("ffmpeg")
if not ffmpeg:
    raise RuntimeError("ffmpeg is required to restore missing Safari audio")
audio_dir = GAME / "media"
converted = []
for source in sorted(audio_dir.iterdir()):
    if source.suffix.lower() not in (".ogg", ".m4a"):
        continue
    other = source.with_suffix(".m4a" if source.suffix.lower() == ".ogg" else ".ogg")
    if other.exists():
        continue
    if source.suffix.lower() == ".ogg":
        command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
                   "-i", str(source), "-vn", "-c:a", "aac", "-b:a", "112k",
                   "-movflags", "+faststart", str(other)]
    else:
        command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
                   "-i", str(source), "-vn", "-c:a", "libvorbis", "-q:a", "4",
                   str(other)]
    subprocess.run(command, check=True, timeout=90)
    if not other.is_file() or other.stat().st_size < 100:
        raise RuntimeError("Conversion failed: " + str(other))
    converted.append(other.name)
print("Restored missing audio codec variants:", len(converted))
assert all(p.with_suffix(".m4a").is_file() and p.with_suffix(".ogg").is_file()
           for p in audio_dir.glob("*.ogg"))

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
# The Loading layout also downloaded the four XML dictionaries. Bypassing
# Loading prevented the text lookup objects from ever being initialized, so
# all text IDs were rendered as "0". Start the same AJAX requests on Menu start.
menu_start = menu_events[99][7][0][7][0]
if menu_start[5][0][1] != 39:
    raise RuntimeError("Menu start event signature changed")
xml_loads = [
    [232,420,None,902026102510001,False,[[1,[2,"Local"]],[12,"l_eng_items.xml"]]],
    [232,420,None,902026102510002,False,[[1,[2,"Local_ui"]],[12,"l_eng_ui.xml"]]],
    [232,420,None,902026102510003,False,[[1,[2,"Local_logs"]],[12,"l_eng_log.xml"]]],
    [232,420,None,902026102510004,False,[[1,[2,"Local_new"]],[12,"l_eng_new.xml"]]]
]
menu_start[6][0:0] = xml_loads
data_file.write_text(json.dumps(model, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print("Four English XML localization dictionaries requested on Menu start.")
print("Menu draw action now runs at layout startup (not gated by XML).")

# Safari/WebKit may download XML successfully while its legacy XPath plugin
# leaves Construct 2's localization arrays empty. Provide an independent
# parsed dictionary fallback for every item/UI/log/description string.
translations = {}
for type_id, filename, element_tag in [
    (540, "l_eng_items.xml", "item"),
    (543, "l_eng_ui.xml", "text"),
    (544, "l_eng_log.xml", "text"),
    (911, "l_eng_new.xml", "text"),
]:
    root = ElementTree.parse(GAME / filename).getroot()
    entries = {}
    for element in root.findall(element_tag):
        raw_id = element.findtext("id")
        value = element.findtext("name")
        if raw_id is None or not raw_id.strip().isdigit() or not value:
            continue
        number = int(raw_id.strip())
        if number < 800:
            entries[number] = value
    if not entries:
        raise RuntimeError("No translations in " + filename)
    translations[type_id] = entries
    print("Localization entries", filename, len(entries))

fallback = """(function(){
  "use strict";
  var dictionary = __LOCALIZATION__;
  var ticks=0;
  function restore(){
    var rt=window.cr_getC2Runtime && window.cr_getC2Runtime();
    if(!rt || !rt.S)return;
    var status={}, allReady=true;
    Object.keys(dictionary).forEach(function(key){
      var obj=rt.S[Number(key)] && rt.S[Number(key)].q && rt.S[Number(key)].q[0];
      var values=dictionary[key];
      if(!obj || !Array.isArray(obj.rd)){allReady=false;return;}
      var changed=0;
      Object.keys(values).forEach(function(index){
        var cell=obj.rd[Number(index)];
        if(!cell || !cell[0])return;
        var previous=cell[0][0];
        if(previous===0 || previous==="0" || previous==="" || previous==null){
          cell[0][0]=values[index];
          changed++;
        }
      });
      status[key]={changed:changed,sample:obj.rd[1] && obj.rd[1][0] && obj.rd[1][0][0]};
      if(typeof status[key].sample!=="string" || !status[key].sample)allReady=false;
    });
    window.__mdzLocaleStatus=status;
    window.__mdzLocaleReady=allReady;
    ticks++;
  }
  // Repair after every language reload too; do not replace valid nonempty text.
  setInterval(restore,500);
  restore();
})();""".replace("__LOCALIZATION__", json.dumps(translations, ensure_ascii=False, separators=(",", ":")))
(GAME / "localization-fix.js").write_text(fallback, encoding="utf-8")

(GAME / "audio-fix.js").write_text("(function () {\n  \"use strict\";\n  // Capture the Web Audio contexts Construct 2 creates so they can be\n  // resumed synchronously during a trusted iPhone touch.\n  var contexts = [];\n  window.__mdzAudioContexts = contexts;\n  window.__mdzAudioUnlocks = 0;\n  window.__mdzAudioErrors = [];\n  function wrapConstructor(name) {\n    var Native = window[name];\n    if (typeof Native !== \"function\" || Native.__mdzWrapped) return;\n    function Wrapped() {\n      var instance = Reflect.construct(Native, Array.prototype.slice.call(arguments));\n      if (contexts.indexOf(instance) < 0) contexts.push(instance);\n      return instance;\n    }\n    Wrapped.prototype = Native.prototype;\n    try { Object.setPrototypeOf(Wrapped, Native); } catch (e) {}\n    Wrapped.__mdzWrapped = true;\n    window[name] = Wrapped;\n  }\n  wrapConstructor(\"AudioContext\");\n  wrapConstructor(\"webkitAudioContext\");\n\n  function unlock() {\n    window.__mdzAudioUnlocks++;\n    contexts.forEach(function (ctx) {\n      try {\n        if (ctx.state !== \"running\" && typeof ctx.resume === \"function\") {\n          var result = ctx.resume();\n          if (result && result.catch) result.catch(function (err) {\n            window.__mdzAudioErrors.push(String(err));\n          });\n        }\n        if (!ctx.__mdzPrimed) {\n          var buffer = ctx.createBuffer(1, 1, ctx.sampleRate || 44100);\n          var src = ctx.createBufferSource();\n          src.buffer = buffer;\n          src.connect(ctx.destination);\n          src.start(0);\n          ctx.__mdzPrimed = true;\n        }\n      } catch (err) {\n        window.__mdzAudioErrors.push(String(err));\n      }\n    });\n    updateButton();\n  }\n  [\"touchstart\", \"touchend\", \"pointerdown\", \"click\", \"keydown\"].forEach(function (eventName) {\n    document.addEventListener(eventName, unlock, {capture:true, passive:true});\n  });\n\n  var button = null;\n  function updateButton() {\n    if (!button) return;\n    var needsUnlock = contexts.some(function (ctx) { return ctx.state !== \"running\"; });\n    button.style.display = needsUnlock ? \"block\" : \"none\";\n  }\n  function showUnlockButton() {\n    if (!document.body || button) return;\n    button = document.createElement(\"button\");\n    button.type = \"button\";\n    button.id = \"mdz-audio-unlock\";\n    button.textContent = \"🔊 Activar sonido\";\n    button.style.cssText = \"position:fixed;top:10px;right:10px;z-index:2147483640;background:#1b3120;color:#fff;border:2px solid #9dd47d;border-radius:9px;padding:10px;font:bold 14px Arial,sans-serif\";\n    button.addEventListener(\"touchstart\", unlock, {passive:true});\n    button.addEventListener(\"click\", unlock);\n    document.body.appendChild(button);\n    updateButton();\n  }\n  document.addEventListener(\"DOMContentLoaded\", function () {\n    setTimeout(showUnlockButton, 3500);\n    setInterval(updateButton, 1200);\n  });\n})();", encoding="utf-8")

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
html = html.replace('<script src="jquery-3.4.1.min.js"></script>', boot + '\n<script src="audio-fix.js"></script>\n<script src="localization-fix.js"></script>\n<script src="jquery-3.4.1.min.js"></script>', 1)
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
    '<meta http-equiv="refresh" content="0; url=go-v9/index.html">'
    '</head><body><a href="go-v9/index.html">Abrir Mini DayZ</a></body></html>',
    encoding="utf-8"
)
(DEST / ".nojekyll").touch()
print("Game files:", len(list(GAME.rglob("*"))))
print("Forced initial Construct 2 layout: Menu")
print("Disabled SW; normal engine startup restored.")
