(function () {
  "use strict";

  // Mini DayZ uses Construct 2 WebAudio. iOS may suspend it after leaving
  // Safari, restoring a tab, or returning to an installed home-screen app.
  var contexts = [];
  var errors = [];
  var button = null;
  var repairCount = 0;
  var testCount = 0;
  var lastRecovery = "";
  var lastGesture = 0;
  window.__mdzAudioContexts = contexts;
  window.__mdzAudioErrors = errors;
  window.__mdzAudioUnlocks = 0;

  function runtime() {
    return typeof window.cr_getC2Runtime === "function"
      ? window.cr_getC2Runtime() : null;
  }
  function alive() {
    return contexts.filter(function (ctx) { return ctx.state !== "closed"; });
  }
  function getStatus() {
    var rt = runtime();
    var audio = rt && rt.aj;
    var settings = null;
    try { if (audio && audio.Fa) settings = audio.Fa(); } catch (err) {}
    return {
      states: contexts.map(function (ctx) { return ctx.state; }),
      active: alive().length,
      gameSuspended: !!(rt && rt.sl),
      silent: settings && settings.silent,
      masterVolume: settings && settings.masterVolume,
      repairs: repairCount,
      tests: testCount,
      lastRecovery: lastRecovery,
      errors: errors.slice(-5)
    };
  }
  window.__mdzAudioStatus = getStatus;

  function wrapConstructor(name) {
    var Native = window[name];
    if (typeof Native !== "function" || Native.__mdzWrapped) return;
    function Wrapped() {
      var instance = Reflect.construct(Native, Array.prototype.slice.call(arguments));
      if (contexts.indexOf(instance) === -1) {
        contexts.push(instance);
        if (instance.addEventListener) {
          instance.addEventListener("statechange", updateButton);
        }
      }
      return instance;
    }
    Wrapped.prototype = Native.prototype;
    try { Object.setPrototypeOf(Wrapped, Native); } catch (err) {}
    Wrapped.__mdzWrapped = true;
    window[name] = Wrapped;
  }
  wrapConstructor("AudioContext");
  wrapConstructor("webkitAudioContext");

  function resumeEngine() {
    var rt = runtime();
    if (!rt || !rt.aj || document.hidden) return;
    try {
      if (rt.sl && typeof rt.setSuspended === "function") {
        rt.setSuspended(false);
      }
      // The game's own Audio plugin has a separate pause flag in addition
      // to AudioContext.state. Re-enable its playback instances too.
      if (typeof rt.aj.uG === "function") rt.aj.uG(false);
    } catch (err) {
      errors.push("Construct 2 resume: " + String(err));
    }
  }

  function unmuteFromExplicitButton() {
    var rt = runtime();
    var plugin = rt && rt.aj;
    if (!plugin) return;
    try {
      var state = plugin.Fa && plugin.Fa();
      var acts = plugin.type && plugin.type.plugin && plugin.type.plugin.n;
      if (state && acts && state.silent && typeof acts.zC === "function") {
        acts.zC.call(plugin, 1); // 1 = unmute, not toggle
      }
      if (state && acts && state.masterVolume === 0 && typeof acts.mC === "function") {
        acts.mC.call(plugin, 0); // 0 dB = normal volume
      }
    } catch (err) {
      errors.push("Unmute: " + String(err));
    }
  }

  function prime(ctx) {
    if (ctx.__mdzPrimed || ctx.state === "closed") return;
    try {
      var buffer = ctx.createBuffer(1, 1, ctx.sampleRate || 44100);
      var source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
      ctx.__mdzPrimed = true;
    } catch (err) {
      errors.push("Prime: " + String(err));
    }
  }

  function testTone(ctx) {
    if (!ctx || ctx.state === "closed") return;
    try {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 720;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.075, ctx.currentTime + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.2);
      testCount++;
    } catch (err) {
      errors.push("Test tone: " + String(err));
    }
  }

  function recover(reason, explicit) {
    if (document.hidden) return;
    repairCount++;
    lastRecovery = reason;
    resumeEngine();
    if (explicit) unmuteFromExplicitButton();
    alive().forEach(function (ctx) {
      try {
        if (ctx.state !== "running" && typeof ctx.resume === "function") {
          var result = ctx.resume();
          if (result && typeof result.then === "function") {
            result.then(updateButton, function (err) {
              errors.push("Resume: " + String(err));
              updateButton();
            });
          }
        }
        prime(ctx);
      } catch (err) {
        errors.push("Audio recovery: " + String(err));
      }
    });
    if (explicit) {
      var active = alive();
      if (active.length) testTone(active[active.length - 1]);
    }
    updateButton();
  }
  window.__mdzRecoverAudio = function () { recover("manual", true); };

  function onGesture(event) {
    var target = event && event.target;
    var isButton = !!(target && (
      target.id === "mdz-audio-unlock" ||
      (target.closest && target.closest("#mdz-audio-unlock"))
    ));
    var now = Date.now();
    window.__mdzAudioUnlocks++;
    if (isButton) {
      // Construct 2 listens on document in the capture phase and may consume
      // the click before it reaches a normal button listener. Handle it HERE,
      // registered before c2runtime.js, directly in the trusted user gesture.
      if (now - lastGesture > 400) {
        lastGesture = now;
        recover("button-capture", true);
      }
      if (event.cancelable) event.preventDefault();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      return;
    }
    recover("touch", false);
  }
  ["touchstart", "touchend", "pointerdown", "pointerup", "click", "keydown"].forEach(function (name) {
    document.addEventListener(name, onGesture, { capture: true, passive: true });
  });

  function onForeground(reason) {
    if (document.hidden) return;
    recover(reason, false);
    // Safari sometimes restores the AudioContext asynchronously after pageshow.
    setTimeout(function () { recover(reason + "-delayed", false); }, 400);
    setTimeout(function () { recover(reason + "-retry", false); }, 1600);
  }
  window.addEventListener("pageshow", function (event) {
    onForeground(event.persisted ? "bfcache-pageshow" : "pageshow");
  });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) onForeground("visibilitychange");
  });
  window.addEventListener("focus", function () { onForeground("focus"); });

  function updateButton() {
    if (!button) return;
    var status = getStatus();
    // Keep the control available even when the context says "running":
    // a running context can still be disconnected from Construct 2 playback.
    button.textContent = status.states.some(function (s) { return s === "suspended"; })
      ? "🔊 Activar sonido" : "🔊 Sonido";
    button.title = "Reactivar el audio del juego y reproducir un tono de prueba";
    button.dataset.audioStates = status.states.join(",");
  }

  function mount() {
    if (button || !document.body) return;
    button = document.createElement("button");
    button.type = "button";
    button.id = "mdz-audio-unlock";
    button.textContent = "🔊 Sonido";
    button.setAttribute("aria-label", "Reparar sonido y escuchar prueba");
    button.style.cssText = [
      "position:fixed", "top:8px", "right:8px",
      "z-index:2147483640", "background:#19321f",
      "color:#fff", "border:1px solid #8bc578", "border-radius:8px",
      "padding:7px 10px", "font:bold 12px Arial,sans-serif",
      "touch-action:manipulation", "opacity:.94"
    ].join(";");
    button.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      recover("button", true);
    });
    document.body.appendChild(button);
    updateButton();
    setInterval(updateButton, 2000);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();