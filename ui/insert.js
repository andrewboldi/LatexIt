"use strict";

const marker = "__REPLACE_ME__";
const oldMarker = "__REPLACEME__";

let prefs = null;
let tabId = null;

function setStatus(message) {
  document.getElementById("status").textContent = message;
}

function getTabIdFromUrl() {
  const search = new URLSearchParams(window.location.search);
  const raw = search.get("tabId");
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
}

function populateTemplate(template, selection) {
  const textarea = document.getElementById("latexExpression");

  let start = template.indexOf(marker);
  let token = marker;
  if (start < 0) {
    start = template.indexOf(oldMarker);
    token = oldMarker;
  }

  let output = template;
  if (start >= 0) {
    if (selection) {
      output = template.slice(0, start) + selection + template.slice(start + token.length);
      textarea.value = output;
      textarea.focus();
      textarea.setSelectionRange(start, start + selection.length);
      return;
    }

    output =
      template.slice(0, start) +
      "$" +
      template.slice(start, start + token.length) +
      "$" +
      template.slice(start + token.length);
    start += 1;
    textarea.value = output;
    textarea.focus();
    textarea.setSelectionRange(start, start + token.length);
    return;
  }

  textarea.value = output;
}

async function getSelection(tabIdValue) {
  if (!tabIdValue && tabIdValue !== 0) {
    return "";
  }

  try {
    const selection = await browser.tabs.sendMessage(tabIdValue, { command: "getSelection" });
    return typeof selection === "string" ? selection : "";
  } catch (error) {
    return "";
  }
}

async function load() {
  tabId = getTabIdFromUrl();
  if (tabId === null) {
    setStatus("Could not identify compose tab.");
    return;
  }

  prefs = await browser.runtime.sendMessage({ command: "getPrefs" });
  document.getElementById("autodpi").checked = Boolean(prefs.autodpi);
  document.getElementById("fontPx").value = Number(prefs.fontPx) || 16;

  const selection = await getSelection(tabId);
  populateTemplate(prefs.template, selection);
}

function updateAutodpiUi() {
  const autodpi = document.getElementById("autodpi").checked;
  document.getElementById("fontPx").disabled = autodpi;
}

async function insertExpression() {
  if (tabId === null) {
    setStatus("No compose tab is attached to this dialog.");
    return;
  }

  const latexExpression = document.getElementById("latexExpression").value;
  const autodpi = document.getElementById("autodpi").checked;
  const fontPx = Number(document.getElementById("fontPx").value) || 16;

  try {
    const result = await browser.tabs.sendMessage(tabId, {
      command: "insertComplex",
      latexExpression,
      autodpi,
      fontPx,
    });

    if (result && result.ok) {
      window.close();
      return;
    }

    setStatus(`Insert failed: ${(result && result.error) || "unknown error"}`);
  } catch (error) {
    setStatus(`Insert failed: ${String(error)}`);
  }
}

document.getElementById("insert").addEventListener("click", () => {
  insertExpression().catch((error) => {
    setStatus(`Insert failed: ${String(error)}`);
  });
});

document.getElementById("resetTemplate").addEventListener("click", () => {
  if (prefs) {
    populateTemplate(prefs.template, "");
  }
});

document.getElementById("autodpi").addEventListener("change", () => {
  updateAutodpiUi();
});

load()
  .then(() => {
    updateAutodpiUi();
  })
  .catch((error) => {
    setStatus(`Unable to initialize dialog: ${String(error)}`);
  });
