# savvy-progress

A Claude Code mod: a progress bar above the prompt and a live panel of subagents. Made for the [savvy-flow](../savvy-flow) skill, and useful with any subagents.

- **Progress bar**: the flow's title, phase, accepted tasks out of planned, and a button with the crew size that opens the panel. It appears once something reports progress (savvy-flow does) or a `savvy-*` worker starts.
- **Agents panel** (`/agents-info` toggles it): running, finished and planned subagents with model, effort, task progress, context, estimated cost and time. Working crabs walk, and each savvy tier animates its prop: the astronaut floats, the detective sweeps the magnifier, the engineer turns the wrench, the chef tosses the omelette, the racer runs with a fluttering flag. `prefers-reduced-motion` stops them.

In the terminal the same crabs are drawn as half-block cells: each running agent's crab walks beside its rows in the panel (from 45 columns of width; narrower panels keep the text rows), and while agents work a light runs along the bar above the prompt next to a small crab waving its claws. Finished and planned agents stay text rows. The desktop app draws SVG, as before.

## Tools it adds

- `mcp__savvy-progress__progress`: the orchestrator reports the plan, phase and accepted tasks.
- `mcp__savvy-progress__step`: a worker reports its own steps (`done`, `total`, `note`). A worker that does not report shows its context fill in grey instead.

Cost is a rough estimate from token counts and a built-in per-model price table (`PRICES` in `hooks/register.tsx`), not a bill.

## Settings

`language`: `auto` (default), `en` or `ru`. `auto` follows Claude Code's `language` setting, then the system locale, and falls back to English. Set it in `/config`, or, for a mod loaded by hand, in `~/.claude/settings.json`:

```json
{ "pluginConfigs": { "savvy-progress": { "options": { "language": "ru" } } } }
```

`panel`: `manual` (default) or `auto`. With `manual` the panel opens only when you run `/agents-info` and stays up until you run it again: it is empty while nothing runs, and each subagent shows up in it as it starts. `auto` also opens it when a savvy-flow plan or worker starts. Finished agents start folded into one line; press it to unfold.

`animation`: `on` (default) or `off`. `off` draws the terminal's crabs and bar still; the desktop app follows `prefers-reduced-motion` instead.

## Tests

`claude plugin test plugins/savvy-progress` runs `tests/terminal.test.ts` against the engine.

Install instructions are in the [repository README](../../README.md).
