import "server-only";
import { isImportKind, type ImportKind } from "../kinds";
import type { ImporterDef } from "./types";

/**
 * 가져오기 레지스트리 — 요청 받은 한 벌만 불러온다(지연 import: 서식 하나 받는데 12벌을 다 싣지 않게).
 * 🔑 `kinds.ts`의 IMPORT_KINDS와 키가 같아야 한다(`satisfies`가 빠진 줄을 잡는다).
 */
const LOADERS = {
  students: () => import("../importers/students"),
  staff: () => import("../importers/staff"),
  classrooms: () => import("../importers/classrooms"),
  classes: () => import("../importers/classes"),
  "enrollment-consultations": () => import("../importers/enrollment-consultations"),
  "student-consultations": () => import("../importers/student-consultations"),
  attendance: () => import("../importers/attendance"),
  invoices: () => import("../importers/invoices"),
  expenses: () => import("../importers/expenses"),
  textbooks: () => import("../importers/textbooks"),
  calendar: () => import("../importers/calendar"),
  shuttle: () => import("../importers/shuttle"),
} satisfies Record<ImportKind, () => Promise<{ default: unknown }>>;

export async function loadImporter(kind: string): Promise<ImporterDef | null> {
  if (!isImportKind(kind)) return null;
  const mod = await LOADERS[kind]();
  return mod.default as unknown as ImporterDef;
}
