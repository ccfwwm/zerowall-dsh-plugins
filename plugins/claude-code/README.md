# ZeroWall Claude Code

`@zerowallscience/plugin-claude-code` adds Claude Code as an optional, independently versioned ZeroWall plugin. It is designed for the ZeroWall desktop app 8.4.7 or later and DSH `0.2.1-rc.2`.

## Isolation and installation

In ZeroWall 8.4.7, open Settings → Extension Center → Plugins, install this plugin, then choose Enable on its installed entry. The Claude Code action appears in the conversation header after activation. Open it and choose Install CLI to provision the isolated runtime.

Claude Code is installed only after the user chooses Install or Update. The plugin uses ZeroWall's bundled pnpm and the npmmirror registry to install the pinned `@anthropic-ai/claude-code` CLI into plugin-owned application data. The CLI runs by absolute path with its own config, home and package-store directories. It does not adopt, inspect or modify a user's existing Claude Code configuration, and the Claude CLI/SDK is not part of the desktop runtime.

The plugin is available only in the ZeroWall Desktop host. It does not provide a system-wide Claude installation or a PATH command.

## Conversation routing and workspace access

Each new run reads the selected conversation's current model route. It supports routes explicitly identified as Anthropic Messages compatible and passes the credential to the child process only for that run. Credentials are not written to plugin configuration, logs, UI or conversation history. Other protocols are reported as unsupported; the plugin does not translate requests between protocols.

The session action starts Claude Code in the current project with `acceptEdits`, allowing automatic file edits. Enabled, compatible MCP servers are authorized for that run. It runs in noninteractive print mode: commands that require additional permission can be rejected. The plugin does not grant unrestricted command execution.

Eligible enabled Skills and independently launchable MCP servers are projected into the isolated Claude Code environment. The plugin does not rewrite the source Skills or MCP definitions. Managed MCP services that cannot be launched independently are reported as unsupported. MCP credential references are resolved through the host's controlled credential service and are never copied as plaintext into Claude configuration.

## Version and source

- ZeroWall plugin: `0.1.0`
- Claude Code CLI: `2.1.309`
- Upstream adapter reference: [`Norman-else/dsh-claude`](https://github.com/Norman-else/dsh-claude/tree/fe00e3af0b1ad03acc977b13b4d4ab805086f6da), tag `v0.1.65`, commit `fe00e3af0b1ad03acc977b13b4d4ab805086f6da`
- License: MIT; see [`LICENSE`](./LICENSE)

This ZeroWall plugin is a native adaptation. It does not include the upstream Claude Agent SDK adapter or its behavior of reusing the user's Claude profile.
