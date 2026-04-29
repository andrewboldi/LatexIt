"use strict";

const LOG_PANEL_ID = "tblatex-log";
const LATEX_PATTERN = /\$\$[^\$]+\$\$|\$[^\$]+\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)/g;
const INLINE_LATEX_EXACT_PATTERN = /^(?:\$\$[^\$]+\$\$|\$[^\$]+\$|\\\[[\s\S]*\\\]|\\\([\s\S]*\\\))$/;
const FORMULA_HISTORY_LIMIT = 50;

let undoStack = [];
let lastComplexExpression = "";
let formulaHistory = [];
let formulaHistoryHydrated = false;
let formulaHistorySyncTimer = null;

function insertAfter(nodeToInsert, referenceNode) {
  const parentNode = referenceNode.parentNode;
  if (!parentNode) {
    return;
  }

  if (referenceNode.nextSibling) {
    parentNode.insertBefore(nodeToInsert, referenceNode.nextSibling);
  } else {
    parentNode.appendChild(nodeToInsert);
  }
}

function splitTextNodes(node) {
  let latexNodes = [];

  if (node.nodeType === Node.TEXT_NODE) {
    const matches = node.nodeValue.match(LATEX_PATTERN);
    if (matches && matches.length) {
      for (let i = matches.length - 1; i >= 0; i--) {
        const match = matches[i];
        const start = node.nodeValue.lastIndexOf(match);
        const end = start + match.length;

        const trailing = node.ownerDocument.createTextNode(node.nodeValue.slice(end));
        insertAfter(trailing, node);

        const latexNode = node.ownerDocument.createTextNode(match);
        insertAfter(latexNode, node);
        latexNodes.push(latexNode);

        node.nodeValue = node.nodeValue.slice(0, start);
      }
    }
    return latexNodes;
  }

  if (
    node.nodeType !== Node.ELEMENT_NODE ||
    node.id === LOG_PANEL_ID ||
    node.tagName === "SCRIPT" ||
    node.tagName === "STYLE" ||
    node.tagName === "IMG"
  ) {
    return latexNodes;
  }

  if (node.childNodes && node.childNodes.length) {
    for (let i = node.childNodes.length - 1; i >= 0; i--) {
      const current = node.childNodes[i];
      const previous = i > 0 ? node.childNodes[i - 1] : null;

      if (
        previous &&
        previous.nodeType === Node.TEXT_NODE &&
        current.nodeType === Node.TEXT_NODE
      ) {
        previous.nodeValue += current.nodeValue;
        current.nodeValue = "";
        continue;
      }

      latexNodes = latexNodes.concat(splitTextNodes(current));
    }
  }

  return latexNodes;
}

function findTemplateMarker(template) {
  const marker = "__REPLACE_ME__";
  const oldMarker = "__REPLACEME__";

  let index = template.indexOf(marker);
  let markerLength = marker.length;

  if (index < 0) {
    index = template.indexOf(oldMarker);
    markerLength = oldMarker.length;
  }

  if (index < 0) {
    return null;
  }

  return { index, markerLength };
}

function replaceMarker(template, replacement) {
  const markerInfo = findTemplateMarker(template);

  if (!markerInfo) {
    const log =
      "!!! Could not find the placeholder '__REPLACE_ME__' in your template.\n" +
      "Please add it where your LaTeX expression should be inserted.\n";
    return [null, log];
  }

  const { index, markerLength } = markerInfo;
  const output =
    template.slice(0, index) + replacement + template.slice(index + markerLength);
  return [output, ""];
}

function extractExpressionFromTemplate(template, latexDocument) {
  if (typeof template !== "string" || typeof latexDocument !== "string") {
    return "";
  }

  const markerInfo = findTemplateMarker(template);
  if (!markerInfo) {
    return "";
  }

  const prefix = template.slice(0, markerInfo.index);
  const suffix = template.slice(markerInfo.index + markerInfo.markerLength);
  if (!latexDocument.startsWith(prefix) || !latexDocument.endsWith(suffix)) {
    return "";
  }

  const expression = latexDocument.slice(prefix.length, latexDocument.length - suffix.length);
  return INLINE_LATEX_EXACT_PATTERN.test(expression.trim()) ? expression : "";
}

function normalizeColor(color) {
  const match = color.match(/rgba?\(([^)]+)\)/i);
  if (!match) {
    return "RGB 0 0 0";
  }

  const parts = match[1]
    .split(",")
    .slice(0, 3)
    .map((part) => part.trim());
  return `RGB ${parts.join(" ")}`;
}

function getCaretElement() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return document.body;
  }

  let node = selection.anchorNode;
  if (!node) {
    return document.body;
  }
  if (node.nodeType === Node.TEXT_NODE) {
    node = node.parentElement;
  }

  return node && node.nodeType === Node.ELEMENT_NODE ? node : document.body;
}

function removeLogPanel() {
  const panel = document.getElementById(LOG_PANEL_ID);
  if (panel && panel.parentNode) {
    panel.parentNode.removeChild(panel);
  }
}

function showLogPanel(text) {
  removeLogPanel();

  const panel = document.createElement("div");
  panel.id = LOG_PANEL_ID;
  panel.style.border = "1px solid #333";
  panel.style.borderRadius = "5px";
  panel.style.boxShadow = "2px 2px 6px #888";
  panel.style.margin = "1em";
  panel.style.padding = "0.5em";
  panel.style.position = "relative";
  panel.style.maxWidth = "900px";
  panel.style.background = "#fff";
  panel.style.fontFamily = "sans-serif";

  const title = document.createElement("strong");
  title.textContent = "LaTeX It! run report";

  const close = document.createElement("button");
  close.textContent = "X";
  close.style.position = "absolute";
  close.style.right = "6px";
  close.style.top = "6px";
  close.addEventListener("click", () => {
    removeLogPanel();
  });

  const pre = document.createElement("pre");
  pre.style.maxHeight = "400px";
  pre.style.overflow = "auto";
  pre.style.whiteSpace = "pre-wrap";
  pre.textContent = text;

  panel.appendChild(title);
  panel.appendChild(close);
  panel.appendChild(pre);

  if (document.body.firstChild) {
    document.body.insertBefore(panel, document.body.firstChild);
  } else {
    document.body.appendChild(panel);
  }
}

function insertImageAtSelection(imageNode) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    document.body.appendChild(imageNode);
    return;
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();
  range.insertNode(imageNode);
  range.setStartAfter(imageNode);
  range.collapse(true);

  selection.removeAllRanges();
  selection.addRange(range);
}

async function getPrefs() {
  return browser.runtime.sendMessage({ command: "getPrefs" });
}

async function runLatexRender(latexExpression, fontPx, fontColor, overrides = {}) {
  return browser.runtime.sendMessage({
    command: "renderLatex",
    latexExpression,
    fontPx,
    fontColor,
    autodpiOverride: overrides.autodpiOverride,
    defaultFontPxOverride: overrides.defaultFontPxOverride,
  });
}

function normalizeSourceValue(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim() ? value : "";
}

function isLikelyLatexDocument(text) {
  if (typeof text !== "string") {
    return false;
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  return (
    trimmed.includes("\\documentclass") ||
    trimmed.includes("\\begin{document}") ||
    trimmed.includes("\\end{document}") ||
    trimmed.includes("__REPLACE_ME__") ||
    trimmed.includes("__REPLACEME__")
  );
}

function isInlineLatexExpression(text) {
  return typeof text === "string" && INLINE_LATEX_EXACT_PATTERN.test(text.trim());
}

function applyFormulaMetadata(img, options = {}) {
  const legacyComplexSource = normalizeSourceValue(options.complexSource);
  const sourceDocument = normalizeSourceValue(
    options.sourceDocument || legacyComplexSource
  );
  const sourceExpression = normalizeSourceValue(options.sourceExpression);
  let sourceMode = normalizeSourceValue(options.sourceMode);

  if (sourceMode !== "inline" && sourceMode !== "complex") {
    if (sourceExpression && isInlineLatexExpression(sourceExpression)) {
      sourceMode = "inline";
    } else if (sourceDocument) {
      sourceMode = isInlineLatexExpression(sourceDocument) ? "inline" : "complex";
    } else {
      sourceMode = "";
    }
  }

  if (sourceMode) {
    img.dataset.tblatexMode = sourceMode;
  }
  if (sourceDocument) {
    img.dataset.tblatexDoc = sourceDocument;
  }
  if (sourceExpression) {
    img.dataset.tblatexExpr = sourceExpression;
  }
  if (legacyComplexSource) {
    // Compatibility with early 0.8.x builds that only used this single field.
    img.dataset.tblatexSource = legacyComplexSource;
  }
}

function summarizeFormulaPreview(text) {
  const normalized = normalizeLatexSnippet(text || "");
  if (!normalized) {
    return "";
  }
  if (normalized.length <= 120) {
    return normalized;
  }
  return `${normalized.slice(0, 117)}...`;
}

function normalizeFormulaSeed(seed) {
  if (!seed || typeof seed !== "object") {
    return null;
  }

  const sourceDocument = normalizeSourceValue(seed.sourceDocument);
  const sourceExpression = normalizeSourceValue(seed.sourceExpression);
  let sourceMode = normalizeSourceValue(seed.sourceMode);

  if (!sourceDocument && !sourceExpression) {
    return null;
  }

  if (sourceMode !== "inline" && sourceMode !== "complex") {
    if (sourceExpression) {
      sourceMode = "inline";
    } else {
      sourceMode = isInlineLatexExpression(sourceDocument) ? "inline" : "complex";
    }
  }

  const preview = summarizeFormulaPreview(sourceExpression || sourceDocument);
  const dedupeKey = sourceDocument || sourceExpression;
  return {
    sourceMode,
    sourceExpression,
    sourceDocument,
    preview,
    dedupeKey,
  };
}

function addFormulaToHistory(seed, options = {}) {
  const normalizedSeed = normalizeFormulaSeed(seed);
  if (!normalizedSeed) {
    return;
  }

  formulaHistory = formulaHistory.filter(
    (item) => item.dedupeKey !== normalizedSeed.dedupeKey
  );
  formulaHistory.unshift({
    ...normalizedSeed,
    savedAt: Date.now(),
  });

  if (formulaHistory.length > FORMULA_HISTORY_LIMIT) {
    formulaHistory.length = FORMULA_HISTORY_LIMIT;
  }

  if (options.sync !== false) {
    scheduleFormulaHistorySync();
  }
}

function mergeFormulaHistorySeeds(seeds) {
  if (!Array.isArray(seeds) || !seeds.length) {
    return;
  }

  for (let i = seeds.length - 1; i >= 0; i--) {
    addFormulaToHistory(seeds[i], { sync: false });
  }
}

function getFormulaHistory() {
  return formulaHistory.map((item, index) => ({
    id: String(index),
    sourceMode: item.sourceMode,
    sourceExpression: item.sourceExpression,
    sourceDocument: item.sourceDocument,
    preview: item.preview,
    savedAt: item.savedAt,
  }));
}

async function ensureFormulaHistoryHydrated() {
  if (formulaHistoryHydrated) {
    return;
  }
  formulaHistoryHydrated = true;

  const localSnapshot = formulaHistory.slice();
  formulaHistory = [];

  try {
    const result = await browser.runtime.sendMessage({
      command: "getFormulaHistoryStore",
    });
    const storedHistory = result && Array.isArray(result.history) ? result.history : [];
    mergeFormulaHistorySeeds(storedHistory);
  } catch (error) {
    // Keep local-only history if storage lookup fails.
  }

  mergeFormulaHistorySeeds(localSnapshot);
}

function scheduleFormulaHistorySync() {
  if (formulaHistorySyncTimer !== null) {
    return;
  }

  formulaHistorySyncTimer = setTimeout(async () => {
    formulaHistorySyncTimer = null;

    try {
      await ensureFormulaHistoryHydrated();
      await browser.runtime.sendMessage({
        command: "setFormulaHistoryStore",
        history: getFormulaHistory(),
      });
    } catch (error) {
      // Ignore history sync failures and keep local history available.
    }
  }, 250);
}

async function getFormulaHistoryForUi() {
  await ensureFormulaHistoryHydrated();
  return getFormulaHistory();
}

function makeImageFromResult(result, altText, titleText, options = {}) {
  const renderScale = Number(result && result.renderScale) > 0
    ? Number(result.renderScale)
    : 1;
  const depth = Number(result && result.depth) || 0;
  const sourceExpr = (options.sourceExpression || altText || "").trim();
  const isDisplayMath = sourceExpr.startsWith("$$") || sourceExpr.startsWith("\\[");
  const img = document.createElement("img");
  img.alt = altText;
  img.title = titleText;
  img.style.verticalAlign = isDisplayMath ? "middle" : `-${depth / renderScale}px`;
  img.src = result.dataUrl;
  applyFormulaMetadata(img, options);

  if (renderScale > 1) {
    const applyDisplayScale = () => {
      if (!img.naturalWidth || !img.naturalHeight) {
        return;
      }
      const w = Math.max(1, Math.round(img.naturalWidth / renderScale));
      const h = Math.max(1, Math.round(img.naturalHeight / renderScale));
      img.width = w;
      img.height = h;
      img.style.width = `${w}px`;
      img.style.height = `${h}px`;
    };

    if (img.complete) {
      applyDisplayScale();
    } else {
      img.addEventListener("load", applyDisplayScale, { once: true });
    }
  }

  return img;
}

function moveCaretAwayFromTextNode(textNode) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return false;
  }

  const anchorOnNode = selection.anchorNode === textNode;
  const focusOnNode = selection.focusNode === textNode;
  if (!anchorOnNode && !focusOnNode) {
    return false;
  }

  try {
    const range = document.createRange();
    range.setStartAfter(textNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  } catch (error) {
    // If caret relocation fails, proceed with replacement anyway.
    return false;
  }
}

function setCaretAfterNode(node) {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }

  try {
    const range = document.createRange();
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  } catch (error) {
    // Ignore caret update failures.
  }
}

function getSelectedImageNode() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (range.startContainer === range.endContainer && range.startContainer) {
    const container = range.startContainer;
    if (container.nodeType === Node.ELEMENT_NODE && range.endOffset === range.startOffset + 1) {
      const selectedNode = container.childNodes[range.startOffset];
      if (selectedNode && selectedNode.nodeType === Node.ELEMENT_NODE && selectedNode.tagName === "IMG") {
        return selectedNode;
      }
    }
  }

  for (const node of [selection.anchorNode, selection.focusNode, range.commonAncestorContainer]) {
    if (node && node.nodeType === Node.ELEMENT_NODE && node.tagName === "IMG") {
      return node;
    }
  }

  return null;
}

function normalizeLatexSnippet(snippet) {
  if (typeof snippet !== "string") {
    return "";
  }
  return snippet.replace(/\s+/g, " ").trim();
}

function getImageDataField(imageNode, datasetKey, attributeName) {
  if (!imageNode || imageNode.tagName !== "IMG") {
    return "";
  }

  const datasetValue = imageNode.dataset ? imageNode.dataset[datasetKey] : "";
  if (typeof datasetValue === "string" && datasetValue.trim()) {
    return datasetValue;
  }

  const attributeValue = imageNode.getAttribute(attributeName);
  if (typeof attributeValue === "string" && attributeValue.trim()) {
    return attributeValue;
  }

  return "";
}

function pushUniqueCandidate(candidates, value) {
  if (typeof value !== "string" || !value.trim()) {
    return;
  }
  if (!candidates.includes(value)) {
    candidates.push(value);
  }
}

function readFormulaSeedFromImage(imageNode) {
  if (!imageNode || imageNode.tagName !== "IMG") {
    return null;
  }

  const candidates = [];

  const rawMode = getImageDataField(imageNode, "tblatexMode", "data-tblatex-mode");
  const rawDocument = getImageDataField(imageNode, "tblatexDoc", "data-tblatex-doc");
  const rawExpression = getImageDataField(imageNode, "tblatexExpr", "data-tblatex-expr");
  const legacySource = getImageDataField(imageNode, "tblatexSource", "data-tblatex-source");

  pushUniqueCandidate(candidates, rawDocument);
  pushUniqueCandidate(candidates, rawExpression);
  pushUniqueCandidate(candidates, legacySource);
  pushUniqueCandidate(candidates, imageNode.title || "");
  pushUniqueCandidate(candidates, imageNode.alt || "");

  let sourceDocument = normalizeSourceValue(rawDocument);
  let sourceExpression = normalizeSourceValue(rawExpression);
  let sourceMode = rawMode === "inline" || rawMode === "complex" ? rawMode : "";

  if (!sourceDocument) {
    for (const candidate of candidates) {
      if (isLikelyLatexDocument(candidate)) {
        sourceDocument = candidate;
        break;
      }
    }
  }

  if (!sourceExpression) {
    for (const candidate of candidates) {
      if (isInlineLatexExpression(candidate)) {
        sourceExpression = candidate;
        break;
      }
    }
  }

  if (!sourceMode) {
    if (sourceExpression) {
      sourceMode = "inline";
    } else if (sourceDocument) {
      sourceMode = isInlineLatexExpression(sourceDocument) ? "inline" : "complex";
    } else if (legacySource) {
      sourceMode = isInlineLatexExpression(legacySource) ? "inline" : "complex";
    }
  }

  if (sourceMode === "inline" && !sourceExpression && sourceDocument && isInlineLatexExpression(sourceDocument)) {
    sourceExpression = sourceDocument;
  }

  if (!sourceDocument && !sourceExpression) {
    return null;
  }

  return {
    sourceMode,
    sourceDocument,
    sourceExpression,
  };
}

function getInsertComplexSeed() {
  const selectedImage = getSelectedImageNode();
  const selectedSeed = readFormulaSeedFromImage(selectedImage);
  if (selectedSeed) {
    addFormulaToHistory(selectedSeed);
  }
  const sourceDocument = selectedSeed
    ? selectedSeed.sourceDocument || ""
    : lastComplexExpression || "";
  const sourceExpression = selectedSeed ? selectedSeed.sourceExpression || "" : "";
  const sourceMode = selectedSeed ? selectedSeed.sourceMode || "" : "";

  return {
    selection: getSelectionText(),
    sourceMode,
    sourceExpression,
    sourceDocument,
    complexSource: sourceDocument,
  };
}

function collectUnconvertedLatex(limit = 3) {
  if (!document.body) {
    return { count: 0, samples: [] };
  }

  const samples = [];
  let count = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let textNode = walker.nextNode(); textNode; textNode = walker.nextNode()) {
    const value = textNode.nodeValue || "";
    if (!value) {
      continue;
    }

    const parent = textNode.parentElement;
    if (!parent) {
      continue;
    }

    if (
      parent.id === LOG_PANEL_ID ||
      parent.closest(`#${LOG_PANEL_ID}`) ||
      parent.tagName === "SCRIPT" ||
      parent.tagName === "STYLE"
    ) {
      continue;
    }

    const matches = value.match(LATEX_PATTERN);
    if (!matches || !matches.length) {
      continue;
    }

    count += matches.length;
    for (const match of matches) {
      if (samples.length >= limit) {
        break;
      }
      const normalized = normalizeLatexSnippet(match);
      if (normalized) {
        samples.push(normalized);
      }
    }
  }

  return { count, samples };
}

function confirmSendWithLatexCheck() {
  const { count, samples } = collectUnconvertedLatex(3);
  if (!count) {
    return { okToSend: true, count: 0, samples: [] };
  }

  const noun = count === 1 ? "expression" : "expressions";
  const sampleText = samples.length ? `\n\nExamples:\n${samples.join("\n")}` : "";
  const message =
    `LaTeX It! found ${count} unconverted LaTeX ${noun} in this message.` +
    `${sampleText}\n\nSend anyway?`;
  const okToSend = window.confirm(message);

  return {
    okToSend,
    count,
    samples,
  };
}

async function latexify({ silent }) {
  const prefs = await getPrefs();
  const logs = [];
  let converted = 0;
  let failed = 0;

  removeLogPanel();

  const latexNodes = splitTextNodes(document.body);
  if (!latexNodes.length && !silent) {
    logs.push("No unconverted LaTeX $$ expression was found.");
  }

  for (const textNode of latexNodes) {
    const originalText = textNode.nodeValue;
    const [latexExpression, replaceLog] = replaceMarker(prefs.template, originalText);
    if (replaceLog) {
      logs.push(replaceLog);
      failed++;
      continue;
    }

    const parent = textNode.parentElement || document.body;
    const style = window.getComputedStyle(parent);
    const fontPx = style.getPropertyValue("font-size") || `${prefs.fontPx}px`;
    const fontColor = normalizeColor(style.getPropertyValue("color"));

    let renderResult;
    try {
      renderResult = await runLatexRender(latexExpression, fontPx, fontColor);
    } catch (error) {
      logs.push(`!!! Could not render "${originalText}": ${String(error)}\n`);
      failed++;
      continue;
    }

    if (renderResult.log) {
      logs.push(renderResult.log);
    }

    if ((renderResult.status === 0 || renderResult.status === 1) && renderResult.dataUrl) {
      const formulaSeed = {
        sourceMode: "inline",
        sourceExpression: originalText,
        sourceDocument: latexExpression,
      };
      const img = makeImageFromResult(renderResult, originalText, originalText, formulaSeed);
      if (textNode.parentNode) {
        const movedCaret = moveCaretAwayFromTextNode(textNode);
        textNode.parentNode.insertBefore(img, textNode);
        textNode.parentNode.removeChild(textNode);
        if (movedCaret) {
          setCaretAfterNode(img);
        }
        undoStack.push(() => {
          if (!img.parentNode) {
            return;
          }
          img.parentNode.insertBefore(textNode, img);
          img.parentNode.removeChild(img);
        });
      }
      addFormulaToHistory(formulaSeed);
      converted++;
    } else {
      failed++;
    }
  }

  if (prefs.log && logs.length) {
    showLogPanel(logs.join("\n"));
  }

  return {
    ok: true,
    converted,
    failed,
    found: latexNodes.length,
  };
}

function undo() {
  const fn = undoStack.pop();
  if (!fn) {
    return { ok: true, undone: 0 };
  }
  try {
    fn();
    return { ok: true, undone: 1 };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

function undoAll() {
  let count = 0;
  while (undoStack.length) {
    const fn = undoStack.pop();
    try {
      fn();
      count++;
    } catch (error) {
      return { ok: false, undone: count, error: String(error) };
    }
  }
  return { ok: true, undone: count };
}

async function insertComplex({ latexExpression, autodpi, fontPx }) {
  const prefs = await getPrefs();
  const logs = [];

  if (!latexExpression || !latexExpression.trim()) {
    return { ok: false, error: "LaTeX expression is empty." };
  }

  removeLogPanel();

  const element = getCaretElement();
  const style = window.getComputedStyle(element);
  const resolvedFontPx = autodpi ? style.getPropertyValue("font-size") : `${fontPx}px`;
  const fontColor = normalizeColor(style.getPropertyValue("color"));

  let renderResult;
  try {
    renderResult = await runLatexRender(latexExpression, resolvedFontPx, fontColor, {
      autodpiOverride: autodpi,
      defaultFontPxOverride: Number(fontPx) || 16,
    });
  } catch (error) {
    logs.push(`!!! Could not render complex LaTeX: ${String(error)}\n`);
    if (prefs.log) {
      showLogPanel(logs.join("\n"));
    }
    return { ok: false, error: String(error) };
  }

  if (renderResult.log) {
    logs.push(renderResult.log);
  }

  if ((renderResult.status === 0 || renderResult.status === 1) && renderResult.dataUrl) {
    const selectedImage = getSelectedImageNode();
    const extractedInlineExpression = extractExpressionFromTemplate(
      prefs.template,
      latexExpression
    );
    const sourceMode = extractedInlineExpression ? "inline" : "complex";
    const accessibleText = extractedInlineExpression || latexExpression;
    const formulaSeed = {
      sourceMode,
      sourceExpression: extractedInlineExpression,
      sourceDocument: latexExpression,
      complexSource: latexExpression,
    };
    const img = makeImageFromResult(renderResult, accessibleText, accessibleText, formulaSeed);

    if (selectedImage && selectedImage.parentNode) {
      selectedImage.parentNode.insertBefore(img, selectedImage);
      selectedImage.parentNode.removeChild(selectedImage);
      setCaretAfterNode(img);
      undoStack.push(() => {
        if (!img.parentNode) {
          return;
        }
        img.parentNode.insertBefore(selectedImage, img);
        img.parentNode.removeChild(img);
        setCaretAfterNode(selectedImage);
      });
    } else {
      insertImageAtSelection(img);
      undoStack.push(() => {
        if (img.parentNode) {
          img.parentNode.removeChild(img);
        }
      });
    }

    addFormulaToHistory(formulaSeed);
    lastComplexExpression = latexExpression;
    if (prefs.log && logs.length) {
      showLogPanel(logs.join("\n"));
    }
    return { ok: true };
  }

  if (prefs.log && logs.length) {
    showLogPanel(logs.join("\n"));
  }

  return { ok: false, error: "LaTeX rendering failed." };
}

function getSelectionText() {
  const selection = window.getSelection();
  if (!selection) {
    return "";
  }
  return selection.toString();
}

browser.runtime.onMessage.addListener((message) => {
  switch (message && message.command) {
    case "latexify":
      return latexify({ silent: Boolean(message.silent) });
    case "undo":
      return Promise.resolve(undo());
    case "undoAll":
      return Promise.resolve(undoAll());
    case "insertComplex":
      return insertComplex({
        latexExpression: message.latexExpression || "",
        autodpi: Boolean(message.autodpi),
        fontPx: Number(message.fontPx) || 16,
      });
    case "getSelection":
      return Promise.resolve(getSelectionText());
    case "getInsertComplexSeed":
      return Promise.resolve(getInsertComplexSeed());
    case "getFormulaHistory":
      return getFormulaHistoryForUi();
    case "hasLogReport":
      return Promise.resolve(Boolean(document.getElementById(LOG_PANEL_ID)));
    case "removeLogReport": {
      const hadReport = Boolean(document.getElementById(LOG_PANEL_ID));
      removeLogPanel();
      return Promise.resolve({ ok: true, removed: hadReport });
    }
    case "confirmSendWithLatexCheck":
      return Promise.resolve(confirmSendWithLatexCheck());
    default:
      return null;
  }
});
