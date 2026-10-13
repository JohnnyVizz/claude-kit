# savvy-progress

A Claude Code mod: a progress bar above the prompt and a live panel of subagents. Made for the [savvy-flow](../savvy-flow) skill, and useful with any subagents.

- **Progress bar**: the flow's title, phase, accepted tasks out of planned, and a button with the crew size that opens the panel. It appears once something reports progress (savvy-flow does) or a `savvy-*` worker starts.
- **Agents panel** (`/agents-info` toggles it; `/agents-info open` opens it or brings it forward without toggling): running, finished and planned subagents with model, effort, task progress, context, estimated cost and time. Working crabs walk, and each savvy tier animates its prop: the astronaut floats, the detective sweeps the magnifier, the engineer turns the wrench, the chef tosses the omelette, the racer runs with a fluttering flag. `prefers-reduced-motion` stops them.
- **Solo steps**: work the orchestrator does itself, without subagents, shows as a list of steps with a status (`pending`, `active`, `done`), a one-line summary, and a timer on the active step. Each step gets a crab avatar too. The active one walks, pending ones wait faded, and the bar's crab dresses as the step in progress. Pass `avatar` (`detective`, `engineer`, `chef`, `racer`, `pirate`, `astronaut`) to choose one; otherwise one is picked from the step's title. A finished step shows how long it took and what it added to the session's cost and context (`+$0.42 · +8% context`). The active step's figures count up live.
- **What each step touched**: reads and edits (`Read`, `Edit`, `Write`, `NotebookEdit`) made while a step is active are recorded under it, by subagents too. Under the step, **▸ 3 files · 2 changed** opens the list. Each file shows what the step did to it (`read`, `+12 −3`, `new`) and has a **Finder** button that reveals it (macOS `open -R`; the folder elsewhere). A changed file also has a **Diff** button that opens a unified diff of that step's changes inline. Before a step first edits a file, the mod saves its text. When the step finishes, `diff -u` compares that copy with the file. A running step's diff is made fresh on demand. Changes made through `Bash` (sed, scripts, formatters) are not tracked.
- **Session figures**: with no subagents, the panel's tiles show the session's API cost, context fill and elapsed time. Tiles for the session (5-hour) and weekly limits show their reset times.
- **Background commands**: shell commands sent to the background get a row with their latest output line, a progress bar when the output prints `n/m`, `n of m` or a percentage, and a warning after a minute of silence. The status line names the running command. A notice pops up once when a command finishes, fails or stops, with the failure's last output line, and again each time it goes a minute without output.
- **Crab moods**: a failed subagent's crab lies on its back, legs kicking, under circling stars. When a flow finishes, the bar's crab hops in a burst of confetti.

## Tools it adds

- `mcp__savvy-progress__progress`: the orchestrator reports the plan, phase and accepted tasks. Working alone, it reports each step's `status`, `summary` and optional `avatar` instead. Only the main session can: a call from a subagent is ignored, so a worker cannot rename, finish or reset the flow.
- `mcp__savvy-progress__step`: a worker reports its own steps (`done`, `total`, `note`). A worker that does not report shows its context fill in grey instead. The tool is listed up front rather than behind ToolSearch, and each `savvy-*` worker gets one line at the end of its brief asking for these reports.

Cost is a rough estimate from token counts and a built-in per-model price table (`PRICES` in `hooks/models.ts`, list prices as of 2026-10-10), not a bill. Cache writes are priced at the 1-hour rate, which is what Claude Code writes on a subscription; a session that writes 5-minute entries is overestimated there.

## Settings

`language`: `auto` (default), `en`, `ru` or `he`. Hebrew draws the bar and the panel right to left. `auto` follows Claude Code's `language` setting, then the system locale, and falls back to English. Set it in `/config`, or, for a mod loaded by hand, in `~/.claude/settings.json`:

```json
{ "pluginConfigs": { "savvy-progress": { "options": { "language": "ru" } } } }
```

`autoOpen`: `savvy` (default) or `any`. With `savvy` the panel opens by itself when a `savvy-*` worker starts or a plan is reported. With `any` it also opens, once per session, when any other subagent starts. `/agents-info` toggles it either way.

## Code layout

`hooks/register.tsx` holds every hook, every function that takes `$`, and the state atoms. The engine reads those statically, from the entry file only. Everything else is pure and split by part: `flow.ts`, `crabs.ts`, `bar.ts`, `panel-svg.ts`, `background.ts`, `files.ts`, `models.ts`, `text.ts`, `i18n.ts` and `constants.ts`. The header of `register.tsx` maps them. Tests sit beside them as `*.test.ts` and run with `claude plugin test plugins/savvy-progress`.

Install instructions are in the [repository README](../../README.md).
