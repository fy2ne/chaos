import type {
  CapturedException,
  CapturedNetworkFault,
  ReproStep,
  ChaosReportArgs,
} from "./types.js";

const capturedExceptions: CapturedException[] = [];
const capturedFaults: CapturedNetworkFault[] = [];
const reproSteps: ReproStep[] = [];
const requestMap = new Map<string, { url: string; method?: string }>();
const hookedSessions = new WeakSet<any>();

export function recordStep(action: string, details: string): void {
  reproSteps.push({
    ts: Date.now(),
    action,
    details,
  });
  if (reproSteps.length > 200) {
    reproSteps.shift();
  }
}

export async function attachTelemetryListeners(sess: any): Promise<void> {
  if (!sess || hookedSessions.has(sess)) return;
  hookedSessions.add(sess);

  try {
    if (sess.Runtime?.enable) await sess.Runtime.enable();
    if (sess.Network?.enable) await sess.Network.enable();
    if (sess.Log?.enable) await sess.Log.enable();
  } catch {}

  sess.on("Runtime.exceptionThrown", (evt: any) => {
    const details = evt?.exceptionDetails;
    const desc = details?.exception?.description || details?.text || "Unknown runtime exception";
    capturedExceptions.push({
      ts: Date.now(),
      text: details?.text || "Runtime error",
      stack: desc,
      url: details?.url || details?.stackTrace?.callFrames?.[0]?.url,
      line: details?.lineNumber,
      col: details?.columnNumber,
    });
    if (capturedExceptions.length > 100) capturedExceptions.shift();
  });

  sess.on("Network.requestWillBeSent", (evt: any) => {
    if (evt?.requestId && evt?.request?.url) {
      requestMap.set(evt.requestId, {
        url: evt.request.url,
        method: evt.request.method,
      });
      if (requestMap.size > 200) {
        const first = requestMap.keys().next().value;
        if (first) requestMap.delete(first);
      }
    }
  });

  sess.on("Network.responseReceived", (evt: any) => {
    const res = evt?.response;
    if (res && res.status >= 400) {
      const knownReq = evt?.requestId ? requestMap.get(evt.requestId) : undefined;
      capturedFaults.push({
        ts: Date.now(),
        url: res.url || knownReq?.url || "request",
        status: res.status,
        statusText: res.statusText,
        method: knownReq?.method || res.requestHeaders?.method || "GET",
      });
      if (capturedFaults.length > 100) capturedFaults.shift();
    }
  });

  sess.on("Network.loadingFailed", (evt: any) => {
    if (evt?.canceled) return;
    const knownReq = evt?.requestId ? requestMap.get(evt.requestId) : undefined;
    capturedFaults.push({
      ts: Date.now(),
      url: knownReq?.url || evt?.requestId || "request",
      method: knownReq?.method,
      failedReason: evt?.errorText || "NetConnectionFailed",
    });
    if (capturedFaults.length > 100) capturedFaults.shift();
  });

  sess.on("Log.entryAdded", (evt: any) => {
    const entry = evt?.entry;
    if (entry && entry.level === "error") {
      capturedExceptions.push({
        ts: Date.now(),
        text: `[console.error] ${entry.text}`,
        url: entry.url,
        line: entry.lineNumber,
      });
      if (capturedExceptions.length > 100) capturedExceptions.shift();
    }
  });
}

export function clearTelemetry(): void {
  capturedExceptions.length = 0;
  capturedFaults.length = 0;
  reproSteps.length = 0;
  requestMap.clear();
}

export function generateMarkdownReport(targetUrl?: string): string {
  const tsStr = new Date().toISOString();
  const excCount = capturedExceptions.length;
  const fltCount = capturedFaults.length;
  const stepCount = reproSteps.length;

  let md = `# Chaos Engineering Telemetry & Bug Report\n\n`;
  md += `**Generated**: ${tsStr}\n`;
  if (targetUrl) {
    md += `**Target URL**: \`${targetUrl}\`\n`;
  }
  md += `**Summary**: ${excCount} uncaught exception(s), ${fltCount} network fault(s), ${stepCount} action breadcrumbs.\n\n`;

  // Reproduction steps
  md += `## Exact Reproduction Steps\n\n`;
  if (reproSteps.length === 0) {
    md += `_No actions recorded in this session._\n\n`;
  } else {
    md += `| # | Time | Action | Parameters / Details |\n`;
    md += `|---|------|--------|----------------------|\n`;
    reproSteps.forEach((s, idx) => {
      const time = new Date(s.ts).toISOString().slice(11, 23);
      const cleanDetails = s.details.replace(/\|/g, "\\|");
      md += `| ${idx + 1} | \`${time}\` | \`${s.action}\` | ${cleanDetails} |\n`;
    });
    md += `\n`;
  }

  // Runtime exceptions
  md += `## Uncaught Runtime Exceptions\n\n`;
  if (excCount === 0) {
    md += `_No unhandled runtime exceptions caught during run._\n\n`;
  } else {
    capturedExceptions.forEach((e, idx) => {
      const time = new Date(e.ts).toISOString().slice(11, 23);
      const loc = e.url ? `${e.url}:${e.line || 0}:${e.col || 0}` : "inline";
      md += `### ${idx + 1}. \`${e.text}\` (${time})\n`;
      md += `- **Location**: \`${loc}\`\n`;
      if (e.stack) {
        md += `\`\`\`text\n${e.stack}\n\`\`\`\n\n`;
      }
    });
  }

  // Network failures
  md += `## Network Failures & API Errors\n\n`;
  if (fltCount === 0) {
    md += `_No HTTP 4xx/5xx or transport failures detected._\n\n`;
  } else {
    md += `| Status | Method | URL / Reason |\n`;
    md += `|--------|--------|--------------|\n`;
    capturedFaults.forEach((f) => {
      const statusText = f.status ? `\`${f.status} ${f.statusText || ""}\`` : `\`FAILED\``;
      const reason = f.failedReason ? `(${f.failedReason})` : "";
      md += `| ${statusText} | \`${f.method || "REQ"}\` | \`${f.url}\` ${reason} |\n`;
    });
    md += `\n`;
  }

  return md;
}

export async function handleReportAction(sess: any, args: ChaosReportArgs): Promise<Record<string, any>> {
  if (sess) {
    await attachTelemetryListeners(sess);
  }

  const act = args.action ?? "report";

  if (act === "start") {
    recordStep("chaos_report:start", "telemetry listeners active");
    return {
      success: true,
      status: "telemetry_active",
      message: "CDP Runtime and Network error listeners hooked",
    };
  }

  if (act === "clear") {
    clearTelemetry();
    return {
      success: true,
      status: "cleared",
      message: "Telemetry and reproduction breadcrumbs reset",
    };
  }

  let currentUrl: string | undefined;
  if (sess?.Page?.getNavigationHistory) {
    try {
      const hist = await sess.Page.getNavigationHistory();
      currentUrl = hist?.entries?.[hist.currentIndex]?.url;
    } catch {}
  }

  if (args.format === "json") {
    return {
      success: true,
      timestamp: new Date().toISOString(),
      targetUrl: currentUrl,
      summary: {
        exceptions: capturedExceptions.length,
        networkFaults: capturedFaults.length,
        reproSteps: reproSteps.length,
      },
      reproSteps: [...reproSteps],
      exceptions: [...capturedExceptions],
      networkFaults: [...capturedFaults],
    };
  }

  const report = generateMarkdownReport(currentUrl);
  return {
    success: true,
    exceptionCount: capturedExceptions.length,
    networkFaultCount: capturedFaults.length,
    reportMarkdown: report,
  };
}
