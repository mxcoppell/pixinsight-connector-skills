# pixinsight-connector-skills

Agent skills for [pixinsight-connector](https://github.com/mxcoppell/pixinsight-connector), the MCP server
that lets an AI agent operate PixInsight. The connector is a toolbox with no processing workflow; these skills
are a starting point: check the machine, describe the dataset, and run one basic, fully linear LRGB flow.

| Skill | What it does |
|---|---|
| `pixinsight-preflight` | Asks PixInsight what is installed: Gaia databases (and a test search), MARS files for MultiscaleGradientCorrection (and a test run), BlurXTerminator / NoiseXTerminator / StarXTerminator versions and AI model versions, memory and disk. Says which flows can run. Writes `agentic/preflight.json` |
| `pixinsight-target-intake` | Maps masters to channels and resolves camera QE, filter curves, position and pixel scale from the headers; checks MARS coverage at the target; asks once for anything missing. Writes `agentic/work/target-info.md` |
| `pixinsight-lrgb-linear-basic` | L, R, G, B masters to a 32-bit linear final with the standard auto-STF embedded, stars included: crop, BXT correction, plate solve, SPFC, MGC, SPCC, BXT, NXT, a linear L merge, sky leveling. No colour adjustment, no star separation |
| `pixinsight-connector-troubleshooting` | Reading the connector's call log, Pause/Abort, known tool pitfalls, when to stop and ask |

Skills follow the open [Agent Skills](https://agentskills.io) format, so one source serves many harnesses.

## Requirements

PixInsight 1.9.5+, Node 22+, and for the LRGB flow: Gaia DR3/SP and MARS database files, and the RC-Astro
BlurXTerminator and NoiseXTerminator (commercial). `pixinsight-preflight` checks all of it.

## Install

**Claude Code** (the plugin also registers the connector, pinned to 2.4.0, as the MCP server `pixinsight`):

```sh
claude plugin marketplace add mxcoppell/pixinsight-connector-skills
claude plugin install pixinsight-connector-skills@pixinsight-connector-skills
```

If you already registered `pixinsight` by hand, remove that entry: two connectors driving one PixInsight
compete for its single script slot.

**Gemini CLI** (the extension also registers the connector):

```sh
gemini extensions install https://github.com/mxcoppell/pixinsight-connector-skills
```

**Any other harness** (Cursor, Codex, OpenCode and others): install the skills with

```sh
npx skills add mxcoppell/pixinsight-connector-skills
```

and register the connector yourself: `npm install -g pixinsight-connector@2.4.0`, then the command
`pixinsight-connector` as the MCP server `pixinsight`
([config shape per harness](https://github.com/mxcoppell/pixinsight-connector/blob/main/docs/setup.md)).

## Use

New to all this? The connector's [quick start](https://github.com/mxcoppell/pixinsight-connector/blob/main/QUICKSTART.md)
goes from a new computer to a processed image.

In a folder of integrated masters, ask your agent to run preflight, then intake, then the LRGB flow, or just ask
it to process the LRGB data: the flow runs the other two first when their files are missing or stale.
Everything the skills write goes under the folder's `agentic/` and `output/`; the masters are never modified.

## Contributing

`node scripts/check.mjs` (also run in CI) checks the manifests, that every PJSR helper and `js` block parses,
the connector pin, the skill frontmatter, and that no local path is published. Issues and PRs welcome.

## License

MIT. Not affiliated with or endorsed by Pleiades Astrophoto or RC-Astro.
