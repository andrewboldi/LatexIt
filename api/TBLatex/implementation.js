"use strict";

const Cc = Components.classes;
const Ci = Components.interfaces;

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
  process.run(true, args, args.length);
  return process.exitValue;
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

function readBinaryAsBase64(file) {
  const inputStream = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(
    Ci.nsIFileInputStream
  );
  inputStream.init(file, 0x01, 0o444, 0);

  const binaryStream = Cc["@mozilla.org/binaryinputstream;1"].createInstance(
    Ci.nsIBinaryInputStream
  );
  binaryStream.setInputStream(inputStream);
  const bytes = binaryStream.readBytes(binaryStream.available());
  binaryStream.close();
  inputStream.close();

  return btoa(bytes);
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
    ["log", "tblatex.log", "bool", true],
    ["debug", "tblatex.debug", "bool", false],
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
            const latexExit = runProcess(latexBin, latexArgs);
            if (latexExit !== 0) {
              status = 1;
              log += `LaTeX process returned ${latexExit}. Proceeding anyway...\n`;
            }

            if (!files.dviFile.exists()) {
              return {
                status: 2,
                depth: 0,
                dataUrl: "",
                log:
                  log +
                  "!!! LaTeX did not output a .dvi file, something went wrong.\n",
              };
            }

            const sizePx = autodpi
              ? parseFontPx(fontPx, defaultFontPx)
              : defaultFontPx;
            const dpi = (sizePx * 72.27) / 10;
            const safeColor = fontColor && fontColor.trim() ? fontColor : "RGB 0 0 0";

            if (debug) {
              log += `*** Using dpi=${dpi} and color=${safeColor}\n`;
            }

            const dvipngArgs = [
              "-T",
              "tight",
              "-z",
              "3",
              "-bg",
              "Transparent",
              "-D",
              String(dpi),
              "-fg",
              safeColor,
              "-o",
              files.pngFile.path,
              files.dviFile.path,
            ];
            const dvipngExit = runProcess(dvipngBin, dvipngArgs);
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

            const base64Png = readBinaryAsBase64(files.pngFile);
            const dataUrl = `data:image/png;base64,${base64Png}`;

            return {
              status,
              depth: 0,
              dataUrl,
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
