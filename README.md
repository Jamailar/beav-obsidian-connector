# Beav Obsidian Connector

`Beav Connector` is a desktop-only Obsidian community plugin that connects one
local vault to the Beav desktop app. It supplies a typed snapshot, cached note
content, metadata, resolved links, and file deltas. It does not call AI models,
upload vault content, create manuscripts, or modify notes.

## Privacy and trust boundary

- The connector communicates only with a paired Beav instance over loopback.
- A vault must be explicitly paired before it is synchronized.
- Pairing credentials are encrypted with Electron safe storage and are not
  written as plaintext into Markdown, plugin source files, or normal plugin
  settings.
- The plugin is read-only. Beav must never use this connector to edit a note.

## Development

```bash
npm install
npm run verify
```

The build creates `main.js` in the repository root. For local testing, copy
`main.js`, `manifest.json`, `styles.css`, and `versions.json` into:

```text
<vault-config-directory>/plugins/beav-connector/
```

Restart or reload Obsidian, then enable **Beav Connector** under Community
plugins. The marketplace display name is intentionally `Beav Connector`; the
plugin ID must not contain `obsidian`.

## Release contract

Each GitHub release must publish exactly these installable assets:

- `main.js`
- `manifest.json`
- `styles.css`
- `versions.json`
- `SHA256SUMS.txt`

The Beav desktop app consumes a pinned release artifact and validates the
manifest ID, version, file list, and SHA-256 hashes before a user-authorized
side-load. Marketplace and side-load installations share `beav-connector` as
their plugin ID and the same protocol version.
