# savvy-progress

A Claude Code mod: a progress bar above the prompt and a live panel of subagents. Made for the [savvy-flow](../savvy-flow) skill, and useful with any subagents.

- **Progress bar**: the flow's title, phase, accepted tasks out of planned, the percent and the time left, a crab dressed for the work going on, and a button with the crew size that opens the panel. With a flow reported (savvy-flow does) it follows the flow; with none, it follows the subagents running now; with none of those, the main session itself (`Working · 12 tool calls · 1:23 · Bash`, then `Ready` with the last turn's totals). The percent counts the steps running workers have reported, not only finished tasks.
- **Five bar styles**, picked with `/bar-style <style>` (remembered across sessions):
  - `liquid` (default): a liquid with a rippling front edge, drifting ripples and rising bubbles
  - `pixels`: a dithered fill of twinkling pixels under a sweep of light
  - `crab`: a crab walks the track to where the work has got to, leaving a glinting trail of footprints
  - `aurora`: soft lights drift through the fill, a seam glowing at its edge
  - `circuit`: a stepped circuit trace lit up to the fill, a pulse running to a blinking pad at its head

  Every loop is phased by the clock, so the once-a-second redraw never restarts an animation.
- **Time left**: from each worker's reported steps, counting down between reports and holding at what the remaining steps need when one runs long. The flow's figure counts down from its last accepted task the same way.
- **Agents panel** (`/agents-info` toggles it; `/agents-info open` opens it or brings it forward without toggling): running, finished and planned subagents with model, effort, task progress, time left, context, estimated cost and time. Each crab dresses for its work, read from the agent type and its task (explore, review, build, test, research, write, plan, security), and acts it out in place: the detective sweeps the magnifier, the engineer turns the wrench, the test tube bubbles, the quill scribbles. Savvy tiers with no work to read keep their tier's costume. A run with no steps reported shows a moving stripe instead of a bar. `prefers-reduced-motion` stops them all.

## Tools it adds

- `mcp__savvy-progress__progress`: the orchestrator reports the plan, phase and accepted tasks. Only the main session can: a call from a subagent is ignored, so a worker cannot rename, finish or reset the flow.
- `mcp__savvy-progress__step`: a worker reports its own steps (`done`, `total`, `note`). The tool is listed up front rather than behind ToolSearch. Each `savvy-*` worker gets one line at the end of its brief asking for these reports; other subagents get a line too (see `stepReports`), and so does a message that wakes a finished subagent for a new run, which the panel shows as its next round.

Runs whose end never reached the mod (stopped, or ended while waiting on work of their own) are closed once Claude Code no longer lists them as alive, so they do not hold the bar back.

Cost is a rough estimate from token counts and a built-in per-model price table (`PRICES` in `hooks/register.tsx`, list prices as of 2026-10-10), not a bill. Cache writes are priced at the 1-hour rate, which is what Claude Code writes on a subscription; a session that writes 5-minute entries is overestimated there.

## Settings

`language`: `auto` (default), `en`, `ru` or `he`. Hebrew draws the bar and the panel right to left. `auto` follows Claude Code's `language` setting, then the system locale, and falls back to English. Set it in `/config`, or, for a mod loaded by hand, in `~/.claude/settings.json`:

```json
{ "pluginConfigs": { "savvy-progress": { "options": { "language": "ru" } } } }
```

`autoOpen`: `savvy` (default), `any` or `always`. With `savvy` the panel opens by itself when a `savvy-*` worker starts or a plan is reported. With `any` it also opens, once per session, when any other subagent starts. With `always` it opens as soon as a session starts. `/agents-info` toggles it either way.

`barStyle`: `liquid` (default), `pixels`, `crab`, `aurora` or `circuit`. `/bar-style <style>` sets it from the prompt and wins over the setting.

`stepReports`: `all` (default) or `savvy`. With `all` every subagent is asked to report its steps, so its row shows progress and time left; with `savvy` only savvy-flow workers are.

`mainBar`: `on` (default) or `off`. With `on`, the bar shows the main session's own work when no subagent runs and no flow is reported.

Install instructions are in the [repository README](../../README.md).
