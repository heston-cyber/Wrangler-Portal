// Screenshot harness: the doc builder's backend (builds, templates, clauses, styles, fonts), in memory.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { serviceAgreementBlocks } from "../convex/lib/wsStarter";
import { DEFAULT_BUSINESS, PRESET_STYLES, emptyFields, newId, rich } from "../convex/lib/wsBuilder";

const now = Date.now(), day = 86_400_000;
const sa = serviceAgreementBlocks();
let templates: any[] = [{ _id: "t1", name: "Service Agreement", description: "Your service agreement (from CONTRACT.md). Pick one revisions clause before sending.", blocks: sa, fields: { project: "", custom: [] }, style: PRESET_STYLES[0], createdAt: now - 2 * day, updatedAt: now - 2 * day },
  { _id: "t2", name: "Change order", description: "Extra scope on a signed agreement.", blocks: sa.slice(0, 4), fields: { project: "", custom: [] }, style: PRESET_STYLES[2], createdAt: now - 9 * day, updatedAt: now - 5 * day }];
let clauses: any[] = sa.filter((b: any) => b.type === "clause").map((b: any, i: number) => ({ _id: "c" + i, title: b.title, body: b.rich, initials: b.initials, createdAt: now, updatedAt: now }));
let styles: any[] = [];
let business = { ...DEFAULT_BUSINESS };
const f = emptyFields(business); f.client = { name: "Dillon Ripley", company: "United Turf and Track, Inc", email: "dillon@example.com", phone: "", address: "Arcadia, OK" }; f.project = "UTT Flagship Film";
let builds: any[] = [{ _id: "b1", title: "Service Agreement — UTT", blocks: sa.map((b: any) => (b.type === "items" ? { ...b, rows: b.rows.map((r: any, i: number) => (i ? r : { ...r, rate: 4800 })) } : b)), fields: f, signers: [], style: PRESET_STYLES[0], templateId: "t1", createdAt: now - 3600_000, updatedAt: now - 600_000 }];

export function builderQuery(name: string, args: any): any {
  switch (name) {
    case "builder:getProfile": return business;
    case "builder:listBuilds": return builds.map((b) => ({ _id: b._id, title: b.title, updatedAt: b.updatedAt, createdAt: b.createdAt, documentId: b.documentId ?? null, client: b.fields?.client?.name ?? "" }));
    case "builder:getBuild": { const b = builds.find((x) => x._id === args.buildId); return b ? { ...b, document: null } : null; }
    case "builder:listTemplates": return templates.map((t) => ({ _id: t._id, name: t.name, description: t.description ?? "", updatedAt: t.updatedAt, blocks: t.blocks.length, styleName: t.style?.name ?? "" }));
    case "builder:getTemplate": return templates.find((t) => t._id === args.templateId) ?? null;
    case "builder:listClauses": return [...clauses].sort((a, b) => a.title.localeCompare(b.title));
    case "builder:listStyles": { const any = styles.some((x) => x.isDefault); return { presets: PRESET_STYLES.map((st, i) => ({ index: i, style: st, isDefault: !any && i === 0 })), saved: styles }; }
    case "builder:listFonts": return [];
    case "builder:fileUrls": return {};
  }
  return undefined;
}

export function builderMutation(name: string, args: any): any {
  const t = Date.now();
  switch (name) {
    case "builder:saveProfile": business = args.business; return null;
    case "builder:createBuild": {
      const tp = templates.find((x) => x._id === args.templateId);
      const id = "b" + Math.random().toString(36).slice(2, 7);
      builds = [{ _id: id, title: tp ? tp.name : "Untitled document", blocks: tp ? tp.blocks.map((b: any) => ({ ...b, id: newId() })) : [{ id: newId(), type: "heading", text: "Untitled document", size: "title" }, { id: newId(), type: "parties", title: "Parties" }, { id: newId(), type: "text", rich: rich("") }, { id: newId(), type: "signatures", title: "Signatures", signers: ["heston", "client"], showTitle: true, showDate: true }], fields: emptyFields(business), signers: [], style: tp?.style ?? PRESET_STYLES[0], createdAt: t, updatedAt: t }, ...builds];
      return id;
    }
    case "builder:saveBuild": { const { buildId, ...rest } = args; builds = builds.map((b) => (b._id === buildId ? { ...b, ...rest, updatedAt: t } : b)); return null; }
    case "builder:deleteBuild": builds = builds.filter((b) => b._id !== args.buildId); return null;
    case "builder:saveAsTemplate": { const id = "t" + t; templates = [{ _id: id, name: args.name, description: args.description, blocks: args.blocks, fields: { project: args.fields.project, custom: [] }, style: args.style, createdAt: t, updatedAt: t }, ...templates]; return id; }
    case "builder:updateTemplate": templates = templates.map((x) => (x._id === args.templateId ? { ...x, ...args, updatedAt: t } : x)); return null;
    case "builder:duplicateTemplate": { const x = templates.find((y) => y._id === args.templateId); const id = "t" + t; templates = [{ ...x, _id: id, name: `${x.name} (copy)`, updatedAt: t }, ...templates]; return id; }
    case "builder:deleteTemplate": templates = templates.filter((x) => x._id !== args.templateId); return null;
    case "builder:ensureStarter": return { added: false };
    case "builder:saveClause": {
      if (args.clauseId) { clauses = clauses.map((c) => (c._id === args.clauseId ? { ...c, title: args.title, body: args.body, initials: args.initials, updatedAt: t } : c)); return args.clauseId; }
      const id = "c" + t; clauses = [...clauses, { _id: id, title: args.title, body: args.body, initials: args.initials, createdAt: t, updatedAt: t }]; return id;
    }
    case "builder:duplicateClause": { const c = clauses.find((x) => x._id === args.clauseId); const id = "c" + t; clauses = [...clauses, { ...c, _id: id, title: `${c.title} (copy)` }]; return id; }
    case "builder:deleteClause": clauses = clauses.filter((c) => c._id !== args.clauseId); return null;
    case "builder:saveStyle": {
      if (args.styleId) { styles = styles.map((s) => (s._id === args.styleId ? { ...s, name: args.name, style: args.style } : s)); return args.styleId; }
      const id = "st" + t; styles = [...styles, { _id: id, name: args.name, style: args.style, isDefault: false, createdAt: t, updatedAt: t }]; return id;
    }
    case "builder:setDefaultStyle": styles = styles.map((s) => ({ ...s, isDefault: s._id === args.styleId })); return null;
    case "builder:deleteStyle": styles = styles.filter((s) => s._id !== args.styleId); return null;
    case "builder:uploadUrl": return "mock://upload";
  }
  return undefined;
}
