---
name: pixinsight-connector-troubleshooting
description: >-
  Use when a `pixinsight` MCP tool (pixinsight-connector) fails, refuses, reports a PixInsight
  console error, returns something that looks wrong, or PixInsight was paused or aborted. Covers
  reading the connector's call log, the Pause/Abort protocol, known tool pitfalls and their
  workarounds, and when to stop and ask the user. Also use for "why did this PixInsight call
  fail", "the connector is stuck", "PixInsight won't start".
license: MIT
metadata:
  author: mxcoppell
---

# Troubleshooting pixinsight-connector

## First: what actually happened

- **The connector logs every call in full** to `<workspace>/agentic/logs/*.jsonl`, one file per session: the tool input, the PJSR it sent, and PixInsight's raw result. When a result is unclear, read the latest entries there instead of guessing (logging is off when `PIXINSIGHT_CONNECTOR_LOG=0`).
- **Console errors are part of the result.** A line `[PixInsight console reported: ...]` holds the `*** Error` / `** Warning` lines PixInsight printed during the call. A process that declines to run says why only there.
- `whether any of it was applied is unknown` means the command was not re-run and may have partly applied: check the affected views before retrying.
- Tools can report success while damaging an image. After any step that is supposed to preserve a level (background, gradient, leveling), check the median with `get_image_stats`.

## Setup problems

| Symptom | Do this |
|---|---|
| No `pixinsight` tools at all | The server is not registered or did not start. Run `pixinsight-connector doctor` in a terminal; it checks Node, the PixInsight install, the workspace and the watcher, and prints a hint per failed check |
| Server fails to start when registered with `npx` | npx needs the npm registry until the package is cached. Install it (`npm install -g pixinsight-connector@2.4.0`) and register `pixinsight-connector` |
| Two `pixinsight` servers registered (by hand and by a plugin) | Keep one. Two connectors driving one PixInsight compete for its single script slot |
| `No usable workspace: ...` | The workspace is the filesystem root, the home folder itself, missing or unwritable. `set_workspace` to the target folder, then retry |
| `export_image` refuses a path | Absolute paths are allowed only under `<workspace>/output/` or `<workspace>/agentic/`. Use a relative path (lands in `output/`) |
| PixInsight does not start | It starts on the first tool call unless `PIXINSIGHT_CONNECTOR_AUTOSTART=0` (then start it yourself). `PIXINSIGHT_BIN` or `PIXINSIGHT_DIR` override where it is looked for |
| Something about Gaia, MARS or RC-Astro tools | Run `pixinsight-preflight`: `inspect_environment` asks PixInsight what is installed |

## Pause / Abort

If the user presses Pause/Abort in PixInsight, the call returns `STOPPED BY USER`. Stop, tell the user, and do not call `resume_bridge` until they say to continue. Never retry around it.

## Known tool pitfalls

| Symptom | Cause | Do this |
|---|---|---|
| `run_plate_solve` says "Plate solve OK" and the console adds `No database files have been selected` or `the Gaia process is not working, probably because of a wrong database configuration` | Printed by the Gaia process while the solve itself used DR3/SP (the result names its reference catalog) | Harmless when DR3/SP is valid (preflight). Confirm with `run_pjsr` `ImageWindow.windowById(id).astrometricSolutionSummary()` |
| `combine_channels` warns about inconsistent FOCALLEN/XPIXSZ/RADESYS; the result has no solution | Solution metadata is not propagated to the combined image | Plate-solve the combined view before SPCC |
| A PixelMath-made image (`pixelmath_new_image` without `size_from`, or `run_pjsr` PixelMath with a new image) has no astrometric solution | New images carry none | `pixelmath_new_image` copies `size_from`'s solution; otherwise `copy_astrometric_solution` from a solved file on the same grid |
| `run_mgc` refuses: flux metadata missing | SPFC did not run on that same view | `run_spfc` on it first (same view, not a clone) |
| `run_mgc`: `No reference data found for filter ...` | The MARS files do not cover this position | `inspect_environment` with `sections: ["mars"]` and the target's `ra_deg`/`dec_deg` shows the coverage; add MARS files for that sky area |
| `run_background_neutralization` succeeds but the median jumps and the MAD grows many times | It rescaled the image (seen on an image containing exact zeros) | SPCC already neutralizes the background; level with sky-tile offsets instead, and check the median afterwards |
| `run_pixelmath` reports samples truncated to [0,1] | PixInsight images hold [0,1] and clamp anything outside, silently in PJSR | Keep fluxes and gains above 1 in expressions or JSON, never in an image; `get_image_stats` `clampFractions` shows how much sits at exactly 0 or 1 |
| `save_preview` of linear data is black; JPEG "insufficient numerical accuracy" warning | Linear values; the warning is harmless | Pass a stretch: `stf_from` (a view whose STF to use; `set_stf` sets one) or `stf_m`/`stf_c0`, optionally with `crop` and `downsample` |
| `get_image_stats` MAD looks small | It is the raw MAD | Multiply by 1.4826 for MADN, the value STF formulas use |
| `measure_stars` reports `color_diversity` 0 and large FWHM on every image | Saturated star cores | Use `median_fwhm_px` only, comparatively (same image, before/after) |
| `measure_saturation` reports 0 on a linear image | It is tuned for 0-1 display data | Measure on a display copy |
| `PixelMath` new image gets id `X1` instead of `X` | An image `X` was already open | Close the old one first |
| `run_pjsr` refuses code with a line number | The code does not parse | Fix that line; `code` is a script (no top-level `return`, the last expression is the result) |
| `Invalid argument type` from a process property | A PJSR enum constant was undefined (they live on the process object, e.g. `IntegerResample.Average`, not on its prototype) | Use the constant's number, or read it from `describe_process` |
| A negative BXT `adjust_star_halos` | Deepens dark rings around bright stars | Keep halos at 0 unless you check the rings |
| `crop_image` / `resample_image` says the astrometric solution was removed | Geometric processes delete it (the connector suppresses the confirmation dialog) | `run_plate_solve` again before SPFC, SPCC or anything that needs coordinates |
| `run_mgc` refuses a mono image without `filter` | MGC would fit the wrong MARS band and can subtract real nebula | Pass the channel's `filter` (`L`, `R`, `G`, `B`, `Ha`, `OIII`, `SII`) |
| `PixInsight is busy with job ...` or `... WBPP run ... is running` | A `run_pjsr` `async` job or a `run_wbpp` run owns PixInsight | `job_status` / `wbpp_status` report it; `cancel_job` stops a job at its next `processEvents()` |
| A call ran long and says PixInsight may be showing a dialog | A modal dialog in PixInsight is waiting for a click | Ask the user to look at PixInsight and answer it; do not retry meanwhile |
| Every call fails with `crashed mid-command ... retry` although PixInsight was restarted (connector before 2.3.0) | A stale "busy" heartbeat | 2.3.0 clears it by itself; on older versions move `<workspace>/agentic/bridge/<machine>/heartbeat` aside |
| A starless image after `run_sxt` shows a faint rectangular grid, cells of about 470 px | StarXTerminator's tile overlap was too low: connectors before 2.4.0 defaulted to 0.10 | Run `run_sxt` with `overlap` 0.5 (the default from 2.4.0) and check the starless image again under a hard stretch |
| `reproject_to_reference` says a view has no astrometric solution | Both the source and the reference need one | `run_plate_solve` on each, then retry |
| Memory pressure | Each 32-bit colour image of a full-frame sensor is hundreds of MB, and snapshots add up | Export intermediates to XISF and close them |

## When to stop and ask the user

- A required input (camera QE, filters, position, scale) is missing: `pixinsight-target-intake`.
- A plate solve fails after a corrected seed.
- A gate keeps failing after one fix.
- Any choice of taste (brightness, noise reduction strength, sharpening).
- Before closing images the user may want to inspect, or writing anywhere outside `agentic/` and `output/`.
