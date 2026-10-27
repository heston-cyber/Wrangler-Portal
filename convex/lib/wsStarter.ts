// The starter template (B3; as a page since E1): Heston's Service Agreement, from his vault note CONTRACT.md (Oct 27, 2026), as blocks.
// Wording is his, unchanged, except: [Name of Client] and [Date] became the {client.name} and {date} fields, and the
// budget and payment split became the line items and payment schedule blocks.
// CONTRACT.md has TWO different revisions clauses; both are kept, under a "PICK ONE" note that blocks sending until
// one is deleted (Heston decides; nothing here picks for him).
import { bullets, migrate, newId, rich, type Page, type Rich, type V1Block as Block } from "./wsBuilder";

const P = (...lines: string[]): Rich => rich(...lines);
const clause = (title: string, body: Rich, initials = false): Block => ({ id: newId(), type: "clause", title, rich: body, initials });

export function serviceAgreementBlocks(): Block[] {
  return [
    { id: newId(), type: "heading", text: "Service Agreement", size: "title" },
    { id: newId(), type: "text", size: "subtitle", rich: P("{project}") },
    { id: newId(), type: "parties", title: "Parties" },
    { id: newId(), type: "text", rich: P(`This Service Agreement ("Agreement") is entered into by and between Wrangler Productions, a DBA of Hill Creative LLC (hereinafter referred to as "COMPANY"), and {client.name} (hereinafter referred to as "CLIENT") as of {date}. This Agreement represents the entire understanding between the two parties and supersedes all prior agreements. Any amendments must be in writing and signed by both parties. If any provision of this Agreement is deemed invalid, it will not affect the enforceability of the remaining provisions. A waiver of any provision does not constitute a waiver of any other provision.`) },
    clause("Scope of work & deliverables", P("The COMPANY agrees to provide the following services and deliverables:", "Deliverable:", "Timeline:", "Any changes to the scope of work must be agreed upon in writing by both parties."), true),
    { id: newId(), type: "items", title: "Services & pricing", rows: [{ id: newId(), description: "Video production (describe the deliverables)", qty: 1, rate: 0 }] },
    clause("Confidentiality", P("Both parties agree to maintain confidentiality regarding each other's business processes, documents, and workflows. This obligation applies to all employees, contractors, and third parties and persists indefinitely, even after the termination of this Agreement.")),
    { id: newId(), type: "payment", title: "Payment terms", depositPct: 25, invoiceDeposit: true, initials: true, terms: P(
      "Total Project Budget: {total} USD",
      "Payment Structure: A {deposit.percent} deposit ({deposit}) is due upon signing this Agreement. The remaining {balance.percent} balance ({balance}) is due upon delivery of the services and deliverables.",
      "Payment Method: Payments will be processed via Stripe Invoice.",
      "Late Payments: Payments not received within 3 days of the due date will incur a $100 late fee for every day the payment is delayed beyond the grace period.") },
    clause("Ownership & use", P("The CLIENT obtains ownership of the final video upon full payment.", "The COMPANY retains ownership of all raw data files. Raw data may be provided to the CLIENT upon mutual agreement and discussion.", "The COMPANY reserves the right to use the raw footage and the final video & photo deliverables for marketing, promotional, and portfolio purposes."), true),
    clause("Cancellation policy", P("If the CLIENT cancels the project before work begins, the deposit will be refunded minus a $100 administrative fee.", "If the CLIENT cancels the project after work has begun, the deposit will not be refunded, and additional charges for work completed may apply.")),
    clause("Travel & expenses", P(
      "The CLIENT agrees to reimburse the COMPANY for all travel-related expenses incurred in connection with the performance of services under this Agreement.",
      "Travel-related expenses include, but are not limited to, mileage (billed at the standard IRS mileage rate), flights, lodging, meals, car rentals, and other transportation costs such as taxis, rideshares, parking, and tolls.",
      "For any project requiring travel outside the state of Oklahoma, a $500 out-of-state travel fee will be added to the project cost. This fee is separate from and does not include any of the aforementioned travel-related expenses, which will be billed separately.",
      "If travel-related expenses are not prepaid or otherwise directly covered by the CLIENT, they will be billed separately by the COMPANY. The CLIENT will be provided with an itemized invoice for all travel-related expenses, along with receipts where applicable."), true),
    clause("Liability", P("The COMPANY shall not be liable for any damages, losses, or claims arising out of or related to the services provided under this Agreement, except in cases of gross negligence or willful misconduct.", "The COMPANY’s total liability for any claim arising out of or relating to this Agreement shall not exceed the total amount paid by the CLIENT under this Agreement. Under no circumstances shall the COMPANY be liable for any indirect, incidental, or consequential damages.")),
    clause("Governing law", P("This Agreement shall be governed by and construed in accordance with the laws of Oklahoma City, Oklahoma. Any lawsuits or legal actions arising from this Agreement shall be filed and resolved exclusively in an Oklahoma County court.")),
    clause("Entire agreement", P("This Agreement constitutes the entire agreement between the parties and supersedes all prior agreements, understandings, or representations.")),
    clause("Client responsibilities", P("The CLIENT agrees to provide all necessary information, materials, and approvals in a timely manner to facilitate the COMPANY's work.", "Delays caused by the CLIENT in providing required materials or approvals may result in an adjustment to the project timeline or additional fees.")),
    clause("Equipment damage", P("If the COMPANY’s equipment is damaged due to CLIENT negligence or unsafe working conditions provided by the CLIENT, the CLIENT agrees to reimburse the COMPANY for the cost of repair or replacement.")),
    clause("Subcontractor disclosure & indemnification", P("The CLIENT acknowledges and agrees that the COMPANY may engage subcontractors, freelancers, or third-party service providers to assist in the completion of the project.", "The COMPANY retains full responsibility for the quality of work and deliverables, regardless of whether the work is performed by the COMPANY or its subcontractors.", "The CLIENT agrees to indemnify and hold harmless the COMPANY from any claims, damages, or losses arising from the actions or omissions of subcontractors, except in cases of gross negligence or willful misconduct by the COMPANY.")),
    clause("Data & revisions", { type: "doc", content: [
      ...P("Data Retention: Raw data will be deleted 7 days after delivery unless:").content,
      bullets(["Stored for $100/year, or", "Offloaded to an external drive provided to the CLIENT."]),
      ...P("PICK ONE: your CONTRACT.md has two different revisions terms. Delete the one you don't want, and this line.",
        "Revisions: Two rounds of revisions are included in the project. Additional revisions will be charged at $75 per round.",
        "Revisions: One round of revisions is included in the project. Additional revisions will be charged at $100 per round.",
        "If the CLIENT identifies a change that was part of the included revision round but was not executed correctly by the COMPANY, those changes will be made at no additional cost as they fall under the first round of revisions and are considered a COMPANY mistake.",
        "Approval & Delivery: Approval of the video requires payment in full before an un-watermarked version is delivered.").content,
    ] }, true),
    clause("Force majeure", P("Neither party shall be held liable for failure or delay in performing obligations under this Agreement if such failure or delay is due to causes beyond their reasonable control, including but not limited to acts of God, natural disasters, government restrictions, pandemics, labor strikes, or power outages. In such cases, both parties will work to reschedule or adjust deliverables as necessary.")),
    { id: newId(), type: "signatures", title: "Signatures", signers: ["heston", "client"], showTitle: true, showDate: true },
  ];
}

/** The starter as a page (E1): the blocks above, converted the same way older documents are. */
export const serviceAgreementPage = (): Page => migrate(serviceAgreementBlocks());
