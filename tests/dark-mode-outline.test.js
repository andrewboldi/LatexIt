"use strict";

// The white outline (\contour) is drawn by rewriting the LaTeX document in
// background.js. These tests load background.js with a stub browser API and,
// when latex and dvipng are installed, compile the rewritten documents.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");

function loadBackground() {
  const listener = { addListener() {} };
  const browser = new Proxy(
    {},
    {
      // Any browser.* namespace: listeners are ignored, calls resolve to {}.
      get: () =>
        new Proxy(listener, {
          get: (target, key) => (key in target ? target[key] : key.startsWith("on") ? listener : async () => ({})),
        }),
    }
  );
  const context = { browser, console: { ...console, error() {}, warn() {} }, setTimeout, clearTimeout };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8"), context);
  return context;
}

const background = loadBackground();
const template = vm.runInContext("DEFAULT_PREFS.template", background);
const fill = (expression) => template.replace("__REPLACE_ME__", expression);

test("\\[...\\] becomes display-style inline math inside the outline", () => {
  assert.equal(
    background.toInlineDisplayMath("\\[\\int_0^1 x\\,dx\\] % comment"),
    "$\\displaystyle \\int_0^1 x\\,dx$ % comment"
  );
  assert.equal(background.toInlineDisplayMath("$x^2$ % comment"), "$x^2$ % comment");
  assert.equal(background.toInlineDisplayMath("\\[a\\] and \\[b\\]"), "\\[a\\] and \\[b\\]");

  const outlined = background.applyDarkModeCompat(fill("\\[x^2\\]"));
  assert.ok(outlined.includes("\\contour{white}{%\n$\\displaystyle x^2$"));
  assert.ok(!outlined.includes("\\["));
});

const hasTex = ["latex", "dvipng"].every((bin) => spawnSync(bin, ["--version"]).status === 0);

function compile(document) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tblatex-test-"));
  try {
    const tex = path.join(dir, "formula.tex");
    fs.writeFileSync(tex, document);
    const latex = spawnSync("latex", [`-output-directory=${dir}`, "-interaction=batchmode", tex]);
    return latex.status;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("outlined formulas compile without LaTeX errors", { skip: !hasTex && "latex/dvipng not installed" }, () => {
  for (const expression of [
    "$x^2+y^2=z^2$",
    "$$\\sum_{i=1}^n i^2$$",
    "\\[\\int_0^1 x\\,dx = \\tfrac12\\]",
    "\\(a+b\\)",
  ]) {
    assert.equal(compile(background.applyDarkModeCompat(fill(expression))), 0, expression);
  }
});

test("environments that cannot be outlined fail, so the plain render is sent", { skip: !hasTex && "latex/dvipng not installed" }, () => {
  const align = fill("\\begin{align}a &= b\\\\ c &= d\\end{align}");
  assert.equal(compile(align), 0);
  assert.notEqual(compile(background.applyDarkModeCompat(align)), 0);
});
