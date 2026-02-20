"use strict";

const DEFAULT_PREFS = {
  latexPath: "",
  dvipngPath: "",
  autodpi: true,
  fontPx: 16,
  log: true,
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

async function getPrefs() {
  const { prefs = {} } = await browser.storage.local.get("prefs");
  const merged = { ...DEFAULT_PREFS, ...prefs };
  merged.latexPath = normalizeExecutablePath(merged.latexPath);
  merged.dvipngPath = normalizeExecutablePath(merged.dvipngPath);
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

async function runLatexify(tabId, silent) {
  if (!(await isHtmlComposeTab(tabId))) {
    await notify(
      "LaTeX It!",
      "Cannot run LaTeX conversion in plain text compose mode."
    );
    return { ok: false };
  }

  try {
    return await sendComposeCommand(tabId, { command: "latexify", silent });
  } catch (error) {
    console.error("Latexify failed:", error);
    await notify("LaTeX It!", "Could not access compose editor for LaTeX conversion.");
    return { ok: false, error: String(error) };
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
    case "renderLatex": {
      let prefs = await getPrefs();
      if (!prefs.latexPath || !prefs.dvipngPath) {
        prefs = await detectAndStorePaths(false);
      }
      const autodpi =
        typeof message.autodpiOverride === "boolean"
          ? message.autodpiOverride
          : prefs.autodpi;
      const fontPx =
        Number.isFinite(message.defaultFontPxOverride) &&
        message.defaultFontPxOverride > 0
          ? Math.round(message.defaultFontPxOverride)
          : prefs.fontPx;
      return browser.TBLatex.render(
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

browser.runtime.onMessage.addListener((message, sender) => handleRuntimeMessage(message, sender));

initialize().catch((error) => {
  console.error("Initialization failed:", error);
});
