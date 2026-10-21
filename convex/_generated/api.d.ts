/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activity from "../activity.js";
import type * as auth from "../auth.js";
import type * as bunny from "../bunny.js";
import type * as connector from "../connector.js";
import type * as http from "../http.js";
import type * as library from "../library.js";
import type * as mcp from "../mcp.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_edl from "../lib/edl.js";
import type * as lib_frames from "../lib/frames.js";
import type * as lib_mp4 from "../lib/mp4.js";
import type * as notes from "../notes.js";
import type * as phase0 from "../phase0.js";
import type * as slack from "../slack.js";
import type * as stills from "../stills.js";
import type * as stillsDb from "../stillsDb.js";
import type * as uploads from "../uploads.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activity: typeof activity;
  auth: typeof auth;
  bunny: typeof bunny;
  connector: typeof connector;
  http: typeof http;
  library: typeof library;
  mcp: typeof mcp;
  "lib/access": typeof lib_access;
  "lib/edl": typeof lib_edl;
  "lib/frames": typeof lib_frames;
  "lib/mp4": typeof lib_mp4;
  notes: typeof notes;
  phase0: typeof phase0;
  slack: typeof slack;
  stills: typeof stills;
  stillsDb: typeof stillsDb;
  uploads: typeof uploads;
  users: typeof users;
}>;

export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
