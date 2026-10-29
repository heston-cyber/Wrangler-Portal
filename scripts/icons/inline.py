# Second pass: inline the shared shapes (<use>) so an icon carries no ids. python3 -I inline.py <folder>
import re, glob, sys
for f in sorted(glob.glob(sys.argv[1] + "/*.svg")):
    s = open(f).read()
    defs = dict(re.findall(r'<path id="([^"]+)" d="([^"]+)"/>', s))
    def rep(m):
        ref, rest = m.group(1), m.group(2)
        return '<path d="%s"%s/>' % (defs[ref], rest)
    s = re.sub(r'<use xlink:href="#([^"]+)"([^>]*)/>', rep, s)
    s = re.sub(r'<defs>.*?</defs>', '', s, flags=re.S)
    s = re.sub(r' id="[^"]+"', '', s)
    s = s.replace(' xmlns:xlink="http://www.w3.org/1999/xlink"', '')
    s = re.sub(r'\n\s*\n', '\n', s).strip() + "\n"
    assert 'xlink' not in s and 'url(#' not in s, f
    open(f, 'w').write(s)
print("ok", len(glob.glob(sys.argv[1] + "/*.svg")))
