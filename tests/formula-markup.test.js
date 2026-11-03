"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_FORMULA_COLOR,
  TBLATEX_STYLES,
  buildFormulaHtml,
  formulaColor,
  pngSize,
} = require("../compose/formula-markup.js");

function fakePngDataUrl(width, height) {
  const bytes = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "latin1");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

// Minimal stand-ins for DOM elements: formulaColor only walks parents.
function element(tagName, { color = "", fontColor = null, parent = null } = {}) {
  return {
    tagName,
    style: { color },
    parentElement: parent,
    getAttribute: (name) => (name === "color" ? fontColor : null),
  };
}

test("pngSize reads the IHDR width and height", () => {
  assert.deepEqual(pngSize(fakePngDataUrl(352, 72)), { width: 352, height: 72 });
  assert.equal(pngSize("data:image/png;base64,AAAA"), null);
  assert.equal(pngSize("not a data url"), null);
});

test("formula color does not follow the compose theme", () => {
  const body = element("BODY");
  const paragraph = element("P", { parent: body });
  // Dark compose window: unstyled text is white, the formula must stay black.
  assert.equal(formulaColor(paragraph, "rgb(249, 249, 250)"), DEFAULT_FORMULA_COLOR);
  assert.equal(formulaColor(paragraph, "rgb(0, 0, 0)"), DEFAULT_FORMULA_COLOR);
  assert.equal(formulaColor(body, "rgb(249, 249, 250)"), DEFAULT_FORMULA_COLOR);
});

test("formula color follows a color the user set on the text", () => {
  const body = element("BODY");
  const red = element("SPAN", { color: "rgb(255, 0, 0)", parent: body });
  const inner = element("EM", { parent: red });
  assert.equal(formulaColor(inner, "rgb(255, 0, 0)"), "RGB 255 0 0");

  const font = element("FONT", { fontColor: "#0000ff", parent: body });
  assert.equal(formulaColor(font, "rgb(0, 0, 255)"), "RGB 0 0 255");
});

test("formula color ignores colors set on the body", () => {
  const body = element("BODY", { color: "rgb(255, 255, 255)" });
  const paragraph = element("P", { parent: body });
  assert.equal(formulaColor(paragraph, "rgb(255, 255, 255)"), DEFAULT_FORMULA_COLOR);
});

const fallback = { dataUrl: fakePngDataUrl(352, 72), depth: 16, renderScale: 4 };
const white = { dataUrl: fakePngDataUrl(345, 66), depth: 13, renderScale: 4 };

test("formula markup has the fallback, Gmail and mask forms in order", () => {
  const html = buildFormulaHtml({ fallback, white, isDisplayMath: false });
  const order = ["tbx-b", "tbx-w", "tbx-l3", "tbx-l2", "tbx-l1", "tbx-m"].map((c) => html.indexOf(`class="${c}"`));
  assert.ok(order.every((index) => index > 0), html);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(html.startsWith('<span class="tblatex" contenteditable="false">'));
  assert.ok(html.endsWith("</span>"));
});

test("formula markup sizes each image from its own render", () => {
  const html = buildFormulaHtml({ fallback, white, isDisplayMath: false });
  assert.ok(html.includes(`<img src="${fallback.dataUrl}" width="88" height="18" style="width:88px;height:18px;vertical-align:-4px">`));
  assert.match(html, /width="86" height="17" alt="" style="width:86.25px;height:16.5px;vertical-align:-3.25px"/);
  assert.match(html, /class="tbx-m" role="img" style="display:none;mso-hide:all;width:86.25px;height:16.5px;vertical-align:-3.25px;/);
});

test("formula markup hides the Gmail and mask forms unless a style block shows them", () => {
  const html = buildFormulaHtml({ fallback, white, isDisplayMath: false });
  assert.match(html, /class="tbx-w" style="display:none;mso-hide:all;background-color:#ffffff;/);
  assert.match(html, /class="tbx-m" role="img" style="display:none;mso-hide:all;/);
});

test("the mask draws the white render's shape in the text color", () => {
  const html = buildFormulaHtml({ fallback, white, isDisplayMath: false });
  assert.ok(html.includes(`background-color:currentColor;--tbx-mask:url(${white.dataUrl});`));
  assert.ok(html.includes("-webkit-mask-image:var(--tbx-mask);"));
  assert.ok(html.includes("mask-image:var(--tbx-mask);"));
});

test("display formulas are centered on the line", () => {
  const html = buildFormulaHtml({ fallback, white, isDisplayMath: true });
  assert.equal((html.match(/vertical-align:middle/g) || []).length, 4);
  assert.doesNotMatch(html, /vertical-align:-/);
});

test("formula markup needs both renders", () => {
  assert.equal(buildFormulaHtml({ fallback, white: { dataUrl: "" }, isDisplayMath: false }), "");
  assert.equal(buildFormulaHtml({ fallback: null, white, isDisplayMath: false }), "");
});

test("style blocks: one per mail client, in separate elements", () => {
  const [gmail, thunderbird, editor, apple] = TBLATEX_STYLES;
  assert.equal(TBLATEX_STYLES.length, 4);
  assert.ok(gmail.split("\n").filter(Boolean).every((rule) => rule.startsWith("u + .tbx-body ")));
  assert.ok(thunderbird.split("\n").filter(Boolean).every((rule) => rule.startsWith(".moz-text-html ")));
  assert.ok(editor.split("\n").filter(Boolean).every((rule) => rule.startsWith("body:read-write ")));
  assert.ok(apple.startsWith("@supports (-apple-color-filter: none) {"));
});

test("every client that shows the mask also hides the fallback image", () => {
  for (const block of TBLATEX_STYLES.slice(1)) {
    assert.match(block, /\.tbx-b \{ display:none !important; \}/);
    assert.match(block, /\.tbx-m \{ display:inline-block !important;/);
  }
});

test("only Apple Mail overrides the mask color", () => {
  const [, thunderbird, editor, apple] = TBLATEX_STYLES;
  assert.doesNotMatch(thunderbird, /background-color/);
  assert.doesNotMatch(editor, /background-color/);
  // Not exact black: Apple Mail would turn it exactly white and remove it.
  assert.match(apple, /\.tbx-m \{[^}]*background-color:#050505 !important;/);
});
