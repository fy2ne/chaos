import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

test("weavetab.json matches manifest schema and permissions", () => {
  const manifestPath = path.join(rootDir, "weavetab.json");
  assert.ok(fs.existsSync(manifestPath), "weavetab.json must exist");

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  assert.equal(manifest.displayName, "Chaos");
  assert.equal(manifest.name, "@weavetab/plugin-chaos");
  assert.equal(manifest.version, "1.0.0");
  assert.equal(manifest.license, "MIT");

  // Verify permissions
  const perms = manifest.permissions;
  assert.ok(perms, "permissions must be declared");
  assert.equal(perms.cdp?.evaluate, true);
  assert.equal(perms.cdp?.network, true);
  assert.ok(perms.cdp?.reason && perms.cdp.reason.length > 10, "cdp permission reason required");
  assert.equal(perms.tools?.add, true);
  assert.ok(perms.tools?.reason && perms.tools.reason.length > 5, "tools permission reason required");

  // Verify declared tools
  const tools = manifest.tools;
  assert.equal(tools.length, 3);
  const toolNames = tools.map((t) => t.name).sort();
  assert.deepEqual(toolNames, ["chaos_fuzz", "chaos_inject", "chaos_report"]);
});

test("chaosPlugin compiles and registers all 3 tools in PluginContext", async () => {
  const distPath = path.join(rootDir, "dist", "index.js");
  assert.ok(fs.existsSync(distPath), "dist/index.js must exist after build");

  const mod = await import(`file://${distPath.replace(/\\/g, "/")}`);
  const plugin = mod.chaosPlugin || mod.default;
  assert.ok(plugin, "plugin export must be present");

  const registered = new Map();
  const mockCtx = {
    config: { autoListen: true },
    mcp: {
      registerTool: (tool) => {
        registered.set(tool.name, tool);
      },
    },
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  };

  await plugin.onLoad(mockCtx);
  assert.equal(registered.size, 3);
  assert.ok(registered.has("chaos_inject"));
  assert.ok(registered.has("chaos_fuzz"));
  assert.ok(registered.has("chaos_report"));

  // Mock CDP session
  const mockSession = {
    Network: {
      emulateNetworkConditions: async (opts) => opts,
      enable: async () => {},
    },
    Emulation: {
      setCPUThrottlingRate: async (opts) => opts,
    },
    Fetch: {
      enable: async () => {},
      disable: async () => {},
    },
    Runtime: {
      enable: async () => {},
      evaluate: async () => ({
        result: { value: { raceClicks: 15, inputsFuzzed: 2, submitted: false } },
      }),
    },
    Log: {
      enable: async () => {},
    },
    Page: {
      getNavigationHistory: async () => ({
        currentIndex: 0,
        entries: [{ url: "https://example.com/checkout" }],
      }),
    },
    on: () => {},
    off: () => {},
  };

  // 1. Test chaos_inject
  const injectTool = registered.get("chaos_inject");
  const injectRes = await injectTool.handler({ network_profile: "slow_3g", cpu_throttle_rate: 4 }, mockSession);
  assert.ok(injectRes.content[0].text.includes("slow_3g"));
  assert.ok(injectRes.content[0].text.includes("4x slowdown"));

  // 2. Test chaos_fuzz
  const fuzzTool = registered.get("chaos_fuzz");
  const fuzzRes = await fuzzTool.handler({ mode: "race_click", burst_count: 15 }, mockSession);
  assert.ok(fuzzRes.content[0].text.includes("raceClicks"));

  // 3. Test chaos_report
  const reportTool = registered.get("chaos_report");
  const reportRes = await reportTool.handler({ action: "report" }, mockSession);
  assert.ok(reportRes.content[0].text.includes("# Chaos Engineering Telemetry & Bug Report"));
  assert.ok(reportRes.content[0].text.includes("https://example.com/checkout"));
});
