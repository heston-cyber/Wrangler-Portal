// Demo build (an artifact in Claude): sample media ships with the page, and features that need the real
// backend or a microphone are switched off.
export const BUNNY_CDN_HOST = "demo";
export const mediaUrl = (guid: string, file: string) => (file.endsWith(".jpg") ? `./media/${guid}.jpg` : `./media/${guid}.mp4`);
export const asset = (path: string) => `./${path.replace(/^\//, "")}`;
export const DEMO = true;
