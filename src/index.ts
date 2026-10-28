import { definePlugin, defineTool, z, type PluginContext } from "@weavetab/sdk";
import { applyChaosFaults } from "./faults.js";
import { runChaosFuzz } from "./fuzzer.js";
import { handleReportAction, attachTelemetryListeners, recordStep } from "./reporter.js";

export * from "./types.js";
export * from "./faults.js";
export * from "./fuzzer.js";
export * from "./reporter.js";

export const chaosPlugin = definePlugin({
  name: "@weavetab/plugin-chaos",
  version: "1.0.0",
  description: "Official Weavetab Chaos Engineering & Fault Injection Plugin.",

  defaultConfig: {
    autoListen: true,
    maxLogEntries: 100,
  },

  async onLoad(ctx: PluginContext): Promise<void> {
    const autoListen = ctx.config?.autoListen !== false;

    // Tool 1: chaos_inject
    ctx.mcp.registerTool(
      defineTool({
        name: "chaos_inject",
        description:
          "Runtime environmental fault injection over CDP. Emulates network throttling (offline/slow_3g/fast_3g/custom latency), CPU execution throttling (4x/6x slowdown), and API fault mocking (status codes, connection failures, artificial delays, custom responses via CDP Fetch).",
        requiresSession: true,
        schema: {
          action: z.enum(["apply", "reset"]).optional().describe("Whether to apply faults or reset environmental conditions (default: apply)"),
          network_profile: z.enum(["offline", "slow_3g", "fast_3g", "custom", "reset"]).optional().describe("Pre-configured network degradation profile or reset"),
          latency_ms: z.number().optional().describe("Additional latency in ms for custom profile"),
          download_kbps: z.number().optional().describe("Download throughput limit in kbps"),
          upload_kbps: z.number().optional().describe("Upload throughput limit in kbps"),
          cpu_throttle_rate: z.number().optional().describe("CPU throttling multiplier (1 for normal, 4 for 4x, 6 for 6x)"),
          mock_api: z
            .object({
              url_pattern: z.string().optional().describe("URL glob pattern to intercept (e.g. *api/checkout*)"),
              status_code: z.number().optional().describe("HTTP status code to return (500, 502, 503, 429)"),
              response_body: z.string().optional().describe("Mocked JSON/text body"),
              fail_reason: z.enum(["Failed", "Aborted", "TimedOut", "ConnectionReset"]).optional().describe("Connection failure reason"),
              delay_ms: z.number().optional().describe("Simulated response latency/delay in milliseconds before mock responds"),
            })
            .optional()
            .describe("CDP Fetch API fault interception rules"),
        },
        handler: async (args, session) => {
          if (autoListen && session) {
            await attachTelemetryListeners(session);
          }
          const res = await applyChaosFaults(session, args);
          return {
            content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
          };
        },
      })
    );

    // Tool 2: chaos_fuzz
    ctx.mcp.registerTool(
      defineTool({
        name: "chaos_fuzz",
        description:
          "Autonomous boundary testing and race-condition generator on forms and buttons. Executes rapid multi-clicks to trigger race conditions and injects boundary payloads (oversized, unicode edge, numeric bounds, injection probes) into DOM and Shadow DOM inputs.",
        requiresSession: true,
        schema: {
          mode: z.enum(["race_click", "boundary_forms", "all"]).optional().describe("Fuzzing mode: race_click, boundary_forms, or all (default: all)"),
          selector: z.string().optional().describe("Target CSS selector for button/form/inputs"),
          burst_count: z.number().optional().describe("Number of rapid consecutive clicks for race conditions (default: 20)"),
          payload_type: z.enum(["all", "oversized", "unicode_edge", "numeric_bounds", "injection_probe"]).optional().describe("Payload type (default: all)"),
          auto_submit: z.boolean().optional().describe("Whether to automatically submit form or click submit button after fuzzing"),
          shadow_dom: z.boolean().optional().describe("Whether to recursively traverse and fuzz Shadow DOM elements (default: true)"),
          key_events: z.boolean().optional().describe("Whether to fire synthetic keyboard events (Enter/Tab) during clicks and input mutations"),
        },
        handler: async (args, session) => {
          if (autoListen && session) {
            await attachTelemetryListeners(session);
          }
          const res = await runChaosFuzz(session, args);
          return {
            content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
          };
        },
      })
    );

    // Tool 3: chaos_report
    ctx.mcp.registerTool(
      defineTool({
        name: "chaos_report",
        description:
          "Captures CDP Runtime exceptions, network error codes (>= 400), and failed requests to generate structured Markdown or JSON bug reports with exact reproduction steps.",
        requiresSession: true,
        schema: {
          action: z.enum(["report", "start", "clear"]).optional().describe("Operation: report (default), start, or clear"),
          format: z.enum(["markdown", "json"]).optional().describe("Output format: markdown (default) or machine-readable json"),
        },
        handler: async (args, session) => {
          const res = await handleReportAction(session, args);
          const out = res.reportMarkdown ? res.reportMarkdown : JSON.stringify(res, null, 2);
          return {
            content: [{ type: "text", text: out }],
          };
        },
      })
    );

    ctx.logger?.info("wt-chaos loaded: chaos injection, fuzzing, and telemetry ready");
  },

  async onAfterAction(action: string, result: any): Promise<void> {
    recordStep(`action:${action}`, typeof result === "string" ? result.slice(0, 80) : "completed");
  },

  async onUnload(ctx: PluginContext): Promise<void> {
    ctx.logger?.info("wt-chaos unloaded");
  },
});

export default chaosPlugin;
export const plugin = chaosPlugin;
