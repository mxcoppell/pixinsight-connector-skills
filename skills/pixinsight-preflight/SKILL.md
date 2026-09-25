---
name: pixinsight-preflight
description: >-
  Use before any PixInsight processing session run through the `pixinsight` MCP server
  (pixinsight-connector), or when a processing skill says preflight is missing or stale. Checks
  that the connector is connected and which PixInsight it drives, which Gaia databases are
  installed and readable, whether the MARS database files for MultiscaleGradientCorrection are
  readable, and which BlurXTerminator, NoiseXTerminator and StarXTerminator versions and AI model
  versions are installed. Writes agentic/preflight.json, which processing skills read. Also use
  for "check my PixInsight setup", "is Gaia installed", "which BXT model do I have".
license: MIT
metadata:
  author: mxcoppell
---

# PixInsight preflight

Asks PixInsight itself what is installed, then says what that means for the processing flows. It changes nothing in PixInsight: the probes run on temporary images that are closed afterwards, and no open image is touched.

## 1. The connector is there

The `pixinsight` MCP tools (the host may prefix them, e.g. `mcp__pixinsight__inspect_environment`) must be available. If there are no such tools, stop and tell the user how to get them, then stop:

- This skill pack's plugin registers the server itself. If the user installed only the skills, they register the server by hand: `npm install -g pixinsight-connector@2.2.1`, then the command `pixinsight-connector` as the MCP server `pixinsight` in their harness. Each harness's config shape: <https://github.com/mxcoppell/pixinsight-connector/blob/main/docs/setup.md>.
- `pixinsight-connector doctor` diagnoses a server that is registered but does not start.
- Register one `pixinsight` server, not two. Two connectors driving one PixInsight compete for its single script slot.

If the tools exist but `inspect_environment` does not, the connector is older than 2.2.0: tell the user to upgrade (`npm install -g pixinsight-connector@2.2.1`, or update this plugin) and stop.

## 2. Workspace

Call `workspace_info`. If the user named a target folder, `set_workspace` to it first. A filesystem root, the home folder itself, or an unwritable folder is not usable: ask for the target folder. `agentic/preflight.json` is written under the workspace.

## 3. Run the inspection

Call `inspect_environment` with no arguments. It takes about 10 seconds (three short RC-Astro runs and one MGC run per MARS file) and returns JSON with four sections. PixInsight starts on the first call if it is not running.

## 4. Turn the result into verdicts

Report one table, PASS / WARN / FAIL per row, with the evidence from the JSON:

| Check | PASS when | FAIL / WARN |
|---|---|---|
| Connector | `connectorVersion` is 2.2.0 or later | FAIL: older |
| PixInsight | `pixinsightVersion` is 1.9.5 or later | WARN: older, untested |
| Gaia DR3/SP | the `DR3/SP` release has `valid: true`, `meanSpectra: true`, and `gaia.search.ok` with `sources > 0` | FAIL: SPFC, SPCC and `run_plate_solve` (which solves against local DR3/SP) cannot run |
| Other Gaia releases | informational | A release with `valid: false` is not installed. Its `error` may read `No database files have been selected`, the same console line `run_plate_solve` can print next to a successful solve; it is harmless when DR3/SP is valid |
| MARS files | `mars.results` non-empty and every file `readable` | FAIL: `none-configured` (MGC cannot run: install MARS files and add them in MultiscaleGradientCorrection's preferences), `missing` or `corrupt` (name the file) |
| MARS coverage | not checked here | Coverage depends on the target's position; `pixinsight-target-intake` checks it |
| BlurXTerminator, NoiseXTerminator, StarXTerminator | `installed` and `ran`; report `version`, `mlVersion`, `device` | FAIL: not installed. WARN: `device` is `cpu` (works, much slower) or a field is null (the banner was not printed; report `log`) |
| Memory | `system.totalMemoryBytes` at least 16 GB | WARN below that: a full-size LRGB session keeps several 32-bit colour images open. Report `freeMemoryBytes` but do not judge it: macOS counts cached memory as used, so it reads low on a healthy machine |
| Disk | `system.workspaceFreeBytes` at least 5 GB | WARN below that; null means unknown |

Do not re-derive these facts another way (reading folders, guessing from file names): the tool asked PixInsight, and its answer is the record.

## 5. Requirements per flow

A processing skill states what it needs. The ones in this pack:

| Flow | Needs |
|---|---|
| `pixinsight-target-intake` | connector, PixInsight; Gaia DR3/SP only if it will check MARS coverage |
| `pixinsight-lrgb-linear-basic` | connector, PixInsight, Gaia DR3/SP, MARS readable (coverage at the target), BXT, NXT |

Say for each flow whether it can run. A FAIL in a row a flow needs means that flow cannot start; a WARN is reported and does not block.

## 6. Write `agentic/preflight.json`

With your own file tool (the connector has no text writer), write `<workspace>/agentic/preflight.json`:

```json
{
  "schema": "pixinsight-preflight/1",
  "checkedAt": "<ISO 8601 time>",
  "connectorVersion": "<from the result>",
  "pixinsightVersion": "<from the result>",
  "verdicts": { "gaiaDr3sp": "PASS", "mars": "PASS", "blurXTerminator": "PASS", "noiseXTerminator": "PASS", "starXTerminator": "PASS", "memory": "PASS", "disk": "WARN" },
  "flows": { "pixinsight-lrgb-linear-basic": "ready" },
  "inspection": { "...": "the inspect_environment JSON, unchanged" }
}
```

`flows` values are `ready` or `blocked: <reason>`. A processing skill treats the file as stale, and asks for preflight again, when it is older than 30 days, when `connectorVersion` differs from the connector now connected, or when the user says they installed or changed something.

## 7. Tell the user

The table, the per-flow verdicts, and for every FAIL the one action that fixes it. Nothing else runs until the user has fixed a blocking FAIL.
