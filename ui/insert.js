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
    return {
      selection: "",
      sourceMode: "",
      sourceExpression: "",
      sourceDocument: "",
      complexSource: "",
    };
  }

  try {
    const seed = await browser.tabs.sendMessage(tabIdValue, {
      command: "getInsertComplexSeed",
    });

    if (seed && typeof seed === "object") {
      return {
        selection: typeof seed.selection === "string" ? seed.selection : "",
        sourceMode: typeof seed.sourceMode === "string" ? seed.sourceMode : "",
        sourceExpression:
          typeof seed.sourceExpression === "string" ? seed.sourceExpression : "",
        sourceDocument: typeof seed.sourceDocument === "string" ? seed.sourceDocument : "",
        complexSource: typeof seed.complexSource === "string" ? seed.complexSource : "",
      };
    }
  } catch (error) {
    // Fall back to legacy selection command below.
  }

  try {
    const selection = await browser.tabs.sendMessage(tabIdValue, { command: "getSelection" });
    return {
      selection: typeof selection === "string" ? selection : "",
      sourceMode: "",
      sourceExpression: "",
      sourceDocument: "",
      complexSource: "",
    };
  } catch (error) {
    return {
      selection: "",
      sourceMode: "",
      sourceExpression: "",
      sourceDocument: "",
      complexSource: "",
    };
  }
}

function showComplexSource(source) {
  const textarea = document.getElementById("latexExpression");
  textarea.value = source;
  textarea.focus();

  let start = source.indexOf(marker);
  let length = marker.length;
  if (start < 0) {
    start = source.indexOf(oldMarker);
    length = oldMarker.length;
  }

  if (start >= 0) {
    textarea.setSelectionRange(start, start + length);
    return;
  }

  const end = source.length;
  textarea.setSelectionRange(end, end);
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

  const seed = await getSelection(tabId);
  const sourceDocument = seed.sourceDocument || seed.complexSource || "";
  if (sourceDocument) {
    showComplexSource(sourceDocument);
  } else if (seed.sourceExpression) {
    populateTemplate(prefs.template, seed.sourceExpression);
  } else {
    populateTemplate(prefs.template, seed.selection);
  }
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
