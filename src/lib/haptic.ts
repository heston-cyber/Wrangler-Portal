// Nov 17 (Heston): a tap of haptic feedback for hold presses.
//   Android: the Vibration API, at the moment the hold opens its menu (hapticHold).
//   iPhone (iOS 18+): Safari has no Vibration API; flipping a switch control taps the Taptic Engine, but iOS only does it
//   inside a touch the user just made, not on a timer mid-hold (Heston, 10:35: none felt at the open). So on iPhone the
//   tap comes as the finger lifts after a hold (hapticRelease, called from the pointerup handler).
const canVibrate = () => typeof navigator !== "undefined" && typeof navigator.vibrate === "function";

/** When a hold opens its menu (a timer): Android buzzes now; iPhone waits for the release. */
export function hapticHold() {
  try { if (canVibrate()) navigator.vibrate(12); } catch { /* none */ }
}

/** As the finger lifts after a hold (inside the pointerup handler): the iPhone tap. Nothing where hapticHold buzzed. */
export function hapticRelease() {
  if (canVibrate() || typeof document === "undefined") return;
  try {
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
