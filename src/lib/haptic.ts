// Nov 17 (Heston, 09:33): a tap of haptic feedback when a long press opens something. Android: the Vibration API.
// iPhone (iOS 18+): Safari has no Vibration API, but a switch control taps the Taptic Engine when it flips, so a
// hidden one is flipped. Elsewhere it does nothing.
let sw: HTMLLabelElement | null = null;

export function haptic() {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function" && navigator.vibrate(12)) return;
    if (typeof document === "undefined") return;
    if (!sw) {
      sw = document.createElement("label");
      sw.setAttribute("aria-hidden", "true");
      sw.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.setAttribute("switch", "");
      input.tabIndex = -1;
      sw.appendChild(input);
      document.body.appendChild(sw);
    }
    sw.click();
  } catch { /* no haptics here */ }
}
