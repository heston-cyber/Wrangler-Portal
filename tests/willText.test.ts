// Nov 22 (Heston, approved): the will walkthrough's words. W2 the will text from sample answers; W2b the self-proving
// pages follow Okla. Stat. tit. 84 §55(5)(a) and (b) word for word apart from the filled-in name and pronoun; W1 what
// each step needs before Next.
import { describe, expect, it } from "vitest";
import { blank, firstIncomplete, stepIssues, STEPS, upgrade, warnings, willFor, type WillAnswers } from "../src/modules/will/willText";

const sample = (patch: Partial<WillAnswers> = {}): WillAnswers => ({
  ...blank(),
  a: { name: "Jordan Lee Sample", aka: "J. L. Sample", pronoun: "he" },
  b: { name: "Casey Ann Sample", aka: "", pronoun: "she" },
  city: "Oklahoma City", county: "Oklahoma",
  backupExecutor: { name: "Pat Sample", relation: "brother", place: "Edmond, Oklahoma" },
  fallback: [{ name: "Robin Sample", relation: "mother" }, { name: "Sam Sample", relation: "father" }],
  guardian: { name: "Alex Kim and Jamie Kim", relation: "", place: "Norman, Oklahoma" },
  backupGuardian: { name: "Pat Sample", relation: "brother", place: "" },
  giftsA: [{ item: "my camera kit", to: "Pat Sample", backup: "" }],
  ...patch,
});
const all = (a: WillAnswers) => { const w = willFor(a, "a"); return [w.intro, ...w.articles.flatMap((x) => [x.title, ...x.paras]), w.signing, w.attestation].join("\n"); };

// §55(5)(b) and (a) as printed in the Oklahoma Statutes (Title 84, oksenate.gov), with the blanks for the testator's
// name filled and the statute's "his"/"he" for the testator kept (a "he" testator).
const STATUTE_B = `We the undersigned are the testator and the witnesses, respectively, whose names are subscribed to the annexed or foregoing instrument in their respective capacities, and we do hereby declare that said Jordan Lee Sample, testator, declared to said witnesses that said instrument is his last will and testament or a codicil to his last will and testament, and that he willingly made and executed it as his free and voluntary act and deed for the purposes therein expressed; and said witnesses further declare that the said testator declared to them that said instrument is his last will and testament or codicil to his last will and testament, and that he executed same as such and wanted each of us to sign it as a witness; and that we did sign the same as witnesses in the presence of the said testator and at his request and that said testator was at that time eighteen (18) years of age or over and was of sound mind, all of which we declare and sign under penalty of perjury this`;
const STATUTE_A = `Before me, the undersigned authority, on this day personally appeared Jordan Lee Sample,`;
const STATUTE_A_REST = `known to me to be the testator and the witnesses, respectively, whose names are subscribed to the annexed or foregoing instrument in their respective capacities, and, all of said persons being by me first duly sworn, said Jordan Lee Sample, testator, declared to me and to the said witnesses in my presence that said instrument is his last will and testament or a codicil to his last will and testament, and that he had willingly made and executed it as his free and voluntary act and deed for the purposes therein expressed; and the said witnesses, each on his or her oath stated to me, in the presence and hearing of the said testator, that the said testator had declared to them that said instrument is his last will and testament or codicil to his last will and testament, and that he executed same as such and wanted each of them to sign it as a witness; and upon their oaths each witness stated further that they did sign the same as witnesses in the presence of the said testator and at his request and that said testator was at that time eighteen (18) years of age or over and was of sound mind.`;

describe("the will text", () => {
  it("W2 has every part of the guide's outline, in order", () => {
    const w = willFor(sample(), "a");
    expect(w.title).toBe("Last Will and Testament of Jordan Lee Sample");
    expect(w.intro).toContain("I, Jordan Lee Sample (also known as J. L. Sample), a resident of Oklahoma City, Oklahoma County, Oklahoma");
    expect(w.articles.map((x) => x.title)).toEqual([
      "Article I. Revocation", "Article II. My family", "Article III. Executor", "Article IV. Specific gifts",
      "Article V. Everything else (my residuary estate)", "Article VI. Survival", "Article VII. Guardian of my children",
      "Article VIII. Property for a young beneficiary", "Article IX. General",
    ]);
    const s = all(sample());
    expect(s).toContain("I revoke all wills and codicils I have made before this one.");
    expect(s).toContain("I am married to Casey Ann Sample. I have no children now.");
    expect(s).toContain("My spouse and I are expecting a child, due in April 2027.");
    expect(s).toContain("Every reference in this will to “my children” includes any child born to me or adopted by me after I sign this will.");
    expect(s).toContain("I name my spouse, Casey Ann Sample, as Executor");
    expect(s).toContain("I name Pat Sample, my brother, of Edmond, Oklahoma, as Executor.");
    expect(s).toContain("No bond or other security is required of any Executor");
    expect(s).toContain("I give my camera kit to Pat Sample, if Pat Sample survives me.");
    expect(s).toContain("to my spouse, Casey Ann Sample, if my spouse survives me.");
    expect(s).toContain("in equal shares to my children who survive me");
    expect(s).toContain("in equal shares to Robin Sample (my mother) and Sam Sample (my father)");
    expect(s).toContain("must survive me by thirty (30) days");
    expect(s).toContain("I name Alex Kim and Jamie Kim, of Norman, Oklahoma, as guardian of the person of each of my children who is a minor. If Alex Kim and Jamie Kim cannot or will not serve, or cannot continue serving, I name Pat Sample, my brother, as guardian.");
    // The signature is at the end (§55(1)), the date left blank to write by hand, and the witnesses' statement after it.
    expect(w.signing).toContain("on the ______ day of ____________________, 20____, at Oklahoma City, Oklahoma County, Oklahoma");
    expect(w.attestation).toContain("declared to us, the undersigned witnesses, that this instrument is his Last Will and Testament");
    expect(w.attestation).toContain("in his presence and in the presence of each other");
  });

  it("W2 the children's money: the Oklahoma custodian rules up to 21, a simple trust above", () => {
    const at21 = all(sample({ age: 21 }));
    expect(at21).toContain("to Alex Kim and Jamie Kim, of Norman, Oklahoma, or if Alex Kim and Jamie Kim cannot or will not serve, to Pat Sample, my brother, as custodian for that person under the Oklahoma Uniform Transfers to Minors Act.");
    expect(at21).toContain("The custodian shall transfer this property to that person when he or she reaches the age of twenty-one (21) years."); // 58 O.S. §1221(B)
    expect(at21).not.toContain("trustee");
    expect(all(sample({ age: 18 }))).toContain("reaches the age of eighteen (18) years");
    const at25 = all(sample({ age: 25 }));
    expect(at25).toContain("under twenty-five (25) years of age, I give it to Alex Kim and Jamie Kim");
    expect(at25).toContain("as trustee, to hold in a separate trust for that person");
    expect(at25).toContain("When that person reaches twenty-five (25) years of age, the trustee shall give that person everything left in the trust");
    expect(at25).not.toContain("Uniform Transfers to Minors Act");
    // Someone else managing the money.
    const other = all(sample({ managerSame: false, manager: { name: "Morgan Sample", relation: "sister", place: "" }, backupManager: { name: "", relation: "", place: "" } }));
    expect(other).toContain("I give it to Morgan Sample, my sister, as trustee");
    expect(all(sample({ executorSpouse: false, executor: { name: "Lee Park", relation: "", place: "" } }))).toContain("I name Lee Park as Executor of this will. If Lee Park does not survive me");
  });

  it("W2 children, pronouns, gifts with backups, optional parts", () => {
    const s = all(sample({ children: [{ name: "River Sample", born: "May 4, 2027" }, { name: "", born: "" }], expecting: false, survivalDays: 0, petsTo: "Pat Sample", wishesA: "Cremation, please." }));
    expect(s).toContain("I am married to Casey Ann Sample. I have one child: River Sample (born May 4, 2027).");
    expect(s).not.toContain("expecting");
    expect(s).toContain("includes the children named above and any child born to me or adopted by me after I sign this will");
    expect(s).not.toContain("Survival");
    expect(s).toContain("I give any pets I own at my death to Pat Sample");
    expect(s).toContain("My wishes for my funeral and burial: Cremation, please. These are my wishes and not binding directions.");
    const her = willFor(sample({ a: { name: "Casey Ann Sample", aka: "", pronoun: "she" }, b: { name: "Jordan Lee Sample", aka: "", pronoun: "he" } }), "a");
    expect(her.attestation).toContain("is her Last Will and Testament");
    expect(her.attestation).toContain("She signed it at the end in our presence.");
    expect(her.declaration).toContain("that she willingly made and executed it as her free and voluntary act");
    const g = all(sample({ giftsA: [{ item: "my 2011 Jeep Wrangler", to: "Pat Sample", backup: "Robin Sample" }] }));
    expect(g).toContain("I give my 2011 Jeep Wrangler to Pat Sample. If Pat Sample does not survive me, I give it to Robin Sample.");
    const noGifts = willFor(sample({ giftsA: [] }), "a");
    expect(noGifts.articles.some((x) => x.title.includes("Specific gifts"))).toBe(false);
    expect(noGifts.articles[3].title).toBe("Article IV. Everything else (my residuary estate)");
  });

  it("W2b the self-proving pages use §55's own wording", () => {
    const w = willFor(sample(), "a");
    expect(w.declaration.startsWith(STATUTE_B)).toBe(true);
    expect(w.declaration).toMatch(/this ________ day of ____________________, 20____\.$/);
    expect(w.notary.body.startsWith(STATUTE_A)).toBe(true);
    expect(w.notary.body.endsWith(STATUTE_A_REST)).toBe(true);
    expect(w.notary.sworn).toBe("Subscribed and acknowledged before me by the said Jordan Lee Sample, testator, and subscribed and sworn before me by the said ____________________________, and ____________________________ witnesses, this ______ day of ____________________, A.D., 20____.");
  });
});

describe("the steps", () => {
  it("W1 every step is there, and Next needs the required answers", () => {
    expect(STEPS.map((s) => s.title)).toEqual(["Before you start", "You and your spouse", "Children", "Executor", "Who inherits", "Specific gifts", "Guardian", "The children's money", "Other wishes", "Signing", "Review and download"]);
    const b = blank();
    expect(Object.keys(stepIssues(b, "start"))).toEqual([]);
    expect(Object.keys(stepIssues(b, "you")).sort()).toEqual(["a.name", "b.name", "city", "county"]);
    expect(Object.keys(stepIssues(b, "executor"))).toEqual(["backupExecutor.name"]);
    expect(Object.keys(stepIssues({ ...b, executorSpouse: false }, "executor")).sort()).toEqual(["backupExecutor.name", "executor.name"]);
    expect(Object.keys(stepIssues(b, "inherit"))).toEqual(["fallback"]);
    expect(Object.keys(stepIssues(b, "guardian")).sort()).toEqual(["backupGuardian.name", "guardian.name"]); // a baby is on the way
    expect(Object.keys(stepIssues({ ...b, expecting: false }, "guardian"))).toEqual([]);
    expect(Object.keys(stepIssues({ ...b, expecting: false }, "money"))).toEqual(["manager.name"]);
    expect(Object.keys(stepIssues({ ...b, giftsA: [{ item: "a watch", to: "", backup: "" }] }, "gifts"))).toEqual(["giftsA.0"]);
    expect(firstIncomplete(b)).toBe("you");
    expect(firstIncomplete(sample())).toBeNull();
  });

  it("W1 answers from an older or damaged save still open", () => {
    expect(upgrade(null)).toEqual(blank());
    expect(upgrade({ v: 2 })).toEqual(blank());
    const u = upgrade({ v: 1, a: { name: "X" }, children: [null, { name: "Y" }], age: 99, survivalDays: 7 });
    expect(u.a).toEqual({ name: "X", aka: "", pronoun: "he" });
    expect(u.children).toEqual([{ name: "Y", born: "" }]);
    expect(u.age).toBe(35);
    expect(u.survivalDays).toBe(30);
  });

  it("W1 the review lists everyone named, so no one named becomes a witness", () => {
    const w = warnings(sample());
    expect(w[0]).toContain("Jordan Lee Sample, Casey Ann Sample, Pat Sample, Robin Sample, Sam Sample and Alex Kim and Jamie Kim");
    expect(w.some((x) => x.includes("simple trust until that age"))).toBe(true);
  });
});
