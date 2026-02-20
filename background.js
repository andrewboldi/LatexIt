"use strict";

const DEFAULT_PREFS = {
  latexPath: "",
  dvipngPath: "",
  helperFallbackEnabled: true,
  helperUrl: "http://127.0.0.1:3737",
  autodpi: true,
  fontPx: 16,
  log: false,
  debug: false,
  keepTempFiles: false,
  template:
    "\\documentclass{article}\n" +
    "\\usepackage[utf8]{inputenc}\n" +
    "\\usepackage[active,displaymath,textmath]{preview} % DO NOT DELETE - this is required for baseline alignment\n" +
    "\\pagestyle{empty}\n" +
    "\\begin{document}\n" +
    "__REPLACE_ME__ % this is where your LaTeX expression goes between $$\n" +
    "\\end{document}\n",
};

const MENU_IDS = Object.freeze({
  RUN: "tblatex-run",
  UNDO: "tblatex-undo",
  UNDO_ALL: "tblatex-undo-all",
  INSERT: "tblatex-insert-complex",
  OPTIONS: "tblatex-open-options",
});

let composeScriptRegistration = null;
const latexifyInFlightByTab = new Map();
let helperHealthCache = {
  url: "",
  checkedAt: 0,
  ok: false,
  error: "",
};

function normalizeExecutablePath(value) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function normalizeHelperUrl(value) {
  if (typeof value !== "string") {
    return DEFAULT_PREFS.helperUrl;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_PREFS.helperUrl;
  }

  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  return withScheme.replace(/\/+$/, "");
}

async function getPrefs() {
  const { prefs = {} } = await browser.storage.local.get("prefs");
  const merged = { ...DEFAULT_PREFS, ...prefs };
  merged.latexPath = normalizeExecutablePath(merged.latexPath);
  merged.dvipngPath = normalizeExecutablePath(merged.dvipngPath);
  merged.helperUrl = normalizeHelperUrl(merged.helperUrl);
  merged.helperFallbackEnabled = Boolean(merged.helperFallbackEnabled);
  return merged;
}

async function setPrefs(partialPrefs) {
  const sanitized = { ...partialPrefs };
  if (Object.prototype.hasOwnProperty.call(sanitized, "latexPath")) {
    sanitized.latexPath = normalizeExecutablePath(sanitized.latexPath);
  }
  if (Object.prototype.hasOwnProperty.call(sanitized, "dvipngPath")) {
    sanitized.dvipngPath = normalizeExecutablePath(sanitized.dvipngPath);
  }
  if (Object.prototype.hasOwnProperty.call(sanitized, "helperUrl")) {
    sanitized.helperUrl = normalizeHelperUrl(sanitized.helperUrl);
  }
  if (Object.prototype.hasOwnProperty.call(sanitized, "helperFallbackEnabled")) {
    sanitized.helperFallbackEnabled = Boolean(sanitized.helperFallbackEnabled);
  }

  const current = await getPrefs();
  const next = { ...current, ...sanitized };
  await browser.storage.local.set({ prefs: next });
  return next;
}

async function resetPrefs() {
  await browser.storage.local.set({ prefs: { ...DEFAULT_PREFS } });
  return { ...DEFAULT_PREFS };
}

async function ensurePrefs() {
  const current = await getPrefs();
  await browser.storage.local.set({ prefs: current });
}

async function migrateLegacyPrefs() {
  const { legacyPrefsMigrated = false } = await browser.storage.local.get("legacyPrefsMigrated");
  if (legacyPrefsMigrated) {
    return;
  }

  try {
    const legacyPrefs = await browser.TBLatex.readLegacyPrefs();
    if (legacyPrefs && Object.keys(legacyPrefs).length) {
      await setPrefs(legacyPrefs);
    }
  } catch (error) {
    console.warn("Legacy preference migration failed:", error);
  }

  await browser.storage.local.set({ legacyPrefsMigrated: true });
}

async function detectAndStorePaths(force = false) {
  const prefs = await getPrefs();
  const detected = await browser.TBLatex.detectExecutables();
  const updates = {};

  if (force || !prefs.latexPath) {
    updates.latexPath = detected.latexPath || "";
  }
  if (force || !prefs.dvipngPath) {
    updates.dvipngPath = detected.dvipngPath || "";
  }

  if (Object.keys(updates).length) {
    return setPrefs(updates);
  }

  return prefs;
}

async function notify(title, message) {
  try {
    await browser.notifications.create({
      type: "basic",
      iconUrl: "icon.png",
      title,
      message,
    });
  } catch (error) {
    console.error("Notification failed:", error);
  }
}

function buildTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    done() {
      clearTimeout(timer);
    },
  };
}

async function fetchJson(url, options = {}, timeoutMs = 5000) {
  const timeout = buildTimeoutSignal(timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: timeout.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    timeout.done();
  }
}

async function checkHelperHealth(prefs, force = false) {
  const url = normalizeHelperUrl(prefs.helperUrl);
  const now = Date.now();
  if (
    !force &&
    helperHealthCache.url === url &&
    now - helperHealthCache.checkedAt < 10000
  ) {
    return {
      ok: helperHealthCache.ok,
      url,
      error: helperHealthCache.error,
    };
  }

  try {
    await fetchJson(`${url}/health`, { method: "GET" }, 1500);
    helperHealthCache = {
      url,
      checkedAt: now,
      ok: true,
      error: "",
    };
  } catch (error) {
    helperHealthCache = {
      url,
      checkedAt: now,
      ok: false,
      error: String(error),
    };
  }

  return {
    ok: helperHealthCache.ok,
    url,
    error: helperHealthCache.error,
  };
}

async function renderViaHelper(message, prefs, autodpi, fontPx) {
  const url = normalizeHelperUrl(prefs.helperUrl);
  return fetchJson(
    `${url}/render`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        latexExpression: message.latexExpression || "",
        fontPx: message.fontPx || "",
        fontColor: message.fontColor || "",
        latexPath: prefs.latexPath,
        dvipngPath: prefs.dvipngPath,
        autodpi,
        defaultFontPx: fontPx,
        debug: prefs.debug,
        keepTempFiles: prefs.keepTempFiles,
      }),
    },
    30000
  );
}

async function renderLatexMessage(message) {
  let prefs = await getPrefs();
  if (!prefs.latexPath || !prefs.dvipngPath) {
    prefs = await detectAndStorePaths(false);
  }

  const runtimeInfo = await browser.TBLatex.getRuntimeInfo().catch(() => ({
    sandboxed: false,
    sandboxType: "none",
  }));
  const autodpi =
    typeof message.autodpiOverride === "boolean"
      ? message.autodpiOverride
      : prefs.autodpi;
  const fontPx =
    Number.isFinite(message.defaultFontPxOverride) &&
    message.defaultFontPxOverride > 0
      ? Math.round(message.defaultFontPxOverride)
      : prefs.fontPx;

  let directResult;
  try {
    directResult = await browser.TBLatex.render(
      message.latexExpression || "",
      message.fontPx || "",
      message.fontColor || "",
      prefs.latexPath,
      prefs.dvipngPath,
      autodpi,
      fontPx,
      prefs.debug,
      prefs.keepTempFiles
    );
  } catch (error) {
    directResult = {
      status: 2,
      depth: 0,
      dataUrl: "",
      log: `!!! Direct renderer failed: ${String(error)}\n`,
    };
  }

  const directSucceeded = directResult && (directResult.status === 0 || directResult.status === 1);
  const fallbackEnabled = prefs.helperFallbackEnabled && runtimeInfo && runtimeInfo.sandboxed;
  if (directSucceeded || !fallbackEnabled) {
    return directResult;
  }

  const health = await checkHelperHealth(prefs, false);
  if (!health.ok) {
    const helperGuidance =
      `\n!!! Local helper fallback is enabled but not reachable at ${health.url}.\n` +
      "Start it with: python3 helper/tblatex_helper.py\n";
    return {
      ...directResult,
      log: `${directResult.log || ""}${helperGuidance}`,
    };
  }

  try {
    const helperResult = await renderViaHelper(message, prefs, autodpi, fontPx);
    const helperLog = `*** Used local helper fallback (${health.url}) in ${runtimeInfo.sandboxType} sandbox mode.\n`;
    return {
      ...helperResult,
      log: `${helperLog}${helperResult.log || ""}`,
    };
  } catch (error) {
    const helperErrorLog =
      `\n!!! Local helper fallback failed at ${health.url}: ${String(error)}\n` +
      "Ensure helper/tblatex_helper.py is running and try again.\n";
    return {
      ...directResult,
      log: `${directResult.log || ""}${helperErrorLog}`,
    };
  }
}

async function ensureComposeScriptRegistered() {
  if (composeScriptRegistration) {
    return composeScriptRegistration;
  }

  composeScriptRegistration = browser.composeScripts.register({
    js: [{ file: "compose/compose-script.js" }],
  });
  return composeScriptRegistration;
}

async function isHtmlComposeTab(tabId) {
  try {
    const details = await browser.compose.getComposeDetails(tabId);
    return !details.isPlainText;
  } catch (error) {
    return false;
  }
}

async function sendComposeCommand(tabId, payload) {
  await ensureComposeScriptRegistered();
  return browser.tabs.sendMessage(tabId, payload);
}

async function removeComposeRunReport(tabId) {
  if (!tabId) {
    return { ok: false, removed: false };
  }

  try {
    const result = await sendComposeCommand(tabId, { command: "removeLogReport" });
    return {
      ok: true,
      removed: Boolean(result && result.removed),
    };
  } catch (error) {
    // Don't block sending if the compose script is unavailable for this tab.
    console.warn("Could not remove run report before send:", error);
    return { ok: false, removed: false };
  }
}

async function runLatexify(tabId, silent) {
  if (latexifyInFlightByTab.get(tabId)) {
    return { ok: false, skipped: true, reason: "in-flight" };
  }

  if (!(await isHtmlComposeTab(tabId))) {
    await notify(
      "LaTeX It!",
      "Cannot run LaTeX conversion in plain text compose mode."
    );
    return { ok: false };
  }

  latexifyInFlightByTab.set(tabId, true);
  try {
    return await sendComposeCommand(tabId, { command: "latexify", silent });
  } catch (error) {
    console.error("Latexify failed:", error);
    await notify("LaTeX It!", "Could not access compose editor for LaTeX conversion.");
    return { ok: false, error: String(error) };
  } finally {
    latexifyInFlightByTab.delete(tabId);
  }
}

async function runUndo(tabId) {
  try {
    return await sendComposeCommand(tabId, { command: "undo" });
  } catch (error) {
    console.error("Undo failed:", error);
    return { ok: false, error: String(error) };
  }
}

async function runUndoAll(tabId) {
  try {
    return await sendComposeCommand(tabId, { command: "undoAll" });
  } catch (error) {
    console.error("Undo all failed:", error);
    return { ok: false, error: String(error) };
  }
}

async function openInsertDialog(tabId) {
  const url = browser.runtime.getURL(`ui/insert.html?tabId=${encodeURIComponent(tabId)}`);
  await browser.windows.create({
    url,
    type: "popup",
    width: 900,
    height: 700,
  });
}

async function withActiveComposeTab(handler) {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length || !tabs[0].id) {
    return;
  }
  await handler(tabs[0]);
}

async function handleMenuClick(menuId, tab) {
  if (!tab || !tab.id) {
    return;
  }

  switch (menuId) {
    case MENU_IDS.RUN:
      await runLatexify(tab.id, false);
      break;
    case MENU_IDS.UNDO:
      await runUndo(tab.id);
      break;
    case MENU_IDS.UNDO_ALL:
      await runUndoAll(tab.id);
      break;
    case MENU_IDS.INSERT:
      await openInsertDialog(tab.id);
      break;
    case MENU_IDS.OPTIONS:
      await browser.runtime.openOptionsPage();
      break;
    default:
      break;
  }
}

async function setupComposeActionMenu() {
  await browser.menus.removeAll();

  browser.menus.create({
    id: MENU_IDS.RUN,
    title: "Run LaTeX in body",
    contexts: ["compose_action_menu"],
  });

  browser.menus.create({
    id: MENU_IDS.UNDO,
    title: "Undo",
    contexts: ["compose_action_menu"],
  });

  browser.menus.create({
    id: MENU_IDS.UNDO_ALL,
    title: "Undo all",
    contexts: ["compose_action_menu"],
  });

  browser.menus.create({
    id: MENU_IDS.INSERT,
    title: "Insert complex LaTeX",
    contexts: ["compose_action_menu"],
  });

  browser.menus.create({
    id: MENU_IDS.OPTIONS,
    title: "Open options",
    contexts: ["compose_action_menu"],
  });
}

async function handleRuntimeMessage(message, sender) {
  switch (message && message.command) {
    case "getPrefs":
      return getPrefs();
    case "setPrefs":
      return setPrefs(message.prefs || {});
    case "resetPrefs":
      return resetPrefs();
    case "autodetectPaths":
      return detectAndStorePaths(true);
    case "renderLatex":
      return renderLatexMessage(message || {});
    case "getRuntimeInfo":
      return browser.TBLatex.getRuntimeInfo();
    case "testHelper": {
      const prefs = await getPrefs();
      return checkHelperHealth(prefs, true);
    }
    case "openOptions":
      return browser.runtime.openOptionsPage();
    case "runLatexifyFromDialog":
      if (typeof message.tabId === "number") {
        return runLatexify(message.tabId, Boolean(message.silent));
      }
      break;
    default:
      break;
  }

  return null;
}

async function initialize() {
  await ensurePrefs();
  await migrateLegacyPrefs();
  await detectAndStorePaths(false);
  await ensureComposeScriptRegistered();
  await setupComposeActionMenu();
}

browser.runtime.onInstalled.addListener(async (details) => {
  await initialize();
  if (details.reason === "install") {
    await browser.runtime.openOptionsPage();
  }
});

browser.runtime.onStartup.addListener(async () => {
  await initialize();
});

browser.menus.onClicked.addListener(async (info, tab) => {
  await handleMenuClick(info.menuItemId, tab);
});

browser.composeAction.onClicked.addListener(async (tab) => {
  if (tab && tab.id) {
    await runLatexify(tab.id, false);
  }
});

browser.commands.onCommand.addListener(async (command) => {
  if (command !== "tblatex-run-silent") {
    return;
  }

  await withActiveComposeTab(async (tab) => {
    await runLatexify(tab.id, true);
  });
});

if (browser.compose && browser.compose.onBeforeSend) {
  browser.compose.onBeforeSend.addListener(async (tab, _details) => {
    if (!tab || !tab.id) {
      return {};
    }

    await removeComposeRunReport(tab.id);
    return {};
  });
}

browser.runtime.onMessage.addListener((message, sender) => handleRuntimeMessage(message, sender));

initialize().catch((error) => {
  console.error("Initialization failed:", error);
});
