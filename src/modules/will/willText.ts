// Nov 22 (Heston, approved): a temporary Oklahoma will for Heston and Emily-Rose, from his guide "How to Make a Typed
// Will in Oklahoma". Each spouse makes their own will on their own computer (Heston, Nov 22: "Each does their own").
// This file is the words: the answers' shape, what each step needs, and the will text. In the answers, "a" is the
// person making this will and "b" is their spouse. Nothing here talks to the server; the answers live only
// in this browser (WillPage) and the PDF is made in the browser (willPdf).
//   - Okla. Stat. tit. 84 §55: signed at the end, declared to two witnesses, who sign at the end in the testator's
//     presence. §55(5): self-proved at signing or any later date, by (a) a notary's certificate or (b) written
//     declarations under penalty of perjury. Both forms below follow the statute's wording.
//   - Okla. Stat. tit. 58 §1221(B): a custodian under the Oklahoma Uniform Transfers to Minors Act can hold property
//     until 18 to 21, in the statute's words. Older than 21 needs a trust, so the will makes a simple one.

export type Pronoun = "he" | "she" | "they";
export type Person = { name: string; aka: string; pronoun: Pronoun };
export type Named = { name: string; relation: string; place: string };
export type Gift = { item: string; to: string; backup: string };
export type Child = { name: string; born: string };
export type Who = "a" | "b";

export type WillAnswers = {
  v: 1;
  a: Person; b: Person;
  city: string; county: string;
  children: Child[]; expecting: boolean; due: string;
  executorSpouse: boolean; executor: Named; backupExecutor: Named; noBond: boolean;
  fallback: { name: string; relation: string }[]; survivalDays: number;
  giftsA: Gift[]; giftsB: Gift[];
  guardian: Named; backupGuardian: Named;
  managerSame: boolean; manager: Named; backupManager: Named; age: number;
  petsTo: string; wishesA: string; wishesB: string;
  signCity: string; signCounty: string;
};

const named = (): Named => ({ name: "", relation: "", place: "" });
export function blank(): WillAnswers {
  return {
    v: 1,
    a: { name: "", aka: "", pronoun: "he" }, b: { name: "", aka: "", pronoun: "she" },
    city: "", county: "",
    children: [], expecting: true, due: "April 2027",
    executorSpouse: true, executor: named(), backupExecutor: named(), noBond: true,
    fallback: [{ name: "", relation: "" }], survivalDays: 30,
    giftsA: [], giftsB: [],
    guardian: named(), backupGuardian: named(),
    managerSame: true, manager: named(), backupManager: named(), age: 25,
    petsTo: "", wishesA: "", wishesB: "",
    signCity: "", signCounty: "",
  };
}

/** Old or partial answers (from this browser) filled out to today's shape, so a missing field never breaks a page. */
export function upgrade(raw: unknown): WillAnswers {
  const b = blank();
  if (!raw || typeof raw !== "object" || (raw as { v?: unknown }).v !== 1) return b;
  const r = raw as Partial<WillAnswers>;
  const obj = <T extends object>(base: T, x: unknown): T => (x && typeof x === "object" ? { ...base, ...(x as Partial<T>) } : base);
  const list = <T extends object>(x: unknown, base: () => T): T[] => (Array.isArray(x) ? x.filter((i) => i && typeof i === "object").map((i) => ({ ...base(), ...i })) : []);
  return {
    ...b, ...r,
    a: obj(b.a, r.a), b: obj(b.b, r.b),
    executor: obj(b.executor, r.executor), backupExecutor: obj(b.backupExecutor, r.backupExecutor),
    guardian: obj(b.guardian, r.guardian), backupGuardian: obj(b.backupGuardian, r.backupGuardian),
    manager: obj(b.manager, r.manager), backupManager: obj(b.backupManager, r.backupManager),
    children: list(r.children, () => ({ name: "", born: "" })),
    fallback: list(r.fallback, () => ({ name: "", relation: "" })),
    giftsA: list(r.giftsA, () => ({ item: "", to: "", backup: "" })), giftsB: list(r.giftsB, () => ({ item: "", to: "", backup: "" })),
    survivalDays: [0, 30, 60, 90, 120].includes(Number(r.survivalDays)) ? Number(r.survivalDays) : b.survivalDays,
    age: Math.min(35, Math.max(18, Math.round(Number(r.age) || b.age))),
    v: 1,
  };
}

// ---------- the steps ----------
export const STEPS = [
  { key: "start", title: "Before you start" },
  { key: "you", title: "You and your spouse" },
  { key: "children", title: "Children" },
  { key: "executor", title: "Executor" },
  { key: "inherit", title: "Who inherits" },
  { key: "gifts", title: "Specific gifts" },
  { key: "guardian", title: "Guardian" },
  { key: "money", title: "The children's money" },
  { key: "wishes", title: "Other wishes" },
  { key: "signing", title: "Signing" },
  { key: "review", title: "Review and download" },
] as const;
export type StepKey = (typeof STEPS)[number]["key"];

const t = (s: string) => s.replace(/\s+/g, " ").trim();
const kids = (a: WillAnswers) => a.children.filter((c) => t(c.name));
const haveKids = (a: WillAnswers) => kids(a).length > 0 || a.expecting;

/** What still needs an answer before Next, by field (the page shows each under its field). */
export function stepIssues(a: WillAnswers, step: StepKey): Record<string, string> {
  const e: Record<string, string> = {};
  const need = (key: string, v: string, msg: string) => { if (!t(v)) e[key] = msg; };
  if (step === "you") {
    need("a.name", a.a.name, "Type the full legal name.");
    need("b.name", a.b.name, "Type the full legal name.");
    need("city", a.city, "Type the city you live in.");
    need("county", a.county, "Type the county.");
  }
  if (step === "children") {
    a.children.forEach((c, i) => { if (!t(c.name) && t(c.born)) e[`children.${i}`] = "Type the child's full name, or remove the row."; });
    if (a.expecting) need("due", a.due, "Type when the baby is due, like April 2027.");
  }
  if (step === "executor") {
    if (!a.executorSpouse) need("executor.name", a.executor.name, "Type who will be the executor.");
    need("backupExecutor.name", a.backupExecutor.name, "Type a backup executor.");
  }
  if (step === "inherit") {
    if (!a.fallback.some((f) => t(f.name))) e["fallback"] = "Name at least one person, in case none of your family survives you.";
  }
  if (step === "gifts") {
    for (const [k, list] of [["giftsA", a.giftsA]] as const) {
      list.forEach((g, i) => {
        if (t(g.item) && !t(g.to)) e[`${k}.${i}`] = "Type who gets it.";
        else if (!t(g.item) && t(g.to)) e[`${k}.${i}`] = "Describe the item.";
      });
    }
  }
  if (step === "guardian" && haveKids(a)) {
    need("guardian.name", a.guardian.name, "Type who would raise your child.");
    need("backupGuardian.name", a.backupGuardian.name, "Type a backup guardian.");
  }
  if (step === "money") {
    if (!a.managerSame || !haveKids(a)) need("manager.name", a.manager.name, "Type who will manage the money.");
    if (!(a.age >= 18 && a.age <= 35)) e["age"] = "Pick an age from 18 to 35.";
  }
  if (step === "signing") {
    need("signCity", a.signCity || a.city, "Type the city where you'll sign.");
    need("signCounty", a.signCounty || a.county, "Type the county where you'll sign.");
  }
  return e;
}

/** The first step that still needs something, or null when everything's answered. */
export function firstIncomplete(a: WillAnswers): StepKey | null {
  for (const s of STEPS) if (Object.keys(stepIssues(a, s.key)).length) return s.key;
  return null;
}

// ---------- the will text ----------
const PRON = { he: ["he", "his", "him"], she: ["she", "her", "her"], they: ["they", "their", "them"] } as const;
const NUM = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "twenty-one", "twenty-two", "twenty-three", "twenty-four", "twenty-five", "twenty-six", "twenty-seven", "twenty-eight", "twenty-nine", "thirty", "thirty-one", "thirty-two", "thirty-three", "thirty-four", "thirty-five"];
const words = (n: number) => `${NUM[n] ?? n} (${n})`;
const join = (xs: string[]) => (xs.length <= 1 ? xs.join("") : xs.length === 2 ? `${xs[0]} and ${xs[1]}` : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const county = (c: string) => (/\bcounty$/i.test(t(c)) ? t(c) : `${t(c)} County`);
const who = (n: Named) => [t(n.name), t(n.relation) && `my ${t(n.relation).replace(/^my\s+/i, "")}`, t(n.place) && `of ${t(n.place)}`].filter(Boolean).join(", ");
const nameOnly = (n: Named) => t(n.name);
/** who() inside a sentence: the closing comma after "my brother, of Edmond, Oklahoma," when there is one. */
const whoIn = (n: Named) => who(n) + (t(n.relation) || t(n.place) ? "," : "");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

export type Article = { title: string; paras: string[] };
export type Will = {
  testator: string; pronoun: Pronoun; spouse: string; file: string;
  title: string; intro: string; articles: Article[];
  signing: string; attestation: string;
  declaration: string; notary: { body: string; sworn: string };
};

/** One spouse's will from the shared answers: "a" is the first person in the walkthrough, "b" the second. */
export function willFor(a: WillAnswers, w: Who): Will {
  const me = w === "a" ? a.a : a.b;
  const sp = w === "a" ? a.b : a.a;
  const name = t(me.name), spouse = t(sp.name);
  const [he, his] = PRON[me.pronoun];
  const gifts = (w === "a" ? a.giftsA : a.giftsB).filter((g) => t(g.item) && t(g.to));
  const wishes = t(w === "a" ? a.wishesA : a.wishesB);
  const children = kids(a);
  const articles: Article[] = [];
  const add = (title: string, ...paras: (string | false | null | undefined)[]) => articles.push({ title, paras: paras.filter((p): p is string => !!p).map(t) });

  add("Revocation", "I revoke all wills and codicils I have made before this one.");

  const family = children.length
    ? `I am married to ${spouse}. I have ${children.length === 1 ? "one child" : `${NUM[children.length] ?? children.length} children`}: ${join(children.map((c) => (t(c.born) ? `${t(c.name)} (born ${t(c.born)})` : t(c.name))))}.`
    : `I am married to ${spouse}. I have no children now.`;
  add("My family",
    family,
    a.expecting && `My spouse and I are expecting a child, due in ${t(a.due)}.`,
    "Every reference in this will to “my children” includes the children named above and any child born to me or adopted by me after I sign this will.");

  const exec = a.executorSpouse ? `my spouse, ${spouse},` : whoIn(a.executor);
  add("Executor",
    `I name ${exec} as Executor of this will. If ${a.executorSpouse ? "my spouse" : nameOnly(a.executor)} does not survive me, cannot or will not serve, or cannot continue serving, I name ${whoIn(a.backupExecutor)} as Executor.`,
    a.noBond && "No bond or other security is required of any Executor named in this will, in any jurisdiction.",
    "My Executor has all the powers the laws of Oklahoma give an executor, including the power to sell, lease or manage any property of my estate, and to pay my debts, funeral costs and the costs of settling my estate.");

  if (gifts.length) add("Specific gifts",
    ...gifts.map((g) => t(g.backup)
      ? `I give ${t(g.item)} to ${t(g.to)}. If ${t(g.to)} does not survive me, I give it to ${t(g.backup)}. If neither survives me, it becomes part of my residuary estate.`
      : `I give ${t(g.item)} to ${t(g.to)}, if ${t(g.to)} survives me. If not, it becomes part of my residuary estate.`),
    "A gift that can't be found among my property when I die simply lapses; nothing is given in its place.");

  const fb = a.fallback.filter((f) => t(f.name)).map((f) => (t(f.relation) ? `${t(f.name)} (my ${t(f.relation).replace(/^my\s+/i, "")})` : t(f.name)));
  add("Everything else (my residuary estate)",
    `I give all the rest of my property, of every kind and wherever it is, including anything I am entitled to at my death and any gift in this will that lapses (my “residuary estate”), to my spouse, ${spouse}, if my spouse survives me.`,
    "If my spouse does not survive me, I give my residuary estate in equal shares to my children who survive me. If a child of mine does not survive me but leaves descendants who survive me, that child’s share goes to those descendants, by right of representation (per stirpes).",
    fb.length > 0 && `If neither my spouse nor any of my descendants survives me, I give my residuary estate ${fb.length === 1 ? `to ${fb[0]}` : `in equal shares to ${join(fb)}, or all of it to those of them who survive me`}.`);

  if (a.survivalDays > 0) add("Survival",
    `A person must survive me by ${words(a.survivalDays)} days to receive anything under this will. A person who does not is treated as having died before me.`);

  if (haveKids(a)) add("Guardian of my children",
    `If my spouse does not survive me, or cannot or will not act as guardian, I name ${whoIn(a.guardian)} as guardian of the person of each of my children who is a minor. If ${nameOnly(a.guardian)} cannot or will not serve, or cannot continue serving, I name ${whoIn(a.backupGuardian)} as guardian.`,
    "I ask that no bond be required of any guardian named in this will.");

  const mgr = a.managerSame && haveKids(a) ? a.guardian : a.manager;
  const backupMgr = a.managerSame && haveKids(a) ? a.backupGuardian : a.backupManager;
  const backupTail = t(backupMgr.name) ? `, or if ${nameOnly(mgr)} cannot or will not serve, to ${who(backupMgr)},` : ",";
  if (a.age <= 21) add("Property for a young beneficiary",
    `If any property passes under this will to a person who is a minor, I direct that it be given to ${who(mgr)}${backupTail} as custodian for that person under the Oklahoma Uniform Transfers to Minors Act.`,
    a.age > 18
      ? `The custodian shall transfer this property to that person when he or she reaches the age of ${words(a.age)} years.`
      : "The custodian shall transfer this property to that person when he or she reaches the age of eighteen (18) years.");
  else add("Property for a young beneficiary",
    `If any property passes under this will to a person who is under ${words(a.age)} years of age, I give it to ${who(mgr)}${backupTail} as trustee, to hold in a separate trust for that person.`,
    "The trustee may use as much of the trust’s income and principal as the trustee thinks wise for that person’s health, education, support and maintenance, and adds any income not used to the principal.",
    `When that person reaches ${words(a.age)} years of age, the trustee shall give that person everything left in the trust, and the trust ends. If that person dies first, the trustee shall give what is left to that person’s descendants by right of representation, or if there are none, to my descendants by right of representation, or if there are none, to that person’s estate.`,
    "No bond is required of any trustee. The trustee has all the powers the laws of Oklahoma give a trustee, may act without court supervision, and may be paid reasonable compensation. A person’s interest in this trust cannot be sold, assigned or reached by that person’s creditors before it is given to that person.");

  if (t(a.petsTo) || wishes) add("Other wishes",
    t(a.petsTo) && `I give any pets I own at my death to ${t(a.petsTo)}, and I ask that they be cared for.`,
    wishes && `My wishes for my funeral and burial: ${wishes.replace(/[.\s]+$/, "")}. These are my wishes and not binding directions.`);

  add("General",
    "If any part of this will is found invalid or unenforceable, the rest of it stays in effect. The headings in this will are only for convenience.",
    "This will is not made under any contract or agreement with my spouse.");

  const numbered = articles.map((x, i) => ({ ...x, title: `Article ${ROMAN[i] ?? i + 1}. ${x.title}` }));
  const where = `${t(a.signCity) || t(a.city)}, ${county(t(a.signCounty) || t(a.county))}, Oklahoma`;
  const aka = t(me.aka) ? ` (also known as ${t(me.aka)})` : "";
  return {
    testator: name, pronoun: me.pronoun, spouse, file: `Last Will and Testament of ${name}`,
    title: `Last Will and Testament of ${name}`,
    intro: t(`I, ${name}${aka}, a resident of ${t(a.city)}, ${county(a.county)}, Oklahoma, being of sound mind and at least eighteen (18) years of age, declare this to be my Last Will and Testament.`),
    articles: numbered,
    signing: t(`I sign my name to this will on the ______ day of ____________________, 20____, at ${where}, and I declare to the witnesses below that this is my Last Will and Testament, that I sign it willingly as my free and voluntary act, and that I am eighteen (18) years of age or older and of sound mind.`),
    attestation: t(`On the date written above, ${name}, the testator, declared to us, the undersigned witnesses, that this instrument is ${his} Last Will and Testament, and asked us to act as witnesses to it. ${cap(he)} signed it at the end in our presence. At ${his} request, and in ${his} presence and in the presence of each other, we now sign our names as witnesses. We each believe ${name} to be eighteen (18) years of age or older and of sound mind.`),
    // §55(5)(b), in substantially the statute's form; the testator's name and pronoun filled in, the rest as written.
    declaration: t(`We the undersigned are the testator and the witnesses, respectively, whose names are subscribed to the annexed or foregoing instrument in their respective capacities, and we do hereby declare that said ${name}, testator, declared to said witnesses that said instrument is ${his} last will and testament or a codicil to ${his} last will and testament, and that ${he} willingly made and executed it as ${his} free and voluntary act and deed for the purposes therein expressed; and said witnesses further declare that the said testator declared to them that said instrument is ${his} last will and testament or codicil to ${his} last will and testament, and that ${he} executed same as such and wanted each of us to sign it as a witness; and that we did sign the same as witnesses in the presence of the said testator and at ${his} request and that said testator was at that time eighteen (18) years of age or over and was of sound mind, all of which we declare and sign under penalty of perjury this ________ day of ____________________, 20____.`),
    // §55(5)(a): the notary's certificate, filled in only with the testator's name (county, witnesses and date by hand).
    notary: {
      body: t(`Before me, the undersigned authority, on this day personally appeared ${name}, ____________________________, and ____________________________, known to me to be the testator and the witnesses, respectively, whose names are subscribed to the annexed or foregoing instrument in their respective capacities, and, all of said persons being by me first duly sworn, said ${name}, testator, declared to me and to the said witnesses in my presence that said instrument is ${his} last will and testament or a codicil to ${his} last will and testament, and that ${he} had willingly made and executed it as ${his} free and voluntary act and deed for the purposes therein expressed; and the said witnesses, each on ${"his or her"} oath stated to me, in the presence and hearing of the said testator, that the said testator had declared to them that said instrument is ${his} last will and testament or codicil to ${his} last will and testament, and that ${he} executed same as such and wanted each of them to sign it as a witness; and upon their oaths each witness stated further that they did sign the same as witnesses in the presence of the said testator and at ${his} request and that said testator was at that time eighteen (18) years of age or over and was of sound mind.`),
      sworn: t(`Subscribed and acknowledged before me by the said ${name}, testator, and subscribed and sworn before me by the said ____________________________, and ____________________________ witnesses, this ______ day of ____________________, A.D., 20____.`),
    },
  };
}

/** Things to look at before printing (not blockers). */
export function warnings(a: WillAnswers): string[] {
  const out: string[] = [];
  const people = new Set<string>();
  const addP = (s: string) => { if (t(s)) people.add(t(s)); };
  addP(a.a.name); addP(a.b.name);
  if (!a.executorSpouse) addP(a.executor.name);
  addP(a.backupExecutor.name);
  for (const g of a.giftsA) { addP(g.to); addP(g.backup); }
  for (const f of a.fallback) addP(f.name);
  if (haveKids(a)) { addP(a.guardian.name); addP(a.backupGuardian.name); }
  if (!a.managerSame || !haveKids(a)) { addP(a.manager.name); addP(a.backupManager.name); }
  addP(a.petsTo);
  out.push(`Your two witnesses can't be anyone named in your will or your spouse's. Named in yours: ${join([...people])}.`);
  if ((!a.managerSame || !haveKids(a)) && !t(a.backupManager.name)) out.push("There's no backup for the person managing the children's money. If they can't serve, a court picks someone.");
  if (a.age > 21) out.push(`Money left to someone under ${a.age} goes into a simple trust until that age (Oklahoma's custodian rules stop at 21).`);
  out.push("Life insurance, retirement accounts and payable-on-death bank accounts go to the beneficiary named on the account, not to this will. Check those at the same time.");
  return out;
}
