#!/usr/bin/env python3
"""
Local LaTeX rendering helper for sandboxed Thunderbird installations.

Starts a localhost HTTP service with:
  GET  /health
  POST /render
"""

from __future__ import annotations

import base64
import json
import os
import re
import shutil
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

PREVIEW_PACKAGE_RE = re.compile(
    r"^[^%]*\\usepackage\[(.*,\s*)?active(,.*)?\]{(.*,\s*)?preview(,.*)?}",
    re.MULTILINE,
)
FONT_NUMBER_RE = re.compile(r"[-+]?\d*\.?\d+")
DEFAULT_RENDER_SCALE = 4.0


def normalize_path(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    trimmed = value.strip()
    if len(trimmed) >= 2 and trimmed[0] == trimmed[-1] and trimmed[0] in ("'", '"'):
        trimmed = trimmed[1:-1].strip()
    return trimmed


def select_executable(requested_path: Any, executable_name: str) -> tuple[str, str]:
    requested = normalize_path(requested_path)
    if requested and os.path.exists(requested) and os.access(requested, os.X_OK):
        return requested, requested
    auto = shutil.which(executable_name) or ""
    return auto, requested


def parse_font_px(value: Any, fallback: int) -> float:
    if isinstance(value, str):
        match = FONT_NUMBER_RE.search(value)
        if match:
            try:
                parsed = float(match.group(0))
                if parsed > 0:
                    return parsed
            except ValueError:
                pass
    try:
        parsed = float(value)
        if parsed > 0:
            return parsed
    except (TypeError, ValueError):
        pass
    return float(fallback)


def parse_render_scale(value: Any, fallback: float = DEFAULT_RENDER_SCALE) -> float:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = int(fallback)
    return float(min(8, max(1, parsed)))


def run_command(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )


def render(payload: dict[str, Any]) -> dict[str, Any]:
    latex_expression = payload.get("latexExpression", "")
    if not isinstance(latex_expression, str):
        return {
            "status": 2,
            "depth": 0,
            "dataUrl": "",
            "log": "!!! Invalid latexExpression payload.\n",
        }

    if not PREVIEW_PACKAGE_RE.search(latex_expression):
        return {
            "status": 2,
            "depth": 0,
            "dataUrl": "",
            "log": "!!! The package 'preview' (active mode) cannot be found in the LaTeX template.\n",
        }

    latex_path, requested_latex_path = select_executable(payload.get("latexPath"), "latex")
    if not latex_path:
        return {
            "status": 2,
            "depth": 0,
            "dataUrl": "",
            "log": (
                "!!! Wrong path for 'latex' executable: "
                f"\"{requested_latex_path or '(auto)'}\".\n"
            ),
        }

    dvipng_path, requested_dvipng_path = select_executable(payload.get("dvipngPath"), "dvipng")
    if not dvipng_path:
        return {
            "status": 2,
            "depth": 0,
            "dataUrl": "",
            "log": (
                "!!! Wrong path for 'dvipng' executable: "
                f"\"{requested_dvipng_path or '(auto)'}\".\n"
            ),
        }

    keep_temp_files = bool(payload.get("keepTempFiles", False))
    debug = bool(payload.get("debug", False))
    autodpi = bool(payload.get("autodpi", True))
    default_font_px_raw = payload.get("defaultFontPx", 16)
    try:
        default_font_px = int(default_font_px_raw)
        if default_font_px <= 0:
            default_font_px = 16
    except (TypeError, ValueError):
        default_font_px = 16

    font_px_value = (
        parse_font_px(payload.get("fontPx", ""), default_font_px)
        if autodpi
        else float(default_font_px)
    )
    render_scale = parse_render_scale(payload.get("renderScale", DEFAULT_RENDER_SCALE))
    base_dpi = font_px_value * 72.27 / 10.0
    dpi = base_dpi * render_scale
    font_color = str(payload.get("fontColor", "")).strip() or "RGB 0 0 0"

    status = 0
    log_lines: list[str] = []

    temp_dir = tempfile.mkdtemp(prefix="tblatex-helper-")
    tex_file = os.path.join(temp_dir, "tblatex.tex")
    dvi_file = os.path.join(temp_dir, "tblatex.dvi")
    png_file = os.path.join(temp_dir, "tblatex.png")

    try:
        with open(tex_file, "w", encoding="utf-8") as handle:
            handle.write(latex_expression)

        latex_args = [
            latex_path,
            f"-output-directory={temp_dir}",
            "-interaction=batchmode",
            tex_file,
        ]
        latex_result = run_command(latex_args)
        if latex_result.returncode != 0:
            status = 1
            log_lines.append(
                f"LaTeX process returned {latex_result.returncode}. Proceeding anyway..."
            )

        if not os.path.exists(dvi_file):
            return {
                "status": 2,
                "depth": 0,
                "dataUrl": "",
                "log": (
                    "\n".join(log_lines)
                    + "\n!!! LaTeX did not output a .dvi file, something went wrong.\n"
                ),
            }

        dvipng_args = [
            dvipng_path,
            "--depth",
            "-T",
            "tight",
            "-z",
            "3",
            "-bg",
            "Transparent",
            "-D",
            str(dpi),
            "-fg",
            font_color,
            "-o",
            png_file,
            dvi_file,
        ]
        dvipng_result = run_command(dvipng_args)
        if dvipng_result.returncode != 0 or not os.path.exists(png_file):
            return {
                "status": 2,
                "depth": 0,
                "dataUrl": "",
                "log": (
                    "\n".join(log_lines)
                    + f"\n!!! dvipng failed with code {dvipng_result.returncode}. Rendering aborted.\n"
                ),
            }

        with open(png_file, "rb") as handle:
            encoded = base64.b64encode(handle.read()).decode("ascii")

        if keep_temp_files:
            log_lines.append(f"Temporary files kept in {temp_dir}")

        if debug:
            log_lines.append(f"*** helper latex path: {latex_path}")
            log_lines.append(f"*** helper dvipng path: {dvipng_path}")
            log_lines.append(
                f"*** helper dpi: {dpi} (base={base_dpi}, scale={render_scale}x)"
            )
            log_lines.append(f"*** helper font color: {font_color}")

        return {
            "status": status,
            "depth": 0,
            "dataUrl": f"data:image/png;base64,{encoded}",
            "renderScale": render_scale,
            "log": ("\n".join(log_lines) + "\n") if log_lines else "",
        }
    finally:
        if not keep_temp_files:
            shutil.rmtree(temp_dir, ignore_errors=True)


class RequestHandler(BaseHTTPRequestHandler):
    server_version = "tblatex-helper/0.1"

    def _send_json(self, status_code: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        route = self.path.split("?", 1)[0]
        if route != "/health":
            self._send_json(404, {"ok": False, "error": "not found"})
            return

        self._send_json(
            200,
            {
                "ok": True,
                "service": "tblatex-helper",
                "version": "0.1",
                "latexAvailable": bool(shutil.which("latex")),
                "dvipngAvailable": bool(shutil.which("dvipng")),
            },
        )

    def do_POST(self) -> None:  # noqa: N802
        route = self.path.split("?", 1)[0]
        if route != "/render":
            self._send_json(404, {"ok": False, "error": "not found"})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._send_json(400, {"ok": False, "error": "invalid content length"})
            return

        raw_body = self.rfile.read(content_length)
        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._send_json(400, {"ok": False, "error": "invalid json payload"})
            return

        try:
            result = render(payload if isinstance(payload, dict) else {})
            self._send_json(200, result)
        except Exception as error:  # pragma: no cover
            self._send_json(
                500,
                {
                    "status": 2,
                    "depth": 0,
                    "dataUrl": "",
                    "log": f"!!! Helper internal error: {error}\n",
                },
            )

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[tblatex-helper] {self.address_string()} - {fmt % args}")


def main() -> None:
    host = os.environ.get("TBLATEX_HELPER_HOST", "127.0.0.1")
    port_raw = os.environ.get("TBLATEX_HELPER_PORT", "3737")
    try:
        port = int(port_raw)
    except ValueError:
        port = 3737

    server = ThreadingHTTPServer((host, port), RequestHandler)
    print(f"tblatex-helper listening on http://{host}:{port}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping tblatex-helper...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
