---
name: pixinsight-target-intake
description: >-
  Use before processing a folder of integrated astrophotography masters (XISF or FITS) through
  the `pixinsight` MCP server, or when a processing skill says target info is missing. Scans the
  masters, maps each file to a channel, and resolves every input the processing needs from the
  headers: camera QE curve, filter curves, position, pixel scale. Checks MARS coverage at the
  target's position. Whatever the headers do not say is asked in ONE consolidated question, never
  guessed. Writes agentic/work/target-info.md, which processing skills read. Also use for "set up
  this target", "what do you need to know about my data".
license: MIT
metadata:
  author: mxcoppell
---

# Target intake

Every processing flow needs the same facts about a dataset before it touches a pixel. This skill collects them once, records where each came from, and writes them to `<workspace>/agentic/work/target-info.md`. It processes nothing and never writes into the masters' folder.

**Rule:** a value comes from the data (a header, a `find_filters` match, a computation from headers) or from the user. Never from another target's records, never from a default the user did not accept. `null` in a header means "ask", not "use a default".

## 1. Workspace and scan

1. If `agentic/preflight.json` is missing or stale (see `pixinsight-preflight`), run preflight first.
2. If the user named the target folder, `set_workspace` to it; otherwise `workspace_info` shows the launch folder, which must be a real target folder (not a filesystem root or the home folder).
3. `scan_workspace`. It scans recursively (skipping `agentic/` and `output/`) and reports per file `filter`, geometry, exposure, `hasWCS`, and `keywords` (`INSTRUME`, `TELESCOP`, `FOCALLEN`, `XPIXSZ`, `YPIXSZ`, `XBINNING`, each verbatim or `null`).
4. If `agentic/work/target-info.md` already exists (a resumed session), read it: keep what it records, re-check each row against this scan, and ask only about rows that are missing or that a header now contradicts.

## 2. Resolve each row

| Key | How | When the data does not say |
|---|---|---|
| `target_name` | — | offer the workspace folder name |
| `master.<channel>` | Map each file to a channel from `FILTER`, then the file name. Record the exact `path` `scan_workspace` returned | Ask when a file is ambiguous or a channel the flow needs is missing |
| `qe_curve` | `INSTRUME` → `find_filters` (channel `Q`). Search the sensor number and shorter tokens: curves can carry a combined name such as `Sony IMX411/455/461/533/571` | Ask. A wrong curve is a categorical error. The user may choose PixInsight's `Ideal QE curve`: record it as their choice |
| `filter.<channel>` | `FILTER` when it names a brand or set that `find_filters` resolves (a bare `Red` does not) | Ask. A flat passband only if the user chooses it (record `flat <center> nm / <width> nm`); a generic luminance filter is `flat 550 / 300` |
| `position_ra_deg`, `position_dec_deg` | RA/DEC keywords if the scan shows them | Offer the catalogue position of the named target, stated for the user to confirm |
| `pixel_scale_arcsec` | 206.265 × `XPIXSZ` × `XBINNING` / `FOCALLEN` (µm, mm) | Ask for focal length and pixel size, or the scale, and whether the stacker resampled (a half-resolution integration doubles it) |
| `spcc_white_reference` | — | PixInsight's SPCC default (record `default`) |
| `mars_coverage` | Once the position is known: `inspect_environment` with `sections: ["mars"]`, `ra_deg`, `dec_deg`. `covered: true` → `covered`, with each file's `referenceImages` | `covered: false` → record `not covered` and tell the user MGC cannot run for this target |

## 3. Ask once

If any row is still open, stop and ask the user in **one** consolidated message:

- what came from the headers, so they can correct it,
- each open row, with the default to offer if the table above has one.

Wait for the answer. In a run with nobody to answer, stop and report what is missing instead of continuing.

## 4. Write `agentic/work/target-info.md`

With your own file tool (the connector has no text writer):

```markdown
# Target info

schema: pixinsight-target-info/1

| Key | Value | Source |
|---|---|---|
| target_name | <name> | user <date> |
| master.L | <path from scan_workspace> | header FILTER=<value> of <file> |
| filter.L | flat 550 / 300 | default accepted by user <date> |
| qe_curve | <curve name from find_filters> | header INSTRUME=<value> via find_filters |
| position_ra_deg | <degrees> | catalogue position confirmed by user <date> |
| pixel_scale_arcsec | <arcsec/px> | computed from FOCALLEN, XPIXSZ, XBINNING |
| spcc_white_reference | default | default |
| mars_coverage | covered (<file>: <n> reference images) | inspect_environment <date> |
```

One row per key, one `master.*` and `filter.*` row per channel. Source is one of: `header <KEY> of <file>`, `computed from ...`, `find_filters`, `user <date>`, `default accepted by user <date>`, `skipped by user <date>`, `inspect_environment <date>`.

A processing flow may append its own rows (look preferences, a reference image) under a `## <flow name>` heading in the same file. Those rows belong to that flow; this skill leaves them alone when it updates the file.

Update the file whenever the user changes an answer.
