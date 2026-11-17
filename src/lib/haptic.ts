// Nov 17 (Heston): a tap of haptic feedback when a hold press opens its menu. Android: the Vibration API.
// iPhone: tested on Heston's phone (12:00): only a real switch his finger taps gives a tap; nothing a page starts does
// (no Vibration API; a switch flipped by the page is silent). So on iPhone the hold's feedback is the press-in only.
export function hapticHold() {
  try { if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(12); } catch { /* none */ }
}
