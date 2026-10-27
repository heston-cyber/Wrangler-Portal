// Direction 1 facelift (Oct 27): the website's light shapes, one per main page, sitting at the very back of the
// panel, oversized and bleeding off its edges, for the glass to frost. Work surfaces (the review page, the builder,
// a contract's page) get none, so nothing competes with the video or the document.
import elbow from "../assets/d1/light-elbow.jpg";
import arcs from "../assets/d1/light-arcs.jpg";
import bars from "../assets/d1/light-bars.jpg";
import ribbon from "../assets/d1/light-ribbon.jpg";
import blob from "../assets/d1/light-blob.jpg";
import cross from "../assets/d1/light-cross.jpg";

export const LIGHTS = { elbow, arcs, bars, ribbon, blob, cross };
type Light = { src: string; cls: string };

export function lightFor(path: string): Light | null {
  if (/^\/sign\/(b|d)\//.test(path) || /^\/sign\/templates\/[^/]+/.test(path)) return null;
  if (path === "/" || path === "") return { src: elbow, cls: "l-elbow" };
  if (path.startsWith("/projects")) return { src: arcs, cls: "l-arcs" };
  if (path.startsWith("/register") || path.startsWith("/activity")) return { src: ribbon, cls: "l-ribbon" };
  if (path.startsWith("/sign/docs") || path.startsWith("/sign/templates") || path.startsWith("/sign/new")) return { src: ribbon, cls: "l-ribbon-b" };
  if (path.startsWith("/sign")) return { src: bars, cls: "l-bars" };
  if (path.startsWith("/settings")) return { src: blob, cls: "l-blob" };
  return null;
}
