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
import type * as clients from "../clients.js";
import type * as shares from "../shares.js";
import type * as emails from "../emails.js";
import type * as lib_shareAccess from "../lib/shareAccess.js";
import type * as lib_hash from "../lib/hash.js";
import type * as lib_viewer from "../lib/viewer.js";
import type * as lib_email from "../lib/email.js";
import type * as connector from "../connector.js";
import type * as crons from "../crons.js";
import type * as dropbox from "../dropbox.js";
import type * as emailTest from "../emailTest.js";
import type * as finalTest from "../finalTest.js";
import type * as http from "../http.js";
import type * as library from "../library.js";
import type * as mcp from "../mcp.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_dropboxPath from "../lib/dropboxPath.js";
import type * as lib_edl from "../lib/edl.js";
import type * as lib_frames from "../lib/frames.js";
import type * as lib_mp4 from "../lib/mp4.js";
import type * as lib_mp4audio from "../lib/mp4audio.js";
import type * as lib_peaks from "../lib/peaks.js";
import type * as lib_waveformDecode from "../lib/waveformDecode.js";
import type * as lib_transcript from "../lib/transcript.js";
import type * as lib_voice from "../lib/voice.js";
import type * as notes from "../notes.js";
import type * as phase0 from "../phase0.js";
import type * as player from "../player.js";
import type * as prefs from "../prefs.js";
import type * as r1test from "../r1test.js";
import type * as r1results from "../r1results.js";
import type * as register from "../register.js";
import type * as reviewFiles from "../reviewFiles.js";
import type * as reviewTest from "../reviewTest.js";
import type * as scrubCheck from "../scrubCheck.js";
import type * as signTest from "../signTest.js";
import type * as lib_bunnySign from "../lib/bunnySign.js";
import type * as lib_media from "../lib/media.js";
import type * as lib_reviewStorage from "../lib/reviewStorage.js";
import type * as lib_register from "../lib/register.js";
import type * as slack from "../slack.js";
import type * as stills from "../stills.js";
import type * as testdata from "../testdata.js";
import type * as transcribe from "../transcribe.js";
import type * as transcripts from "../transcripts.js";
import type * as stillsDb from "../stillsDb.js";
import type * as uploads from "../uploads.js";
import type * as users from "../users.js";
import type * as waveform from "../waveform.js";
import type * as waveforms from "../waveforms.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activity: typeof activity;
  auth: typeof auth;
  bunny: typeof bunny;
  clients: typeof clients;
  shares: typeof shares;
  emails: typeof emails;
  "lib/shareAccess": typeof lib_shareAccess;
  "lib/hash": typeof lib_hash;
  "lib/viewer": typeof lib_viewer;
  "lib/email": typeof lib_email;
  connector: typeof connector;
  crons: typeof crons;
  dropbox: typeof dropbox;
  emailTest: typeof emailTest;
  finalTest: typeof finalTest;
  http: typeof http;
  library: typeof library;
  mcp: typeof mcp;
  "lib/access": typeof lib_access;
  "lib/dropboxPath": typeof lib_dropboxPath;
  "lib/edl": typeof lib_edl;
  "lib/frames": typeof lib_frames;
  "lib/mp4": typeof lib_mp4;
  "lib/mp4audio": typeof lib_mp4audio;
  "lib/peaks": typeof lib_peaks;
  "lib/waveformDecode": typeof lib_waveformDecode;
  "lib/transcript": typeof lib_transcript;
  "lib/voice": typeof lib_voice;
  notes: typeof notes;
  phase0: typeof phase0;
  player: typeof player;
  prefs: typeof prefs;
  r1test: typeof r1test;
  r1results: typeof r1results;
  register: typeof register;
  reviewFiles: typeof reviewFiles;
  reviewTest: typeof reviewTest;
  scrubCheck: typeof scrubCheck;
  signTest: typeof signTest;
  "lib/bunnySign": typeof lib_bunnySign;
  "lib/media": typeof lib_media;
  "lib/reviewStorage": typeof lib_reviewStorage;
  "lib/register": typeof lib_register;
  slack: typeof slack;
  stills: typeof stills;
  testdata: typeof testdata;
  transcribe: typeof transcribe;
  transcripts: typeof transcripts;
  stillsDb: typeof stillsDb;
  uploads: typeof uploads;
  users: typeof users;
  waveform: typeof waveform;
  waveforms: typeof waveforms;
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
