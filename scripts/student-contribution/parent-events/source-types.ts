import type { EventIdentity, EventMarker } from "../../../src/features/student-contribution/model/parent-events/types";
export type SourceSheet = { fileId: string; title: string; sheet: string; gid: number; url: string; values: unknown[][] };
export type SourceBlock = {
  start: number; end: number; firstRow: number; lastRow?: number; headerRow: number; headerHash: string;
  eventKey: string; title: string; date: string; tenantId: string | null; eligibleList: boolean; issues: string[];
  name?: number; guardian?: number; phone?: number; contact?: number; school?: number; grade?: number;
  childDetail?: number; schoolGrade?: number; dateColumn?: number; dateYear?: number; rowKey?: number;
  sessionColumn?: number; session?: string; sessionMap?: Record<string, string>; timestampColumn?: number; gradeAsOf?: string; sameDayReviewed?: boolean;
  markers: { column: number; kind: EventMarker["kind"]; targetEventIds?: string[] }[];
};
export type SourceProfile = { fileId: string; gid: number; sheet: string; blocks: SourceBlock[]; excluded?: string };
export type ParsedRegistration = EventIdentity & {
  sourceId: string; identityHash: string; contentHash: string; fileId: string; sheetId: number; row: number;
  eventTitle: string; session?: string; eligibleList: boolean; issues: string[]; markers: EventMarker[]; raw: unknown[];
};
