---
name: pixinsight-lrgb-linear-basic
description: >-
  A basic starter flow for integrated mono LRGB masters (L, R, G, B in XISF or FITS) through the
  `pixinsight` MCP server (pixinsight-connector), linear all the way: border crop, BlurXTerminator
  correction, plate solving, SPFC, MultiscaleGradientCorrection, RGB combine, SPCC,
  BlurXTerminator sharpening, NoiseXTerminator, a linear L merge, sky leveling, and a 32-bit
  linear final with the standard auto-STF embedded, stars included. No colour adjustment, no star
  separation. Use for "process this LRGB data", "basic LRGB", "linear LRGB with PixInsight". Needs
  pixinsight-preflight and pixinsight-target-intake done first.
license: MIT
metadata:
  author: mxcoppell
---

# Basic LRGB, linear all the way

The deliverable is a 32-bit float linear image, stars included, with PixInsight's standard auto-STF embedded: open it in PixInsight and it displays stretched, while the pixel data stays linear. Nothing in this flow stretches, curves or tone-maps the image data. Display copies made for previews are throwaway and never feed back into the processing.

It is a basic flow on purpose: standard PixInsight tools with neutral settings, no colour adjustment, no star separation. Expect natural but muted colour under the linked auto-STF. Every parameter below is a starting point to tune for your data, not a calibrated value.

## Ground rules

- Tool names are bare here; your host may prefix them (e.g. `mcp__pixinsight__run_bxt`). Call one PixInsight tool at a time and read every result. A result flagged `PIXINSIGHT REPORTED AN ERROR`, `FAILED`, `REFUSED`, `BLOCKED`, `View not found` or `STOPPED BY USER` needs a decision, not a retry. After `STOPPED BY USER` stop and tell the user; call `resume_bridge` only when they say so. `pixinsight-connector-troubleshooting` covers known tool pitfalls.
- **PJSR helpers come from a file.** Every function named below is in `reference/pjsr-helpers.js` next to this file. Call `run_pjsr` with `include: ["<this skill's folder>/reference/pjsr-helpers.js"]` (absolute path) and put only the calls in `code`. `code` is a script: no top-level `return`; its last expression is the result.
- Masters are read-only; never write into their folder. Stage files go to `<workspace>/agentic/work/`, deliverables to `<workspace>/output/` (`export_image` takes a path relative to `output/`, or an absolute path under `output/` or `agentic/`).
- Keep a running call log as you go, one row per PixInsight call (sequence, tool, exact parameters, views in and out, one-line outcome). The report's appendix is this log, not a reconstruction.

## Phase 0 - Inputs

1. Read `<workspace>/agentic/preflight.json`. It must exist, be less than 30 days old, match the connected connector version, and list `pixinsight-lrgb-linear-basic` as `ready`. Otherwise run `pixinsight-preflight` first.
2. Read `<workspace>/agentic/work/target-info.md` (schema `pixinsight-target-info/1`). It must have `master.L`, `master.R`, `master.G`, `master.B`, `qe_curve`, `filter.L`, `filter.R`, `filter.G`, `filter.B`, `position_ra_deg`, `position_dec_deg`, `pixel_scale_arcsec`, and `mars_coverage` = `covered`. Otherwise run `pixinsight-target-intake` first. Use these values exactly; never take them from anywhere else.
3. This flow's own rows, under `## pixinsight-lrgb-linear-basic` in the same file: `stf_target` (default 0.25), `nxt_denoise` (default 0.5). Ask the user once if they want other values; record the answer or `default`.

## Phase 1 - Masters: crop, correct, solve, calibrate flux, remove gradients

1. For each channel: `open_image` with the exact `master.<channel>` path, `rename_view` to `L`, `R`, `G` or `B`.
2. **Crop registration borders first.** `run_pjsr` with `JSON.stringify(scanBorders("L", 60))`, and the same for R, G, B. Take the largest value per side over the four, add 10 px, and `crop_image` all four views by the same amounts.
3. Per channel: `run_bxt` with `correct_only: true`.
4. Per channel: `run_plate_solve` with `ra_deg`, `dec_deg` and `pixel_scale` from target-info. A console line `No database files have been selected` or `the Gaia process is not working, probably because of a wrong database configuration` next to "Plate solve OK ... Reference catalog: Gaia DR3/SP" is harmless when preflight found Gaia DR3/SP valid; confirm with `run_pjsr` `ImageWindow.windowById("L").astrometricSolutionSummary()` that a solution exists.
5. **Gate, alignment:** `run_pjsr` `[solutionOffset("L","R"), solutionOffset("L","G"), solutionOffset("L","B")]`. Every value below 1 px. Independent solutions of well-registered masters differ by a few hundredths of a percent in scale, which alone moves points this far from the centre by about half a pixel; a real registration error shows up as several pixels. Otherwise `align_to_reference` the offending channel to `L`, solve it again, and re-check. Still failing: stop and ask.
6. Per channel: `run_spfc` with `filter` (L/R/G/B), then `filter_name` (or `wavelength_nm`/`bandwidth_nm` for a `flat` row) and `qe_name` from target-info.
7. Per channel: `get_image_stats`, `run_mgc` with `filter`, `get_image_stats` again. **Gate:** median changed by less than 1%, MAD not larger. If MGC changed little, say so: well-stacked masters are often already flat.
8. `export_image` each channel to `<workspace>/agentic/work/<Target>_stage01_<ch>.xisf`.

## Phase 2 - RGB

1. `combine_channels` R, G, B → `RGB`. The combined image carries no solution: `run_plate_solve` it (same seed).
2. `run_spcc` on `RGB` with `red_filter_name`, `green_filter_name`, `blue_filter_name` and `qe_name` from target-info (and `white_reference` only if target-info names one). SPCC includes background neutralization; do not add another.
3. `run_bxt` on `RGB` with the tool's default sharpening (`sharpen_stellar` 0.5, `sharpen_nonstellar` 0.5, `adjust_star_halos` 0).
4. `run_nxt` on `RGB` with `denoise` = `nxt_denoise`.
5. `export_image` → `agentic/work/<Target>_stage02_RGB.xisf`.

## Phase 3 - L

`run_bxt` on `L` with the default sharpening, `run_nxt` with `denoise` = `nxt_denoise`, `export_image` → `agentic/work/<Target>_stage03_L.xisf`.

## Phase 4 - Linear L merge

1. Luminance of the RGB: `pixelmath_new_image` `output_id` `Y`, `size_from` `RGB`, `color` `gray`, `expression` `0.2126*RGB[0] + 0.7152*RGB[1] + 0.0722*RGB[2]`.
2. `linear_fit` `L` to `Y` (default rejection). L is now on the RGB luminance's scale.
3. `get_image_stats` on `Y`; let `e` be its median (a floor that keeps the ratio stable in the dark sky).
4. `pixelmath_new_image` `output_id` `N`, `size_from` `RGB`, `color` `rgb`, with `red` `RGB[0]*(L + e)/(Y + e)`, `green` `RGB[1]*(L + e)/(Y + e)`, `blue` `RGB[2]*(L + e)/(Y + e)` (write the number for `e`). Each pixel keeps its colour ratios and takes its brightness from L.
5. `export_image` → `agentic/work/<Target>_stage04_N.xisf`.

## Phase 5 - Sky leveling

1. `run_pjsr`: `var t = findSkyTiles("N", {}); JSON.stringify({ t: t, med: skyMedians("N", t.tiles) })`. Check the tiles spread over the frame (`nTiles`, positions); if fewer than four were found, report it.
2. Offsets that bring the sky medians of R and B to G: `[med[1] - med[0], 0, med[1] - med[2]]`. `run_pjsr` `addOffsets("N", [dR, 0, dB])`.
3. **Gate:** `skyMedians("N", <same tiles>)` again: R and B within 0.5% of G, G unchanged.

## Phase 6 - STF, deliverables, checks

1. `run_pjsr`: `var s = autoSTF("N", <stf_target>); JSON.stringify(s)`.
2. `run_pjsr`: `JSON.stringify(saveWithSTF("N", "<workspace>/output/<Target>_LRGB_basic_linear.xisf", <s>))`. **Gate:** `same` is true (the STF read back from the file equals the one set).
3. Preview: `run_pjsr` `stfCopy("N", "N_display", <s>)`, then `save_preview` of `N_display` and read the JPEG; `export_image` `N_display` to `<Target>_LRGB_basic_preview.png`. Close `N_display` afterwards.
4. **Checks**, reported with their numbers:
   - Display-domain sky neutrality: `skyMedians("N_display", <tiles>)` channels within 0.02 of each other.
   - Black clipping: fraction of `N_display` pixels at 0 at most 1.5%.
   - Star FWHM: `measure_stars` on `N`, field `median_fwhm_px` (informational).
5. Show the user the preview.

## Phase 7 - Report

Write `<workspace>/output/<Target>_LRGB_basic_report.md` with two parts:

- **Narrative:** every input and its source (from target-info.md), every parameter used, every gate with its measured value and threshold, every stage file path, and the limits below.
- **Call-log appendix:** the running log, every PixInsight call in order, retries included. Do not summarize it.

Leave the working images open unless the user asks to close them.

## Known limits

- Colour is what SPCC gives: under a linked auto-STF on linear data it looks muted. This flow does not boost saturation.
- Noise reduction is two NXT passes at one strength, stars included; small stars can soften at high `nxt_denoise`.
- Stars are part of the image throughout; nothing shapes or reduces them. Bright star cores come out flat and white: L's saturated cores are scaled below 1 by `linear_fit`, and the merge takes brightness from L.
- The flow has been run end to end on one real mono LRGB dataset (PixInsight 1.9.5, macOS). It is not validated on Windows or Linux, on masters that need `align_to_reference`, or on an RGB-only dataset.
