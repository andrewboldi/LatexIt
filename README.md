Latex It!
=========

Description
-----------

This extension runs local `latex` and `dvipng` binaries to convert `$...$` and
`$$...$$` expressions into inline images while composing HTML emails in
Thunderbird.

The add-on now uses the MailExtension + Experiment API model and targets
Thunderbird **140+**.

Features
--------

- Run LaTeX conversion on all matching expressions in a compose window
- Undo / undo all inserted images
- Insert complex LaTeX at cursor position
- Configure executable paths, template, DPI behavior, and debug/log options
- Auto-detect `latex` and `dvipng` in your PATH
- Auto-fallback to local helper service for sandboxed Thunderbird installs

Requirements
------------

- Thunderbird 140 or newer
- A local TeX setup with:
  - `latex`
  - `dvipng`
- For sandboxed Thunderbird (Snap/Flatpak), run the local helper service:
  `python3 helper/tblatex_helper.py`

Build
-----

Run:

```sh
make
```

This produces `tblatex.xpi`.

Install
-------

1. Build the extension:

```sh
make
```

2. In Thunderbird, open `Add-ons and Themes`.
3. Click the gear icon and choose `Install Add-on From File...`.
4. Select `tblatex.xpi`.
5. Open `LaTeX It!` options and confirm `latex` / `dvipng` paths (or click autodetect).
6. If Thunderbird is sandboxed, enable helper fallback in options and make sure
   helper URL matches your helper service.

Development install (temporary)
-------------------------------

1. In Thunderbird, open `Tools -> Developer Tools -> Debug Add-ons`.
2. Click `Load Temporary Add-on...`.
3. Select this repository's `manifest.json`.

Usage Notes
-----------

- Conversion works in **HTML compose mode**.
- In a compose window, use the `LaTeX It!` compose action menu and click
  `Run LaTeX in body`.
- This converts expressions like `$\frac{2}{3}$` and
  `$$\boxed{\frac{34}{31}}$$` into inline PNG images.
- Default shortcut for silent conversion:
  `Ctrl+Shift+L` (`Cmd+Shift+L` on macOS).

Sandbox Fallback (Snap/Flatpak)
-------------------------------

1. Start helper:

```sh
python3 helper/tblatex_helper.py
```

2. In extension options:
- Enable `local helper fallback`.
- Set helper URL to `http://127.0.0.1:3737` (or your custom host/port).
- Click `Test helper`.

When direct binary execution is blocked by sandboxing, LaTeX It! will
automatically route rendering through the helper.
