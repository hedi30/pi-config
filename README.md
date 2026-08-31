# Pi dotfiles

Reproducible, secret-safe configuration for the [Pi coding agent](https://pi.dev).

This repository captures durable preferences and package declarations while deliberately keeping authentication, sessions, trust decisions, caches, and project credentials local to each computer.

## What it manages

| File | Purpose |
| --- | --- |
| `config/settings.json` | Default model, thinking level, UI preferences, telemetry choice, and pinned global packages |
| `config/keybindings.json` | Pi keyboard overrides |
| `config/extensions/pi-tool-display/config.json` | Shared `pi-tool-display` rendering preferences |
| `versions.env` | Auditable pins for Pi, packages, and the minimum Node.js version |

Current pins:

- `@earendil-works/pi-coding-agent` 0.84.4
- `pi-powerline-footer` 0.16.0
- `pi-mcp-adapter` 2.31.0
- Node.js 20 or newer

## Quick start

Install Node.js 20+ and Git, then:

```bash
git clone <REMOTE> ~/.config/pi-dotfiles
cd ~/.config/pi-dotfiles
./install.sh
```

The installer is idempotent. It:

1. validates every repository JSON file and scans for common secret patterns;
2. installs the pinned Pi CLI when needed;
3. merges tracked settings over existing settings without deleting unrelated keys;
4. deploys keybindings and tool-display configuration;
5. reconciles the pinned global Pi packages.

Changed local files are backed up under:

```text
${XDG_STATE_HOME:-~/.local/state}/pi-dotfiles/backups/
```

Then start Pi and authenticate on that computer:

```text
pi
/login
```

### Installer options

```text
./install.sh --dry-run
./install.sh --skip-cli
./install.sh --skip-packages
```

Set `PI_CODING_AGENT_DIR` before running the installer to target a non-default Pi agent directory.

## Updating the repository from a configured machine

Review before committing:

```bash
./export.sh --dry-run
./export.sh
./validate.sh
git diff --check
git diff
```

The exporter copies the managed files from `${PI_CODING_AGENT_DIR:-~/.pi/agent}` and omits machine/runtime settings such as `lastChangelogVersion`, analytics tracking IDs, proxy configuration, and session paths. It fails closed when it detects secret-like keys, tokens, private keys, or URLs with embedded credentials.

Useful Make targets are also available:

```bash
make validate
make dry-run
make install
make export-dry-run
make export
```

## Secrets and machine-local state

Never add these to this repository:

- `~/.pi/agent/auth.json`
- sessions or exported transcripts
- MCP credentials or OAuth material
- `.env` files
- trust decisions
- model, MCP, or context caches
- installed package directories

Authentication is intentionally repeated with `/login` on every computer. MCP OAuth credentials remain in the operating system credential store.

GitHub Actions validates JSON, checks package pins, runs a conservative secret-pattern scan, checks shell syntax, and exercises the installer in dry-run mode.

## PackID MCP configuration

`examples/packid.mcp.json` is a credential-free starting point. Copy it to a PackID project as `.mcp.json`, then provide these variables outside Git:

```text
PACKID_POSTGRES_MCP_URL
GLITCHTIP_POSTGRES_MCP_URL
```

For example, launch Pi from a shell or `direnv` environment populated by your password manager. Do not put database URLs containing passwords in tracked files.

The MCP adapter supports `${VAR}` interpolation in stdio arguments. Missing variables become empty strings, so verify both variables are set before starting Pi:

```bash
: "${PACKID_POSTGRES_MCP_URL:?not set}"
: "${GLITCHTIP_POSTGRES_MCP_URL:?not set}"
pi
```

## Project-local Pi configuration

Project packages, prompts, and skills should normally live in the project repository rather than here. Track safe files such as:

```text
.pi/settings.json
.pi/prompts/*.md
```

Ignore generated state narrowly instead of ignoring all of `.pi`:

```gitignore
/.pi/npm/
/.pi/git/
/.pi/structured-returns/
/.pi/sessions/
/.pi/mcp.json
```

After cloning a trusted project, Pi installs missing project packages declared in `.pi/settings.json`. Pin package versions when reproducibility matters.

For the current PackID frontend setup, the reproducible package declarations are:

```json
{
  "packages": [
    "npm:pi-tool-display@0.5.0",
    "npm:@sentiolabs/pi-frontend-design@0.1.1"
  ]
}
```

## Design choices

- **Dedicated repository instead of making `~/.pi/agent` a Git repository:** prevents accidental commits of credentials and hundreds of megabytes of sessions.
- **Copies instead of symlinks:** Pi can safely update runtime fields without dirtying the dotfiles checkout.
- **Pinned versions:** a new computer gets the tested combination rather than whatever `latest` means that day.
- **Merge on install:** unrelated local settings survive, while tracked preferences remain authoritative.
- **No external script dependencies:** management uses the Node.js runtime already required by Pi.
