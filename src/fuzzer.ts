import type { ChaosFuzzArgs } from "./types.js";
import { recordStep } from "./reporter.js";

const edgePayloads = {
  oversized: "A".repeat(65536),
  unicode_edge: "\u202E\u200B\uFEFF\u0000\uD83D\uDCA5\u0300\u0301<>&\"'",
  numeric_bounds: ["-0", "NaN", "-Infinity", "9007199254740993", "1e309", "-1"],
  injection_probe: ["{{7*7}}", "${7*7}", "' OR 1=1 --", "<svg/onload=void(0)>", "{\"__proto__\":{\"polluted\":true}}"],
};

export async function runChaosFuzz(sess: any, args: ChaosFuzzArgs): Promise<Record<string, any>> {
  if (!sess?.Runtime?.evaluate) {
    throw new Error("cdp Runtime domain missing on session");
  }

  const mode = args.mode ?? "all";
  const burst = Math.min(Math.max(1, args.burst_count ?? 20), 100);
  const kind = args.payload_type ?? "all";
  const sel = args.selector ?? "";
  const autoSubmit = !!args.auto_submit;

  const fn = `
    (async (mode, sel, burst, kind, autoSubmit, payloads) => {
      const log = { raceClicks: 0, inputsFuzzed: 0, submitted: false, targets: [] };

      // Helper to dispatch React/Vue/Svelte compatible value change
      const setVal = (el, val) => {
        const proto = el instanceof HTMLTextAreaElement 
          ? window.HTMLTextAreaElement.prototype 
          : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) {
          setter.call(el, val);
        } else {
          el.value = val;
        }
        el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));
      };

      // 1. Race condition multi-click
      if (mode === 'race_click' || mode === 'all') {
        const targetBtn = sel 
          ? document.querySelector(sel) 
          : (document.querySelector('button[type="submit"], button, [role="button"], a.btn') || document.body);

        if (targetBtn) {
          log.targets.push({ type: 'button', tag: targetBtn.tagName, class: targetBtn.className });
          for (let i = 0; i < burst; i++) {
            targetBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
            targetBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            targetBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            if (typeof targetBtn.click === 'function') targetBtn.click();
            log.raceClicks++;
          }
        }
      }

      // 2. Boundary form injection
      if (mode === 'boundary_forms' || mode === 'all') {
        const root = sel ? (document.querySelector(sel) || document) : document;
        const fields = Array.from(root.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, [contenteditable="true"]'));

        for (const f of fields) {
          const fieldType = (f.getAttribute('type') || f.tagName).toLowerCase();
          log.targets.push({ type: 'field', tag: f.tagName, name: f.name || f.id || fieldType });

          let valToInject = payloads.unicode_edge;
          if (kind === 'oversized') {
            valToInject = payloads.oversized;
          } else if (kind === 'numeric_bounds' || fieldType === 'number' || fieldType === 'range') {
            valToInject = payloads.numeric_bounds[Math.floor(Math.random() * payloads.numeric_bounds.length)];
          } else if (kind === 'injection_probe') {
            valToInject = payloads.injection_probe[Math.floor(Math.random() * payloads.injection_probe.length)];
          } else if (kind === 'all') {
            // cycle through payloads
            const allTypes = [payloads.oversized, payloads.unicode_edge, ...payloads.numeric_bounds, ...payloads.injection_probe];
            valToInject = allTypes[Math.floor(Math.random() * allTypes.length)];
          }

          if (f.hasAttribute('contenteditable')) {
            f.innerText = valToInject;
            f.dispatchEvent(new Event('input', { bubbles: true }));
          } else {
            setVal(f, valToInject);
          }
          log.inputsFuzzed++;
        }

        if (autoSubmit) {
          const form = root instanceof HTMLFormElement ? root : root.querySelector('form');
          if (form) {
            if (typeof form.requestSubmit === 'function') {
              try { form.requestSubmit(); log.submitted = true; } catch {}
            } else {
              form.submit();
              log.submitted = true;
            }
          }
        }
      }

      return log;
    })(${JSON.stringify(mode)}, ${JSON.stringify(sel)}, ${burst}, ${JSON.stringify(kind)}, ${autoSubmit}, ${JSON.stringify(edgePayloads)})
  `;

  const evalRes = await sess.Runtime.evaluate({
    expression: fn,
    awaitPromise: true,
    returnByValue: true,
  });

  const fuzzRes = evalRes?.result?.value ?? { error: "evaluation failed" };
  recordStep("chaos_fuzz", `mode=${mode} selector="${sel}" burst=${burst} fieldsFuzzed=${fuzzRes.inputsFuzzed || 0} raceClicks=${fuzzRes.raceClicks || 0}`);

  return {
    success: true,
    mode,
    burstCount: burst,
    payloadKind: kind,
    ...fuzzRes,
  };
}
