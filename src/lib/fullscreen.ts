// Full screen (Oct 21).
// Computers, iPads and Android: the whole page goes full screen and the review page shows just the picture and the
// play bar (the page, not one box, so menus and toasts still show). iPhones only let a bare <video> go full screen
// (WebKit bug 206854, still open in iOS 26), so there the button opens Apple's own player, which turns with the phone.
type FsDoc = Document & { webkitFullscreenEnabled?: boolean; webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };
type FsVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

const doc = () => document as FsDoc;

// Which full screen this browser gives: the whole page, or (iPhone) Apple's player for the bare video.
// The standard check comes first; the old "webkit" page flag only counts where there's no Apple player to fall back
// on, because some browsers report it as on without the page actually being able to go full screen.
export function fullscreenMode(v: HTMLVideoElement | null): "page" | "video" | "none" {
  const el = document.documentElement as FsEl;
  if (doc().fullscreenEnabled && typeof el.requestFullscreen === "function") return "page";
  if (v && typeof (v as FsVideo).webkitEnterFullscreen === "function") return "video";
  if (doc().webkitFullscreenEnabled && typeof el.webkitRequestFullscreen === "function") return "page";
  return "none";
}

export const fullscreenElement = (): Element | null => doc().fullscreenElement ?? doc().webkitFullscreenElement ?? null;

export async function enterPageFullscreen() {
  const el = document.documentElement as FsEl;
  if (typeof el.requestFullscreen === "function") await el.requestFullscreen();
  else el.webkitRequestFullscreen?.();
}

export async function exitPageFullscreen() {
  if (typeof doc().exitFullscreen === "function") await doc().exitFullscreen();
  else doc().webkitExitFullscreen?.();
}

// iPhone: Apple's player. Must run straight from the tap. Returns false where there's no such player.
export function enterVideoFullscreen(v: HTMLVideoElement): boolean {
  const x = v as FsVideo;
  if (typeof x.webkitEnterFullscreen !== "function") return false;
  x.webkitEnterFullscreen();
  return true;
}

export function onFullscreenChange(cb: () => void) {
  document.addEventListener("fullscreenchange", cb);
  document.addEventListener("webkitfullscreenchange", cb);
  return () => {
    document.removeEventListener("fullscreenchange", cb);
    document.removeEventListener("webkitfullscreenchange", cb);
  };
}
