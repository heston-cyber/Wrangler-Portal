// Nov 22 (Heston, approved): each will as its own PDF, made in this browser (nothing is uploaded). Plain and printable:
// white paper, Times, numbered "Page 1 of N" with an initials line on every page; the testator's signature and the
// witnesses' block at the end of the will (§55: signed at the end); then the self-proving declaration page (§55(5)(b),
// signed the same day, no notary) and a notary certificate page (§55(5)(a)) left blank for a notary later.
import { Document, Page, StyleSheet, Text, View, pdf } from "@react-pdf/renderer";
import type { Will } from "./willText";

const INK = "#111111", MUTED = "#555555";
const s = StyleSheet.create({
  page: { backgroundColor: "#ffffff", color: INK, fontFamily: "Times-Roman", fontSize: 11.5, lineHeight: 1.45, paddingTop: 64, paddingHorizontal: 72, paddingBottom: 84 },
  title: { fontFamily: "Times-Bold", fontSize: 17, textAlign: "center", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 },
  of: { textAlign: "center", fontSize: 12, marginBottom: 22 },
  attach: { textAlign: "center", fontSize: 10.5, color: MUTED, marginBottom: 20 },
  intro: { marginBottom: 14, textAlign: "justify" },
  art: { fontFamily: "Times-Bold", fontSize: 11.5, marginTop: 12, marginBottom: 5 },
  p: { marginBottom: 7, textAlign: "justify" },
  sign: { marginTop: 18 },
  line: { borderBottomWidth: 0.8, borderBottomColor: INK, height: 30 },
  cap: { fontSize: 10, color: MUTED, marginTop: 3 },
  sigBox: { width: 300, marginLeft: "auto", marginTop: 26 },
  wit: { marginTop: 22 },
  witRow: { flexDirection: "row", gap: 24, marginTop: 6 },
  witCol: { flex: 1 },
  head: { fontFamily: "Times-Bold", fontSize: 13, textAlign: "center", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  state: { marginBottom: 12, lineHeight: 1.6 },
  seal: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 34 },
  sealBox: { width: 130, height: 90, borderWidth: 0.8, borderColor: MUTED, borderStyle: "dashed", alignItems: "center", justifyContent: "center" },
  foot: { position: "absolute", left: 72, right: 72, bottom: 40, flexDirection: "row", justifyContent: "space-between", fontSize: 9, color: MUTED, borderTopWidth: 0.5, borderTopColor: "#bbbbbb", paddingTop: 8 },
});

function Footer({ w }: { w: Will }) {
  return (
    <View style={s.foot} fixed>
      <Text render={({ pageNumber, totalPages }) => `${w.title} · Page ${pageNumber} of ${totalPages}`} />
      <Text>Initials: ________</Text>
    </View>
  );
}

function Sig({ label, sub }: { label: string; sub?: string }) {
  return (
    <View style={s.witCol}>
      <View style={s.line} />
      <Text style={s.cap}>{label}</Text>
      {sub ? <Text style={s.cap}>{sub}</Text> : null}
    </View>
  );
}

function WitnessBlock({ n }: { n: number }) {
  return (
    <View style={s.wit} wrap={false}>
      <View style={s.witRow}><Sig label={`Witness ${n} (signature)`} /><Sig label="Printed name" /></View>
      <View style={s.witRow}><Sig label="Residence address" /></View>
      <View style={s.witRow}><Sig label="City, state, ZIP" /></View>
    </View>
  );
}

export function WillDoc({ w }: { w: Will }) {
  const last = w.articles.length - 1;
  return (
    <Document title={w.title} author={w.testator} creator="Wrangler Portal" producer="Wrangler Portal">
      <Page size="LETTER" style={s.page}>
        <Text style={s.title}>Last Will and Testament</Text>
        <Text style={s.of}>of {w.testator}</Text>
        <Text style={s.intro}>{w.intro}</Text>
        {w.articles.map((a, i) => (
          <View key={a.title} minPresenceAhead={i === last ? 160 : 60}>
            <Text style={s.art} minPresenceAhead={40}>{a.title}</Text>
            {a.paras.map((p, j) => <Text key={j} style={s.p}>{p}</Text>)}
          </View>
        ))}
        <View style={s.sign} wrap={false}>
          <Text style={s.art}>Signature</Text>
          <Text style={s.p}>{w.signing}</Text>
          <View style={s.sigBox}><View style={s.line} /><Text style={s.cap}>{w.testator}, Testator</Text></View>
        </View>
        <View wrap={false} style={{ marginTop: 22 }}>
          <Text style={s.art}>Witnesses</Text>
          <Text style={s.p}>{w.attestation}</Text>
          <WitnessBlock n={1} />
        </View>
        <WitnessBlock n={2} />
        <Footer w={w} />
      </Page>

      <Page size="LETTER" style={s.page}>
        <Text style={s.head}>Self-proving declaration</Text>
        <Text style={s.attach}>Attached to the Last Will and Testament of {w.testator} (Okla. Stat. tit. 84, §55(5)(b))</Text>
        <Text style={s.p}>{w.declaration}</Text>
        <View style={s.sigBox}><View style={s.line} /><Text style={s.cap}>{w.testator}, Testator</Text></View>
        <WitnessBlock n={1} />
        <WitnessBlock n={2} />
        <Footer w={w} />
      </Page>

      <Page size="LETTER" style={s.page}>
        <Text style={s.head}>Self-proving affidavit</Text>
        <Text style={s.attach}>Attached to the Last Will and Testament of {w.testator} (Okla. Stat. tit. 84, §55(5)(a)). For a notary; leave blank until then.</Text>
        <Text style={s.state}>THE STATE OF OKLAHOMA{"\n"}COUNTY OF ______________________________</Text>
        <Text style={s.p}>{w.notary.body}</Text>
        <View style={s.sigBox}><View style={s.line} /><Text style={s.cap}>{w.testator}, Testator</Text></View>
        <View style={s.witRow} wrap={false}><Sig label="Witness (signature)" sub="Name and residence (printed)" /><Sig label="Witness (signature)" sub="Name and residence (printed)" /></View>
        <View wrap={false}>
          <Text style={[s.p, { marginTop: 22 }]}>{w.notary.sworn}</Text>
          <View style={s.seal}>
            <View style={s.sealBox}><Text style={s.cap}>(SEAL)</Text></View>
            <View style={{ width: 250 }}>
              <View style={s.line} /><Text style={s.cap}>(Signed) Notary public</Text>
              <View style={[s.line, { height: 24 }]} /><Text style={s.cap}>Official capacity of officer · commission expires</Text>
            </View>
          </View>
        </View>
        <Footer w={w} />
      </Page>
    </Document>
  );
}

const CHECKLIST: [string, string[]][] = [
  ["Before the day", [
    "Read both wills all the way through. Fix anything here and print again; never write on a printed will.",
    "Line up two adult witnesses who are not named in either will (not each other, not a guardian, not the executor).",
    "Print each will single-sided. Don't staple yet.",
  ]],
  ["In one sitting, for each will", [
    "With both witnesses watching, say: “This is my last will and testament, and I’m asking you to witness it.”",
    "Initial the bottom of every page, then sign and date the Signature section at the end.",
    "Each witness signs in the Witnesses section and prints their name and home address.",
    "Then all three sign the Self-proving declaration page and fill in the date. No notary needed for this page.",
    "Leave the notary page blank. If you add it later, the testator and both witnesses go to the notary together.",
    "Staple the will once, with the declaration and notary pages behind it. Don't unstaple it later.",
    "Repeat with the second will and the same witnesses.",
  ]],
  ["After", [
    "Keep both originals in a fireproof box or safe. Tell your executor and backup executor where they are.",
    "Make copies marked COPY if you want them. Courts need the signed original.",
    "Check the beneficiaries named on life insurance and retirement accounts.",
    "After the baby is born, nothing has to change: the wills already include children born later. Review them after big life events.",
    "When you make the paid version later, sign it the same way, then destroy both of these originals.",
  ]],
];

export function ChecklistDoc() {
  return (
    <Document title="Signing-day checklist" creator="Wrangler Portal" producer="Wrangler Portal">
      <Page size="LETTER" style={s.page}>
        <Text style={s.head}>Signing-day checklist</Text>
        <Text style={s.attach}>Not part of either will. Don't staple this page to a will.</Text>
        {CHECKLIST.map(([h, items]) => (
          <View key={h} wrap={false}>
            <Text style={s.art}>{h}</Text>
            {items.map((it) => (
              <View key={it} style={{ flexDirection: "row", gap: 10, marginBottom: 7 }}>
                <View style={{ width: 10, height: 10, borderWidth: 0.8, borderColor: INK, marginTop: 3 }} />
                <Text style={{ flex: 1 }}>{it}</Text>
              </View>
            ))}
          </View>
        ))}
      </Page>
    </Document>
  );
}
export const CHECKLIST_ITEMS = CHECKLIST;

async function save(doc: React.ReactElement, file: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blob = await pdf(doc as any).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${file.replace(/[\\/:*?"<>|]+/g, "").trim()}.pdf`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export const downloadWill = (w: Will) => save(<WillDoc w={w} />, w.file);
export const downloadChecklist = () => save(<ChecklistDoc />, "Signing-day checklist");
/** For tests: the will's PDF bytes. */
export const willPdfBlob = (w: Will) => pdf(<WillDoc w={w} />).toBlob();
