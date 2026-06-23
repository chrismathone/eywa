// 학생 엑셀 일괄등록 — 순수 파싱/분류(클라·서버 공용. ⚠️ server-only 금지, [[#61]]).
//
// ijw StudentMigrationModal 경량 이식. ijw는 30+필드·임의 컬럼 매핑·전화/학교 자동보정·업데이트 머지였지만,
// eywa는 **자체 엑셀 내보내기와 라운드트립**(내보내기 → 편집 → 다시 올리기)에 초점 — 우리 export 헤더
// (이름/학년/학교/상태/학부모 연락처)를 고정 인식하고 **신규 학생만 추가**(중복=건너뜀, 업데이트 미이식).
// ExcelJS 추출(서버)은 thin glue; 헤더 매핑·상태 변환·정규화·중복분류 등 로직은 여기(순수)에 모아 Vitest.

export const STUDENT_STATUSES = [
  "prospect",
  "consulted",
  "enrolled",
  "on_hold",
  "withdrawn",
] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

export type ImportField =
  | "name"
  | "grade"
  | "school"
  | "status"
  | "parentPhone"
  | "studentPhone"
  | "englishName";

/** 상태 라벨(한글) → enum. export가 쓰는 라벨과 일치. raw enum도 허용. */
export const STATUS_FROM_LABEL: Record<string, StudentStatus> = {
  예비: "prospect",
  상담: "consulted",
  상담완료: "consulted",
  재원: "enrolled",
  휴원: "on_hold",
  퇴원: "withdrawn",
};

/** 헤더(공백·괄호 제거 후) → 필드. 우리 export 헤더 + 흔한 별칭. */
const HEADER_ALIASES: Record<string, ImportField> = {
  이름: "name",
  성명: "name",
  학생명: "name",
  학년: "grade",
  학교: "school",
  상태: "status",
  학부모연락처: "parentPhone",
  보호자연락처: "parentPhone",
  연락처: "parentPhone",
  학부모전화: "parentPhone",
  원생연락처: "studentPhone",
  학생연락처: "studentPhone",
  영문이름: "englishName",
  영어이름: "englishName",
};

/** 헤더 텍스트를 표준화(좌우공백·내부공백·괄호 제거)해 필드로 해석. 없으면 null(무시 컬럼). */
export function fieldForHeader(raw: string): ImportField | null {
  const key = String(raw ?? "")
    .replace(/[()[\]{}\s]/g, "")
    .trim();
  return HEADER_ALIASES[key] ?? null;
}

/** 상태 라벨/enum → StudentStatus. 빈값·미인식은 prospect(예비) 기본(보수적 — 거짓 재원 방지). */
export function normalizeStatus(raw: string | null | undefined): StudentStatus {
  const v = String(raw ?? "").trim();
  if (!v) return "prospect";
  if ((STUDENT_STATUSES as readonly string[]).includes(v)) return v as StudentStatus;
  return STATUS_FROM_LABEL[v] ?? "prospect";
}

/**
 * 한국 전화번호 정규화 — students/actions.ts와 동일 규칙(숫자추출+하이픈, 앞자리0 보정).
 * import는 actions를 import하면 server-only가 딸려와 클라가 깨지므로([[#61]]) 순수 모듈에 둔다.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 10 && d.startsWith("10")) d = "0" + d;
  if (d.length === 11 && d.startsWith("010")) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10 && d.startsWith("02")) return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 9 && d.startsWith("02")) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  return String(raw).trim();
}

/** DB의 name_normalized 생성열과 동일: 소문자 + 모든 공백 제거. */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "");
}

/** 학생 자연키 — (정규화 이름, 학교, 학년). DB 부분 유니크 인덱스와 동일 차원. */
export function naturalKey(name: string, school: string | null, grade: string | null): string {
  return `${normalizeName(name)}|${(school ?? "").trim()}|${(grade ?? "").trim()}`;
}

export type ParsedRow = {
  rowNum: number; // 엑셀 행 번호(헤더=1, 데이터 2~) — 미리보기 표시용
  name: string;
  grade: string | null;
  school: string | null;
  status: StudentStatus;
  parentPhone: string | null;
  studentPhone: string | null;
  englishName: string | null;
};

export type RowKind = "new" | "duplicate" | "error";

export type ClassifiedRow = ParsedRow & { kind: RowKind; reason: string | null };

export type ImportSummary = { total: number; new: number; duplicate: number; error: number };

/**
 * 파싱된 행을 신규/중복/오류로 분류. 중복 = 기존 활성 학생 자연키 ∪ 파일 내 먼저 나온 행과 동일.
 * 이름 없으면 오류. 신규만 실제 등록 대상.
 */
export function classifyRows(parsed: ParsedRow[], existingKeys: Set<string>): {
  rows: ClassifiedRow[];
  summary: ImportSummary;
} {
  const seen = new Set<string>();
  const rows: ClassifiedRow[] = parsed.map((p) => {
    if (!p.name.trim()) return { ...p, kind: "error" as const, reason: "이름 없음" };
    const key = naturalKey(p.name, p.school, p.grade);
    if (existingKeys.has(key)) return { ...p, kind: "duplicate" as const, reason: "이미 등록된 학생" };
    if (seen.has(key)) return { ...p, kind: "duplicate" as const, reason: "파일 내 중복" };
    seen.add(key);
    return { ...p, kind: "new" as const, reason: null };
  });
  const summary: ImportSummary = {
    total: rows.length,
    new: rows.filter((r) => r.kind === "new").length,
    duplicate: rows.filter((r) => r.kind === "duplicate").length,
    error: rows.filter((r) => r.kind === "error").length,
  };
  return { rows, summary };
}
