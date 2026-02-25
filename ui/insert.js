"use strict";

const marker = "__REPLACE_ME__";
const oldMarker = "__REPLACEME__";

let prefs = null;
let tabId = null;
let formulaHistory = [];
let saveDialogSizeTimer = null;

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

async function getFormulaHistory(tabIdValue) {
  if (!tabIdValue && tabIdValue !== 0) {
    return [];
  }

  try {
    const history = await browser.tabs.sendMessage(tabIdValue, {
      command: "getFormulaHistory",
    });
    return Array.isArray(history) ? history : [];
  } catch (error) {
    return [];
  }
}

function truncatePreview(value) {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 110) {
    return normalized;
  }
  return `${normalized.slice(0, 107)}...`;
}

function formatHistoryItem(item) {
  const mode = item && item.sourceMode === "inline" ? "Inline" : "Complex";
  const rawPreview =
    (item && item.preview) ||
    (item && item.sourceExpression) ||
    (item && item.sourceDocument) ||
    "";
  const preview = truncatePreview(rawPreview) || "(empty)";
  return `[${mode}] ${preview}`;
}

function renderFormulaHistory() {
  const list = document.getElementById("formulaHistory");
  const loadButton = document.getElementById("loadHistory");
  const historySection = document.getElementById("historySection");

  while (list.firstChild) {
    list.removeChild(list.firstChild);
  }

  formulaHistory.forEach((item, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = formatHistoryItem(item);
    list.appendChild(option);
  });

  const hasItems = formulaHistory.length > 0;
  list.disabled = !hasItems;
  loadButton.disabled = !hasItems;
  historySection.hidden = !hasItems;
  if (hasItems) {
    list.selectedIndex = 0;
  }
}

function getSelectedHistoryEntry() {
  const list = document.getElementById("formulaHistory");
  const index = Number.parseInt(list.value, 10);
  if (!Number.isInteger(index) || index < 0 || index >= formulaHistory.length) {
    return null;
  }
  return formulaHistory[index];
}

function applySeedToEditor(seed) {
  const sourceDocument = (seed && (seed.sourceDocument || seed.complexSource)) || "";
  if (sourceDocument) {
    showComplexSource(sourceDocument);
    return;
  }

  if (seed && seed.sourceExpression) {
    populateTemplate((prefs && prefs.template) || "", seed.sourceExpression);
    return;
  }

  populateTemplate((prefs && prefs.template) || "", (seed && seed.selection) || "");
}

async function refreshFormulaHistory() {
  if (tabId === null) {
    return;
  }
  formulaHistory = await getFormulaHistory(tabId);
  renderFormulaHistory();
}

function loadSelectedHistoryFormula() {
  const entry = getSelectedHistoryEntry();
  if (!entry) {
    setStatus("Select a formula from history first.");
    return;
  }

  applySeedToEditor(entry);
  setStatus("Loaded formula from history.");
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

  const [seed, history] = await Promise.all([
    getSelection(tabId),
    getFormulaHistory(tabId),
  ]);

  formulaHistory = history;
  renderFormulaHistory();
  applySeedToEditor(seed);
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

async function saveCurrentDialogSize() {
  try {
    const currentWindow = await browser.windows.getCurrent();
    if (!currentWindow) {
      return;
    }
    await browser.runtime.sendMessage({
      command: "saveInsertDialogSize",
      width: currentWindow.width,
      height: currentWindow.height,
    });
  } catch (error) {
    // Non-fatal in case the window API is unavailable.
  }
}

function scheduleDialogSizeSave() {
  if (saveDialogSizeTimer !== null) {
    clearTimeout(saveDialogSizeTimer);
  }
  saveDialogSizeTimer = setTimeout(() => {
    saveDialogSizeTimer = null;
    saveCurrentDialogSize().catch(() => {});
  }, 350);
}

document.getElementById("insert").addEventListener("click", () => {
  insertExpression().catch((error) => {
    setStatus(`Insert failed: ${String(error)}`);
  });
});

document.getElementById("cancel").addEventListener("click", () => {
  window.close();
});

document.getElementById("resetTemplate").addEventListener("click", () => {
  if (prefs) {
    populateTemplate(prefs.template, "");
  }
});

document.getElementById("loadHistory").addEventListener("click", () => {
  loadSelectedHistoryFormula();
});

document.getElementById("refreshHistory").addEventListener("click", () => {
  refreshFormulaHistory().catch((error) => {
    setStatus(`History refresh failed: ${String(error)}`);
  });
});

document.getElementById("formulaHistory").addEventListener("dblclick", () => {
  loadSelectedHistoryFormula();
});

document.getElementById("autodpi").addEventListener("change", () => {
  updateAutodpiUi();
});

window.addEventListener("resize", () => {
  scheduleDialogSizeSave();
});

window.addEventListener("beforeunload", () => {
  if (saveDialogSizeTimer !== null) {
    clearTimeout(saveDialogSizeTimer);
    saveDialogSizeTimer = null;
  }
  saveCurrentDialogSize().catch(() => {});
});

load()
  .then(() => {
    updateAutodpiUi();
  })
  .catch((error) => {
    setStatus(`Unable to initialize dialog: ${String(error)}`);
  });
