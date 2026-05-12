"use strict";

const { Subprocess } = ChromeUtils.importESModule(
  "resource://gre/modules/Subprocess.sys.mjs"
);

const Cc = Components.classes;
const Ci = Components.interfaces;
const DEFAULT_RENDER_SCALE = 4;

function normalizeExecutablePath(path) {
  if (!path || typeof path !== "string") {
    return "";
  }

  const trimmed = path.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function initLocalFile(path) {
  const normalized = normalizeExecutablePath(path);
  if (!normalized) {
    return null;
  }

  try {
    const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    file.initWithPath(normalized);
    return file;
  } catch (error) {
    return null;
  }
}

function fileExists(path) {
  const file = initLocalFile(path);
  return Boolean(file && file.exists());
}

function createProcess(binaryFile) {
  const process = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
  process.init(binaryFile);
  return process;
}

function runProcess(binaryFile, args) {
  const process = createProcess(binaryFile);
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      callback(value);
    };

    const observer = {
      observe(_subject, topic) {
        if (topic === "process-finished") {
          settle(resolve, process.exitValue);
          return;
        }
        if (topic === "process-failed") {
          settle(reject, new Error(`Process failed: ${binaryFile.path}`));
        }
      },
      QueryInterface: ChromeUtils.generateQI(["nsIObserver"]),
    };

    try {
      process.runAsync(args, args.length, observer, false);
    } catch (error) {
      settle(reject, error);
    }
  });
}

async function runProcessCapture(binaryPath, args) {
  const proc = await Subprocess.call({
    command: binaryPath,
    arguments: args,
    stderr: "pipe",
  });
  let stdout = "";
  let chunk;
  while ((chunk = await proc.stdout.readString()) !== "") {
    stdout += chunk;
  }
  const { exitCode } = await proc.wait();
  return { exitCode, stdout };
}

function writeUtf8TextFile(file, data) {
  const outputStream = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(
    Ci.nsIFileOutputStream
  );
  outputStream.init(file, 0x02 | 0x08 | 0x20, 0o666, 0);

  const converter = Cc["@mozilla.org/intl/converter-output-stream;1"].createInstance(
    Ci.nsIConverterOutputStream
  );
  converter.init(outputStream, "UTF-8", 0, 0);
  converter.writeString(data);
  converter.close();
}

function readFileBytes(file, maxBytes = -1) {
  const inputStream = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(
    Ci.nsIFileInputStream
  );
  inputStream.init(file, 0x01, 0o444, 0);

  const binaryStream = Cc["@mozilla.org/binaryinputstream;1"].createInstance(
    Ci.nsIBinaryInputStream
  );
  binaryStream.setInputStream(inputStream);

  let size = 0;
  try {
    size = Math.max(0, Number(file.fileSize) || 0);
  } catch (error) {
    size = 0;
  }
  if (size <= 0) {
    size = Math.max(0, binaryStream.available());
  }

  let count = size;
  if (Number.isFinite(maxBytes) && maxBytes >= 0) {
    count = Math.min(Math.max(0, Number(maxBytes) || 0), size);
  }
  const bytes = count > 0 ? binaryStream.readByteArray(count) : [];
  try {
    binaryStream.close();
  } catch (error) {
    // ignore
  }
  try {
    inputStream.close();
  } catch (error) {
    // ignore
  }

  return bytes;
}

function readLatexLogErrors(logFile) {
  if (!logFile || !logFile.exists()) return "";
  try {
    const bytes = readFileBytes(logFile, 8192);
    const text = Array.from(bytes, (b) => String.fromCharCode(b & 0xff)).join("");
    const lines = text.split("\n");
    const result = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("!")) {
        for (let j = i; j < Math.min(i + 3, lines.length); j++) {
          result.push(lines[j]);
        }
        i += 2;
      }
    }
    return result.join("\n");
  } catch (e) {
    return "";
  }
}

function hasPngSignature(bytes) {
  if (!bytes || bytes.length < 8) {
    return false;
  }
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < signature.length; i++) {
    if (bytes[i] !== signature[i]) {
      return false;
    }
  }
  return true;
}

function bytesToBase64(bytes) {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";

  for (let i = 0; i < bytes.length; i += 3) {
    const byte0 = (bytes[i] || 0) & 0xff;
    const byte1 = (bytes[i + 1] || 0) & 0xff;
    const byte2 = (bytes[i + 2] || 0) & 0xff;

    const triplet = (byte0 << 16) | (byte1 << 8) | byte2;

    output += alphabet[(triplet >> 18) & 0x3f];
    output += alphabet[(triplet >> 12) & 0x3f];
    output += i + 1 < bytes.length ? alphabet[(triplet >> 6) & 0x3f] : "=";
    output += i + 2 < bytes.length ? alphabet[triplet & 0x3f] : "=";
  }

  return output;
}

function parseDvipngDepth(text) {
  const match = text.match(/\[\d+ depth=(-?\d+)\]/);
  return match ? Number(match[1]) : 0;
}

function removeFile(file) {
  try {
    if (file && file.exists()) {
      file.remove(false);
    }
  } catch (error) {
    // Ignore cleanup failures.
  }
}

function parseFontPx(fontPx, fallbackPx) {
  const parsed = Number.parseFloat(fontPx);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallbackPx;
}

function normalizeRenderScale(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_RENDER_SCALE;
  }
  return Math.min(8, Math.max(1, parsed));
}

function makeTempFiles() {
  const tempDir = Services.dirsvc.get("TmpD", Ci.nsIFile);
  let suffix = `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;

  const texFile = tempDir.clone();
  texFile.append(`tblatex-${suffix}.tex`);
  while (texFile.exists()) {
    suffix = `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
    texFile.leafName = `tblatex-${suffix}.tex`;
  }

  const dviFile = tempDir.clone();
  dviFile.append(`tblatex-${suffix}.dvi`);

  const pngFile = tempDir.clone();
  pngFile.append(`tblatex-${suffix}.png`);

  const logFile = tempDir.clone();
  logFile.append(`tblatex-${suffix}.log`);

  const auxFile = tempDir.clone();
  auxFile.append(`tblatex-${suffix}.aux`);

  return {
    suffix,
    tempDir,
    texFile,
    dviFile,
    pngFile,
    logFile,
    auxFile,
  };
}

function detectExecutables() {
  const env = Cc["@mozilla.org/process/environment;1"].getService(Ci.nsIEnvironment);
  const isWindows = "@mozilla.org/windows-registry-key;1" in Cc;

  const separator = isWindows ? ";" : ":";
  const extension = isWindows ? ".exe" : "";

  const candidates = [];
  const currentPath = env.get("PATH");
  if (currentPath) {
    candidates.push(...currentPath.split(separator));
  }

  if (!isWindows) {
    for (const suggestion of [
      "/usr/bin",
      "/bin",
      "/usr/local/bin",
      "/opt/homebrew/bin",
      "/usr/texbin",
      "/Library/TeX/texbin",
      "/usr/X11/bin",
      "/usr/local/texlive/current/bin/x86_64-linux",
      "/usr/local/texlive/current/bin/x86_64-darwin",
    ]) {
      if (!candidates.includes(suggestion)) {
        candidates.push(suggestion);
      }
    }
  }

  let latexPath = "";
  let dvipngPath = "";

  for (const candidate of candidates) {
    const base = initLocalFile(candidate);
    if (!base || !base.exists() || !base.isDirectory()) {
      continue;
    }

    if (!latexPath) {
      const latex = base.clone();
      latex.append(`latex${extension}`);
      if (latex.exists()) {
        latexPath = latex.path;
      }
    }

    if (!dvipngPath) {
      const dvipng = base.clone();
      dvipng.append(`dvipng${extension}`);
      if (dvipng.exists()) {
        dvipngPath = dvipng.path;
      }
    }

    if (latexPath && dvipngPath) {
      break;
    }
  }

  return { latexPath, dvipngPath };
}

function readLegacyPrefs() {
  const out = {};

  const prefMap = [
    ["latexPath", "tblatex.latex_path", "string", ""],
    ["dvipngPath", "tblatex.dvipng_path", "string", ""],
    ["autodpi", "tblatex.autodpi", "bool", true],
    ["fontPx", "tblatex.font_px", "int", 16],
    ["renderScale", "tblatex.render_scale", "int", DEFAULT_RENDER_SCALE],
    ["log", "tblatex.log", "bool", false],
    ["debug", "tblatex.debug", "bool", false],
    ["warnOnUnconvertedLatex", "tblatex.warn_on_unconverted", "bool", true],
    ["persistFormulaHistory", "tblatex.persist_formula_history", "bool", false],
    ["keepTempFiles", "tblatex.keeptempfiles", "bool", false],
    ["template", "tblatex.template", "string", ""],
  ];

  for (const [modernName, legacyName, type, fallback] of prefMap) {
    if (!Services.prefs.prefHasUserValue(legacyName)) {
      continue;
    }

    try {
      if (type === "string") {
        out[modernName] = Services.prefs.getStringPref(legacyName, fallback);
      } else if (type === "bool") {
        out[modernName] = Services.prefs.getBoolPref(legacyName, fallback);
      } else if (type === "int") {
        out[modernName] = Services.prefs.getIntPref(legacyName, fallback);
      }
    } catch (error) {
      // Ignore malformed legacy values.
    }
  }

  return out;
}

function checkPreviewPackage(latexExpression) {
  const pattern =
    /^[^%]*\\usepackage\[(.*,\s*)?active(,.*)?\]{(.*,\s*)?preview(,.*)?}/m;
  return pattern.test(latexExpression);
}

function getRuntimeInfo() {
  let sandboxed = false;
  let sandboxType = "none";

  try {
    const env = Cc["@mozilla.org/process/environment;1"].getService(Ci.nsIEnvironment);
    if (env.exists("SNAP") || env.exists("SNAP_NAME") || env.exists("SNAP_INSTANCE_NAME")) {
      sandboxed = true;
      sandboxType = "snap";
    } else if (env.exists("FLATPAK_ID")) {
      sandboxed = true;
      sandboxType = "flatpak";
    }
  } catch (error) {
    // ignore
  }

  return {
    sandboxed,
    sandboxType,
  };
}

var TBLatex = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {
    return {
      TBLatex: {
        async render(
          latexExpression,
          fontPx,
          fontColor,
          latexPath,
          dvipngPath,
          autodpi,
          defaultFontPx,
          renderScale,
          debug,
          keepTempFiles
        ) {
          let status = 0;
          let log = "";
          let files = null;
          latexPath = normalizeExecutablePath(latexPath);
          dvipngPath = normalizeExecutablePath(dvipngPath);

          try {
            if (!checkPreviewPackage(latexExpression)) {
              return {
                status: 2,
                depth: 0,
                dataUrl: "",
                log:
                  "!!! The package 'preview' (active mode) cannot be found in the LaTeX template.\n",
              };
            }

            if (!fileExists(latexPath)) {
              const runtimeInfo = getRuntimeInfo();
              const snapHint = runtimeInfo.sandboxType === "snap"
                ? " (Thunderbird Snap build cannot access host /usr/bin TeX binaries directly)"
                : "";
              return {
                status: 2,
                depth: 0,
                dataUrl: "",
                log:
                  `!!! Wrong path for 'latex' executable: "${latexPath || "(empty)"}". Set it in LaTeX It! options${snapHint}.\n`,
              };
            }

            if (!fileExists(dvipngPath)) {
              const runtimeInfo = getRuntimeInfo();
              const snapHint = runtimeInfo.sandboxType === "snap"
                ? " (Thunderbird Snap build cannot access host /usr/bin TeX binaries directly)"
                : "";
              return {
                status: 2,
                depth: 0,
                dataUrl: "",
                log:
                  `!!! Wrong path for 'dvipng' executable: "${dvipngPath || "(empty)"}". Set it in LaTeX It! options${snapHint}.\n`,
              };
            }

            const latexBin = initLocalFile(latexPath);
            const dvipngBin = initLocalFile(dvipngPath);
            files = makeTempFiles();

            writeUtf8TextFile(files.texFile, latexExpression);

            const latexArgs = [
              `-output-directory=${files.tempDir.path}`,
              "-interaction=batchmode",
              files.texFile.path,
            ];
            const latexExit = await runProcess(latexBin, latexArgs);
            if (latexExit !== 0) {
              status = 1;
              log += `LaTeX process returned ${latexExit}. Proceeding anyway...\n`;
            }

            if (!files.dviFile.exists()) {
              const latexLogErrors = readLatexLogErrors(files.logFile);
              const errorDetail = latexLogErrors ? `\n${latexLogErrors}\n` : "";
              return {
                status: 2,
                depth: 0,
                dataUrl: "",
                log:
                  log +
                  "!!! LaTeX did not output a .dvi file, something went wrong.\n" +
                  errorDetail,
              };
            }

            const sizePx = autodpi
              ? parseFontPx(fontPx, defaultFontPx)
              : defaultFontPx;
            const normalizedRenderScale = normalizeRenderScale(renderScale);
            const baseDpi = (sizePx * 72.27) / 10;
            const dpi = baseDpi * normalizedRenderScale;
            const safeColor = fontColor && fontColor.trim() ? fontColor : "RGB 0 0 0";

            if (debug) {
              log += `*** Using dpi=${dpi} (base=${baseDpi}, scale=${normalizedRenderScale}x) and color=${safeColor}\n`;
            }

            const dvipngArgs = [
              "--depth",
              "-T", "tight",
              "-z", "3",
              "-bg", "Transparent",
              "-D", String(dpi),
              "-fg", safeColor,
              "-o", files.pngFile.path,
              files.dviFile.path,
            ];
            const dvipngResult = await runProcessCapture(dvipngBin.path, dvipngArgs);
            const dvipngExit = dvipngResult.exitCode;
            if (dvipngExit !== 0 || !files.pngFile.exists()) {
              return {
                status: 2,
                depth: 0,
                dataUrl: "",
                log:
                  log +
                  `!!! dvipng failed with code ${dvipngExit}. Rendering aborted.\n`,
              };
            }

            const signatureBytes = readFileBytes(files.pngFile, 8);
            if (!hasPngSignature(signatureBytes)) {
              return {
                status: 2,
                depth: 0,
                dataUrl: "",
                log:
                  log +
                  "!!! Direct renderer produced invalid PNG bytes. Rendering aborted.\n",
              };
            }
            const depthText = dvipngResult.stdout || "";
            const depth = parseDvipngDepth(depthText);
            if (debug) {
              log += `*** dvipng output: ${depthText.trim()}\n`;
              log += `*** Parsed depth: ${depth}px\n`;
            }

            const pngBytes = readFileBytes(files.pngFile);
            const base64Png = bytesToBase64(pngBytes);
            const dataUrl = `data:image/png;base64,${base64Png}`;

            return {
              status,
              depth,
              dataUrl,
              renderScale: normalizedRenderScale,
              log,
            };
          } catch (error) {
            return {
              status: 2,
              depth: 0,
              dataUrl: "",
              log: log + `!!! Severe error while rendering LaTeX: ${String(error)}\n`,
            };
          } finally {
            if (files && !keepTempFiles) {
              removeFile(files.texFile);
              removeFile(files.auxFile);
              removeFile(files.logFile);
              removeFile(files.dviFile);
              removeFile(files.pngFile);
            }
          }
        },

        async detectExecutables() {
          return detectExecutables();
        },

        async readLegacyPrefs() {
          return readLegacyPrefs();
        },

        async getRuntimeInfo() {
          return getRuntimeInfo();
        },
      },
    };
  }
};
