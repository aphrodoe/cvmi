---
'cvmi': patch
---

Enable MCP progress handling by default in `cvmi call`.

- always pass an `onprogress` handler so MCP requests get a progress token automatically
- enable timeout resets on progress updates for long-running and oversized transfers
- print progress updates during tool calls when `--verbose` is enabled
