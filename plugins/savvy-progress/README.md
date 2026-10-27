# savvy-progress

A Claude Code mod: a progress bar above the prompt and a live panel of subagents. Made for the [savvy-flow](../savvy-flow) skill, and useful with any subagents.

- **Progress bar**: the flow's title, phase, accepted tasks out of planned, and a button with the crew size that opens the panel. It appears once something reports progress (savvy-flow does) or a `savvy-*` worker starts.
- **Agents panel** (`/agents-info` toggles it; `/agents-info open` opens it or brings it forward without toggling): running, finished and planned subagents with model, effort, task progress, context, estimated cost and time. Working crabs walk, and each savvy tier animates its prop: the astronaut floats, the detective sweeps the magnifier, the engineer turns the wrench, the chef tosses the omelette, the racer runs with a fluttering flag. `prefers-reduced-motion` stops them.

## Tools it adds

- `mcp__savvy-progress__progress`: the orchestrator reports the plan, phase and accepted tasks. Only the main session can: a call from a subagent is ignored, so a worker cannot rename, finish or reset the flow.
- `mcp__savvy-progress__step`: a worker reports its own steps (`done`, `total`, `note`). A worker that does not report shows its context fill in grey instead. The tool is listed up front rather than behind ToolSearch, and each `savvy-*` worker gets one line at the end of its brief asking for these reports.

Cost is a rough estimate from token counts and a built-in per-model price table (`PRICES` in `hooks/register.tsx`, list prices as of 2026-10-10), not a bill. Cache writes are priced at the 1-hour rate, which is what Claude Code writes on a subscription; a session that writes 5-minute entries is overestimated there.

## Settings

`language`: `auto` (default), `en`, `ru` or `he`. Hebrew draws the bar and the panel right to left. `auto` follows Claude Code's `language` setting, then the system locale, and falls back to English. Set it in `/config`, or, for a mod loaded by hand, in `~/.claude/settings.json`:

```json
{ "pluginConfigs": { "savvy-progress": { "options": { "language": "ru" } } } }
```

`autoOpen`: `savvy` (default) or `any`. With `savvy` the panel opens by itself when a `savvy-*` worker starts or a plan is reported. With `any` it also opens, once per session, when any other subagent starts. `/agents-info` toggles it either way.

`terminalCrabs`: `row` (default), `stage` or `off`. In the terminal the crabs are pixel art, two pixels to a cell (half blocks in true color), and the running ones walk. `row` puts a small crab beside each agent (9 columns by 3 rows; text only when the panel is narrower than 34 columns): as the desktop draws a row: the task and its time; the tier word in its color (for an agent that is not a savvy worker, its type, in the color of the tier its model and effort match) and the model; its steps and numbers; and, while it runs, a bar in that color. Each agent is numbered in the order it started; `stage` draws the running agents' crabs at full size (30 by 14) side by side above the list; `off` keeps the text rows only. The desktop's crabs do not change. Docked beside a fullscreen transcript (`/tui fullscreen`, 110 columns or more) the panel asks for 56 columns; elsewhere it sits above the prompt.

`reportSteps`: `savvy` (default) or `any`. Savvy workers are asked in their brief to report their steps (the `step` tool), which the panel shows as `1/4 · note` and as the bar. With `any` every other subagent is asked too, when the tool is among its tools.

Install instructions are in the [repository README](../../README.md).
