export interface NetworkProfileConfig {
  offline: boolean;
  latency: number;
  downloadThroughput: number;
  uploadThroughput: number;
}

export type NetworkPreset = "offline" | "slow_3g" | "fast_3g" | "custom" | "reset";

export interface MockApiRule {
  url_pattern?: string;
  status_code?: number;
  response_body?: string;
  fail_reason?: "Failed" | "Aborted" | "TimedOut" | "ConnectionReset";
  delay_ms?: number;
}

export interface ChaosInjectArgs {
  action?: "apply" | "reset";
  network_profile?: NetworkPreset;
  latency_ms?: number;
  download_kbps?: number;
  upload_kbps?: number;
  cpu_throttle_rate?: number;
  mock_api?: MockApiRule;
}

export type FuzzMode = "race_click" | "boundary_forms" | "all";
export type PayloadKind = "all" | "oversized" | "unicode_edge" | "numeric_bounds" | "injection_probe";

export interface ChaosFuzzArgs {
  mode?: FuzzMode;
  selector?: string;
  burst_count?: number;
  payload_type?: PayloadKind;
  auto_submit?: boolean;
  shadow_dom?: boolean;
  key_events?: boolean;
}

export interface ChaosReportArgs {
  action?: "report" | "start" | "clear";
  format?: "markdown" | "json";
}

export interface CapturedException {
  ts: number;
  text: string;
  stack?: string;
  url?: string;
  line?: number;
  col?: number;
}

export interface CapturedNetworkFault {
  ts: number;
  url: string;
  method?: string;
  status?: number;
  statusText?: string;
  failedReason?: string;
}

export interface ReproStep {
  ts: number;
  action: string;
  details: string;
}
