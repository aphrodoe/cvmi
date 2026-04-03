---
'cvmi': patch
---

Add field extraction and flexible raw output modes to `cvmi call`.

- add `--extract <path>` for printing a targeted value such as `content[0].data`
- make `--raw` emit compact JSON by default for machine-friendly pipelines
- add `--pretty-raw` for indented raw JSON output when human readability is preferred
