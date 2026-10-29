# Figma icon export → app icon (see docs/ICONS.md). Run inside a folder of the raw exports: python3 -I convert.py <out>
import re, sys, os, glob
# inset (top right bottom left) in % of 24, from the Figma design context of "Components · Icons"
I = {
"stage":"0 -16.15","check-circle":"-15.63","info":"-15.63","alert":"-16.15 -20.31 -11.98 -20.31","more":"0 -11.46",
"sign-out":"-11.98 -7.81 -11.98 -11.98","activity":"-7.81 -20.31","register":"-3.65 -16.15 -3.65 -15.63","note":"-11.98",
"upload":"-11.98 -7.81","lock":"-15.63 -7.81 -16.15 -7.81","eye":"-7.29 -20.31","search":"-11.46 -16.15 -16.15 -11.46",
"folder":"-3.65 -16.15 -7.81 -16.15","invoice":"-16.15 -3.65","send":"-16.15","bell":"-16.15 -11.98 -15.63 -11.98",
"settings":"-20.31","users":"-9.38 -20.31 -11.98 -20.31","user":"-11.46 -11.98 -16.15 -11.98","sign":"-7.81 -7.81 -11.98 -11.98",
"document":"-16.15 -3.65","review":"-7.81 -16.15","inbox":"-7.81 -16.15","home":"-11.98","globe":"-16.15","quote":"-7.81 -11.98",
"download":"-11.98 -7.81 -7.81 -7.81","calendar":"-11.98","clock":"-12.5","map-pin":"-18.23 -7.81 -16.15 -7.81","phone":"-16.15 0",
"mail":"-3.65 -16.15","video":"0 -16.15","check":"0 -7.81","menu":"0 -11.98","close":"-3.65","minus":"0 -7.81","plus":"-7.81",
"pause":"-3.65 0","play":"-7.81 -7.81 -7.81 0","external":"-7.81","chevron-right":"-3.65 0","chevron-down":"0 -3.65",
"arrow-up":"-11.98 -3.65","arrow-down":"-11.98 -3.65","arrow-left":"-3.65 -11.98","arrow-right":"-3.65 -11.98","arrow-up-right":"0",
}
def tl(spec):
    v=[float(x) for x in spec.split()]
    if len(v)==1: v=v*4
    elif len(v)==2: v=[v[0],v[1],v[0],v[1]]
    top,right,bottom,left=v
    return -top/100*24, -left/100*24
out=sys.argv[1]; os.makedirs(out, exist_ok=True)
for f in sorted(glob.glob("*.svg")):
    n=f[:-4]; s=open(f).read()
    t,l=tl(I[n])
    s=re.sub(r'<filter[\s\S]*?</filter>','',s)
    s=re.sub(r'\sfilter="[^"]*"','',s)
    s=s.replace('#FF0000','currentColor')
    s=s.replace('fill="#030104"','style="fill:var(--icon-ground,#030104)"')  # a CSS variable only works in style, not in fill=
    s=re.sub(r'<svg[^>]*>', f'<svg viewBox="{l:.3f} {t:.3f} 24 24" width="24" height="24" fill="none" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" aria-hidden="true">', s, count=1)
    s=re.sub(r'\s+id="[^"]*"', lambda m: m.group(0) if 'stroke' in m.group(0) else m.group(0), s)
    open(os.path.join(out,f),"w").write(s)
print("ok", len(glob.glob(os.path.join(out,"*.svg"))))
