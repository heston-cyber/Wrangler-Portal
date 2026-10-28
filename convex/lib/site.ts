// The portal's own address, from the SITE_URL setting (Phase 0.5b, Oct 28). Moving the site to a new address is a
// change of that one setting; nothing else in the backend names the host.
export const SITE_DEFAULT = "https://app.wranglerportal.com"; // review. until Oct 28
export const SITE = () => (process.env.SITE_URL || SITE_DEFAULT).replace(/\/+$/, "");
export const SITE_SLASH = () => `${SITE()}/`;
export const SITE_HOST = () => new URL(SITE()).host;
// The lab's frame-test clip, served by the site itself.
export const LAB_CLIP = () => `${SITE()}/lab/frametest_23976_h264.mp4`;
