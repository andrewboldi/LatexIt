"use strict";

// Markup that keeps a rendered formula readable in the reader's light or dark
// theme, whatever theme it was composed in. Loaded before compose-script.js;
// tests/formula-markup.test.js loads it in Node.
//
// Each formula is sent in three forms, and the style blocks below show one per
// mail client:
//   .tbx-b  fallback image: formula color with a white outline (\contour)
//   .tbx-w  white image inside a stack of blend modes that inverts its backdrop
//           (Gmail)
//   .tbx-m  empty span whose background, the surrounding text color, is cut to
//           the formula's shape by a CSS mask (Thunderbird, and Apple Mail
//           where it matches the Apple block)

const DEFAULT_FORMULA_COLOR = "RGB 0 0 0";
const WHITE_FORMULA_COLOR = "RGB 255 255 255";

const TBLATEX_STYLES = [
  // Gmail (web and apps) turns <body> into a <div> right after a <u>.
  "u + .tbx-body .tbx-b { display:none !important; }\n" +
    "u + .tbx-body .tbx-w { display:inline-block !important; font-size:0; line-height:0; }\n" +
    "u + .tbx-body .tbx-l3, u + .tbx-body .tbx-l2, u + .tbx-body .tbx-l1 { display:inline-block; font-size:0; line-height:0; }\n" +
    "u + .tbx-body .tbx-l3 { background-image:linear-gradient(#ffffff,#ffffff); mix-blend-mode:difference; }\n" +
    "u + .tbx-body .tbx-l2 { background-image:linear-gradient(#808080,#808080); mix-blend-mode:hard-light; }\n" +
    "u + .tbx-body .tbx-l1 { background-image:linear-gradient(#808080,#808080); mix-blend-mode:difference; }\n" +
    "u + .tbx-body .tbx-l1 img { vertical-align:baseline !important; }\n",
  // Thunderbird's message view wraps every HTML body in .moz-text-html.
  ".moz-text-html .tbx-b { display:none !important; }\n" +
    ".moz-text-html .tbx-m { display:inline-block !important; }\n",
  // Thunderbird's compose window makes the whole document editable.
  "body:read-write .tbx-b { display:none !important; }\n" +
    "body:read-write .tbx-m { display:inline-block !important; }\n",
  // Apple Mail darkens CSS colors but not images. Exact black would turn
  // exactly white there, which Mail treats as a white background and removes.
  "@supports (-apple-color-filter: none) {\n" +
    ".tbx-b { display:none !important; }\n" +
    ".tbx-m { display:inline-block !important; background-color:#050505 !important; }\n" +
    "}\n",
];

function normalizeColor(color) {
  const match = String(color || "").match(/rgba?\(([^)]+)\)/i);
  if (!match) {
    return DEFAULT_FORMULA_COLOR;
  }

  const parts = match[1]
    .split(",")
    .slice(0, 3)
    .map((part) => part.trim());
  return `RGB ${parts.join(" ")}`;
}

// The formula color must not depend on the compose window's theme: use the
// text color only if the user set one on this text, otherwise black.
function formulaColor(element, computedColor) {
  for (let node = element; node && node.tagName !== "BODY"; node = node.parentElement) {
    const explicit =
      (node.style && node.style.color) ||
      (node.tagName === "FONT" && node.getAttribute("color"));
    if (explicit) {
      return normalizeColor(computedColor);
    }
  }
  return DEFAULT_FORMULA_COLOR;
}

function pngSize(dataUrl) {
  const comma = typeof dataUrl === "string" ? dataUrl.indexOf(",") : -1;
  if (comma < 0) {
    return null;
  }

  let header;
  try {
    // 24 bytes cover the signature and the IHDR width and height.
    header = atob(dataUrl.slice(comma + 1, comma + 1 + 32));
  } catch (error) {
    return null;
  }
  if (header.length < 24 || header.slice(1, 4) !== "PNG") {
    return null;
  }

  const readUint32 = (offset) =>
    ((header.charCodeAt(offset) << 24) >>> 0) +
    (header.charCodeAt(offset + 1) << 16) +
    (header.charCodeAt(offset + 2) << 8) +
    header.charCodeAt(offset + 3);
  return { width: readUint32(16), height: readUint32(20) };
}

function formatPx(value) {
  return `${Number(value.toFixed(2))}px`;
}

function formulaBox(result, isDisplayMath) {
  const size = pngSize(result && result.dataUrl);
  if (!size) {
    return null;
  }

  const renderScale = Number(result.renderScale) > 0 ? Number(result.renderScale) : 1;
  const width = size.width / renderScale;
  const height = size.height / renderScale;
  const depth = Number(result.depth) || 0;
  return {
    // Whole-pixel attributes for clients that only read those.
    attrs: `width="${Math.max(1, Math.round(width))}" height="${Math.max(1, Math.round(height))}"`,
    size: `width:${formatPx(width)};height:${formatPx(height)};`,
    verticalAlign: isDisplayMath ? "middle" : formatPx(-depth / renderScale),
  };
}

// fallback: render in the formula color with the white outline.
// white: the same formula rendered white without the outline.
// Text (alt, title, metadata) is added by the caller through the DOM.
function buildFormulaHtml({ fallback, white, isDisplayMath }) {
  const b = formulaBox(fallback, isDisplayMath);
  const w = formulaBox(white, isDisplayMath);
  if (!b || !w) {
    return "";
  }

  const fallbackStyle = `${b.size}vertical-align:${b.verticalAlign}`;
  const whiteStyle = `${w.size}vertical-align:${w.verticalAlign}`;
  return (
    '<span class="tblatex" contenteditable="false">' +
    `<span class="tbx-b"><img src="${fallback.dataUrl}" ${b.attrs} style="${fallbackStyle}"></span>` +
    `<span class="tbx-w" style="display:none;mso-hide:all;background-color:#ffffff;vertical-align:${w.verticalAlign}">` +
    '<span class="tbx-l3"><span class="tbx-l2"><span class="tbx-l1">' +
    `<img src="${white.dataUrl}" ${w.attrs} alt="" style="${whiteStyle}">` +
    "</span></span></span></span>" +
    `<span class="tbx-m" role="img" style="display:none;mso-hide:all;${whiteStyle};` +
    `background-color:currentColor;--tbx-mask:url(${white.dataUrl});` +
    "-webkit-mask-image:var(--tbx-mask);-webkit-mask-size:100% 100%;-webkit-mask-repeat:no-repeat;" +
    'mask-image:var(--tbx-mask);mask-size:100% 100%;mask-repeat:no-repeat"></span>' +
    "</span>"
  );
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DEFAULT_FORMULA_COLOR,
    WHITE_FORMULA_COLOR,
    TBLATEX_STYLES,
    buildFormulaHtml,
    formulaBox,
    formulaColor,
    normalizeColor,
    pngSize,
  };
}
