import type { ChaosInjectArgs, NetworkProfileConfig, NetworkPreset } from "./types.js";
import { recordStep } from "./reporter.js";

const presets: Record<Exclude<NetworkPreset, "custom">, NetworkProfileConfig> = {
  offline: { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 },
  slow_3g: { offline: false, latency: 400, downloadThroughput: (400 * 1024) / 8, uploadThroughput: (400 * 1024) / 8 },
  fast_3g: { offline: false, latency: 150, downloadThroughput: (1600 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 },
  reset: { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
};

// weakmap prevents leaking cdp session references across tab close
const activeFetchListeners = new WeakMap<any, (evt: any) => Promise<void>>();

export async function applyChaosFaults(sess: any, args: ChaosInjectArgs): Promise<Record<string, any>> {
  if (!sess) throw new Error("no active cdp session");
  const applied: Record<string, any> = {};

  if (args.action === "reset") {
    if (sess.Network?.emulateNetworkConditions) {
      await sess.Network.emulateNetworkConditions(presets.reset);
      applied.network = "reset";
    }
    if (sess.Emulation?.setCPUThrottlingRate) {
      await sess.Emulation.setCPUThrottlingRate({ rate: 1 });
      applied.cpu = "1x (normal)";
    }
    if (sess.Fetch?.disable) {
      const prevHandler = activeFetchListeners.get(sess);
      if (prevHandler && typeof sess.off === "function") {
        sess.off("Fetch.requestPaused", prevHandler);
      }
      activeFetchListeners.delete(sess);
      try {
        await sess.Fetch.disable();
      } catch {}
      applied.mock_api = "cleared";
    }
    recordStep("chaos_inject:reset", "all network, cpu, and fetch faults cleared");
    return { status: "reset", applied };
  }

  // 1. network throttling
  if (args.network_profile || args.latency_ms !== undefined || args.download_kbps !== undefined) {
    if (!sess.Network?.emulateNetworkConditions) {
      throw new Error("cdp Network domain missing on session");
    }

    let cfg: NetworkProfileConfig;
    const prof = args.network_profile ?? "custom";
    if (prof === "custom") {
      cfg = {
        offline: false,
        latency: args.latency_ms ?? 500,
        downloadThroughput: args.download_kbps ? (args.download_kbps * 1024) / 8 : -1,
        uploadThroughput: args.upload_kbps ? (args.upload_kbps * 1024) / 8 : -1,
      };
    } else {
      cfg = presets[prof] ?? presets.slow_3g;
    }

    await sess.Network.emulateNetworkConditions(cfg);
    applied.network = { profile: prof, ...cfg };
    recordStep("chaos_inject:network", `profile=${prof} latency=${cfg.latency}ms offline=${cfg.offline}`);
  }

  // 2. cpu throttling
  if (args.cpu_throttle_rate !== undefined) {
    if (!sess.Emulation?.setCPUThrottlingRate) {
      throw new Error("cdp Emulation domain missing on session");
    }
    const rate = Math.max(1, args.cpu_throttle_rate);
    await sess.Emulation.setCPUThrottlingRate({ rate });
    applied.cpu = `${rate}x slowdown`;
    recordStep("chaos_inject:cpu", `rate=${rate}x`);
  }

  // 3. fetch mock / api fault interception
  if (args.mock_api) {
    if (!sess.Fetch) {
      throw new Error("cdp Fetch domain missing on session");
    }

    const { url_pattern, status_code, response_body, fail_reason, delay_ms } = args.mock_api;
    const pat = url_pattern || "*";

    // detach existing handler if already hooked
    const old = activeFetchListeners.get(sess);
    if (old && typeof sess.off === "function") {
      sess.off("Fetch.requestPaused", old);
    }

    await sess.Fetch.enable({
      patterns: [{ urlPattern: pat, requestStage: "Request" }],
    });

    const handler = async (evt: any) => {
      try {
        if (delay_ms && delay_ms > 0) {
          await new Promise((r) => setTimeout(r, delay_ms));
        }

        if (fail_reason) {
          await sess.Fetch.failRequest({
            requestId: evt.requestId,
            errorReason: fail_reason,
          });
          return;
        }

        if (status_code) {
          const bodyPayload = response_body ?? JSON.stringify({ error: "chaos injected failure", code: status_code });
          await sess.Fetch.fulfillRequest({
            requestId: evt.requestId,
            responseCode: status_code,
            responseHeaders: [
              { name: "Content-Type", value: "application/json" },
              { name: "X-Chaos-Injected", value: "true" },
              { name: "Access-Control-Allow-Origin", value: "*" },
              { name: "Access-Control-Allow-Methods", value: "*" },
              { name: "Access-Control-Allow-Headers", value: "*" },
            ],
            body: Buffer.from(bodyPayload).toString("base64"),
          });
          return;
        }

        await sess.Fetch.continueRequest({ requestId: evt.requestId });
      } catch (err: any) {
        // request might already be terminated by browser navigation
      }
    };

    activeFetchListeners.set(sess, handler);
    sess.on("Fetch.requestPaused", handler);

    applied.mock_api = {
      pattern: pat,
      status: status_code,
      reason: fail_reason,
      delayMs: delay_ms || 0,
    };
    recordStep("chaos_inject:mock_api", `pattern=${pat} status=${status_code || "n/a"} delay=${delay_ms || 0}ms`);
  }

  return { status: "applied", applied };
}
