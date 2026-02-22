"use strict";

const FIELDS = [
  "latexPath",
  "dvipngPath",
  "helperFallbackEnabled",
  "helperUrl",
  "autodpi",
  "fontPx",
  "renderScale",
  "log",
  "debug",
  "warnOnUnconvertedLatex",
  "keepTempFiles",
  "template",
];

const NUMBER_DEFAULTS = Object.freeze({
  fontPx: 16,
  renderScale: 4,
});

function setStatus(message) {
  document.getElementById("status").textContent = message;
}

function applyPrefsToForm(prefs) {
  for (const name of FIELDS) {
    const element = document.getElementById(name);
    if (!element) {
      continue;
    }

    if (element.type === "checkbox") {
      element.checked = Boolean(prefs[name]);
    } else {
      element.value = prefs[name] ?? "";
    }
  }
}

function readPrefsFromForm() {
  const prefs = {};

  for (const name of FIELDS) {
    const element = document.getElementById(name);
    if (!element) {
      continue;
    }

    if (element.type === "checkbox") {
      prefs[name] = element.checked;
    } else if (element.type === "number") {
      const parsed = Number(element.value);
      const fallback = NUMBER_DEFAULTS[name] ?? 1;
      let value = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
      if (name === "renderScale") {
        value = Math.min(8, Math.max(1, value));
      }
      prefs[name] = value;
    } else {
      prefs[name] = element.value ?? "";
    }
  }

  return prefs;
}

async function loadPrefs() {
  const prefs = await browser.runtime.sendMessage({ command: "getPrefs" });
  applyPrefsToForm(prefs);
}

async function savePrefs() {
  const prefs = readPrefsFromForm();
  await browser.runtime.sendMessage({ command: "setPrefs", prefs });
  setStatus("Options saved.");
}

async function resetPrefs() {
  const prefs = await browser.runtime.sendMessage({ command: "resetPrefs" });
  applyPrefsToForm(prefs);
  setStatus("Options reset to defaults.");
}

async function autodetect() {
  const prefs = await browser.runtime.sendMessage({ command: "autodetectPaths" });
  applyPrefsToForm(prefs);

  const found = [];
  if (prefs.latexPath) {
    found.push("latex");
  }
  if (prefs.dvipngPath) {
    found.push("dvipng");
  }
  if (found.length) {
    setStatus(`Autodetect complete: found ${found.join(" and ")}.`);
  } else {
    setStatus("Autodetect did not find latex or dvipng in PATH.");
  }
}

async function updateRuntimeInfo() {
  const runtimeInfoElement = document.getElementById("runtimeInfo");
  try {
    const runtimeInfo = await browser.runtime.sendMessage({ command: "getRuntimeInfo" });
    if (runtimeInfo && runtimeInfo.sandboxed) {
      runtimeInfoElement.textContent = `Runtime: sandboxed (${runtimeInfo.sandboxType}). Helper fallback is recommended.`;
    } else {
      runtimeInfoElement.textContent = "Runtime: not sandboxed. Helper fallback is optional.";
    }
  } catch (error) {
    runtimeInfoElement.textContent = `Runtime: unavailable (${String(error)})`;
  }
}

async function testHelper() {
  const prefs = readPrefsFromForm();
  await browser.runtime.sendMessage({
    command: "setPrefs",
    prefs: {
      helperUrl: prefs.helperUrl,
      helperFallbackEnabled: prefs.helperFallbackEnabled,
    },
  });

  const status = await browser.runtime.sendMessage({ command: "testHelper" });
  if (status && status.ok) {
    setStatus(`Helper reachable at ${status.url}.`);
  } else {
    setStatus(`Helper unreachable at ${(status && status.url) || "configured URL"}.`);
  }
}

document.getElementById("save").addEventListener("click", () => {
  savePrefs().catch((error) => {
    setStatus(`Save failed: ${String(error)}`);
  });
});

document.getElementById("reset").addEventListener("click", () => {
  resetPrefs().catch((error) => {
    setStatus(`Reset failed: ${String(error)}`);
  });
});

document.getElementById("autodetect").addEventListener("click", () => {
  autodetect().catch((error) => {
    setStatus(`Autodetect failed: ${String(error)}`);
  });
});

document.getElementById("testHelper").addEventListener("click", () => {
  testHelper().catch((error) => {
    setStatus(`Helper test failed: ${String(error)}`);
  });
});

Promise.all([loadPrefs(), updateRuntimeInfo()]).catch((error) => {
  setStatus(`Unable to load options: ${String(error)}`);
});
