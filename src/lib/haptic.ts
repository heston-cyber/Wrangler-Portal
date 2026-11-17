// Nov 17 (Heston): a tap of haptic feedback when a hold press opens a menu. Android: the Vibration API. iPhone
// (iOS 18+): Safari has no Vibration API, but flipping a switch control taps the Taptic Engine, so a hidden one is made
// and flipped (the same way the ios-haptics library does it). Elsewhere it does nothing.
export function haptic() {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function" && navigator.vibrate(12)) return;
    if (typeof document === "undefined") return;
    const label = document.createElement("label");
    label.ariaHidden = "true";
    label.style.display = "none";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    label.appendChild(input);
    document.head.appendChild(label);
    label.click();
    document.head.removeChild(label);
  } catch { /* no haptics here */ }
}
