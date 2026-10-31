import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMockContext, simulateToolCall } from "@weavetab/sdk/testing";
import { runPreflight } from "@weavetab/sdk/preflight";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

test("wt-choas passes official SDK preflight audit", async () => {
  const result = await runPreflight(rootDir);
  assert.equal(result.success, true, `Preflight failed: ${result.errors.join(", ")}`);
  assert.equal(result.errors.length, 0);
});

test("simulates chaos_inject and chaos_report with SDK testing harness", async () => {
  const distPath = path.join(rootDir, "dist", "index.js");
  const mod = await import(`file://${distPath.replace(/\\/g, "/")}`);
  const plugin = mod.chaosPlugin || mod.default;

  const registered = new Map();
  const mockCtx = {
    ...createMockContext({
      config: { autoListen: false },
      mockTabUrl: "https://example.com/checkout",
    }),
    mcp: {
      registerTool(tool) {
        registered.set(tool.name, tool);
      },
    },
  };

  // Provide mock CDP domains for chaos injection
  mockCtx.tab.session.Network = {
    emulateNetworkConditions: async (opts) => opts,
    enable: async () => {},
  };
  mockCtx.tab.session.Emulation = {
    setCPUThrottlingRate: async (opts) => opts,
  };
  mockCtx.tab.session.Fetch = {
    enable: async () => {},
    disable: async () => {},
  };
  mockCtx.tab.session.Log = {
    enable: async () => {},
  };

  await plugin.onLoad(mockCtx);

  const injectTool = registered.get("chaos_inject");
  assert.ok(injectTool, "chaos_inject registered");

  const injectRes = await simulateToolCall(
    injectTool,
    { network_profile: "reset" },
    mockCtx
  );
  assert.equal(injectRes.isError, undefined);
  assert.ok(injectRes.content.length > 0);
  assert.equal(injectRes.content[0].type, "text");

  const reportTool = registered.get("chaos_report");
  assert.ok(reportTool, "chaos_report registered");

  const reportRes = await simulateToolCall(
    reportTool,
    { action: "report", format: "markdown" },
    mockCtx
  );
  assert.equal(reportRes.isError, undefined);
  assert.ok(reportRes.content[0].text.includes("Chaos Engineering Telemetry & Bug Report"));
});
