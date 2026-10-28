# wt-choas

Browser chaos engineering and fault injection plugin for Weavetab by [fy2ne](https://fy2ne.me).

Direct CDP Layer 0 network degradation, CPU throttling, API mocking, boundary form & race-condition fuzzing, and automated crash telemetry reporting.

## Features

- **`chaos_inject`**: Environmental fault injection over direct CDP sockets:
  - Network throttling presets: `offline`, `slow_3g`, `fast_3g`, or custom latency & bandwidth limits.
  - CPU slowdown emulation: `4x`, `6x`, or arbitrary multiplier.
  - API fault mocking: Status codes (`500`, `502`, `503`, `429`), network aborts (`TimedOut`, `ConnectionReset`), artificial latency delays, and custom JSON payloads via CDP `Fetch`.
- **`chaos_fuzz`**: Autonomous boundary testing & race condition triggers:
  - `race_click`: Rapid burst dispatches to buttons to catch unhandled concurrency, double-submits, and async state corruption.
  - `boundary_forms`: Automatic injection of oversized buffers (64KB), unicode edge cases (RTL, zero-width, null bytes), numeric boundaries (`-0`, `NaN`, `1e309`, `MAX_SAFE_INTEGER`), and benign injection probes across standard DOM and recursive Shadow DOM.
  - `key_events`: Synthetic keyboard cascades (`Enter`, `Tab`) alongside input mutation.
- **`chaos_report`**: Telemetry collector that watches `Runtime.exceptionThrown`, `Log.entryAdded`, and HTTP error codes (`>= 400`) to generate formatted Markdown or JSON bug reports with exact reproduction steps.

## Installation

```bash
weavetab plugin add wt-choas
```
or via npm:
```bash
npm install wt-choas
```

## Permissions

Declared in `weavetab.json`:
- `cdp.evaluate`: Required for executing DOM boundary injections and dispatching race clicks.
- `cdp.network`: Required for network throttling, CPU emulation, and Fetch API mocking.
- `tools.add`: Registers `chaos_inject`, `chaos_fuzz`, and `chaos_report`.

## Author & License

Created by **fy2ne** ([fy2ne.me](https://fy2ne.me))  
Licensed under [MIT](LICENSE)
