# LaTeX It! Local Helper

Use this helper when Thunderbird is sandboxed (for example Snap), so the
extension can render LaTeX by calling a local HTTP service outside the sandbox.

## Preferred (Linux): systemd user service

Install and start:

```sh
bash helper/install-systemd-user.sh
```

Service management:

```sh
systemctl --user status tblatex-helper.service
systemctl --user restart tblatex-helper.service
journalctl --user -u tblatex-helper.service -f
```

Uninstall service:

```sh
bash helper/uninstall-systemd-user.sh
```

Uninstall service and helper config:

```sh
bash helper/uninstall-systemd-user.sh --purge-config
```

## Fallback: run manually

```sh
python3 helper/tblatex_helper.py
```

Default listen address:
- `http://127.0.0.1:3737`

Optional env vars:
- `TBLATEX_HELPER_HOST` (default `127.0.0.1`)
- `TBLATEX_HELPER_PORT` (default `3737`)

## Endpoints

- `GET /health`
- `POST /render`
