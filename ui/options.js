"use strict";

const FIELDS = [
  "latexPath",
  "dvipngPath",
  "autodpi",
  "fontPx",
  "log",
  "debug",
  "keepTempFiles",
  "template",
];

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
      prefs[name] = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 16;
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

loadPrefs().catch((error) => {
  setStatus(`Unable to load options: ${String(error)}`);
});
