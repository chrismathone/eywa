// ECS 시트 가져오기 — 서버·클라 공용 타입/순수 매핑.
// ⚠️ "use client"도 server-only도 붙이지 말 것(양쪽이 import하는 공유 모듈, gotcha #61·#81).
import type { SkillAreaSetting } from "@/features/owner/settings-types";

/** 마스터 시트에서 찾은 반 시트 1개 — 미리보기 1단계 결과. */
export type EcsSheetTarget = {
  spreadsheetId: string;
  /** 마스터 링크 셀의 반 이름(첫 줄). */
  sheetLabel: string;
  /** 매칭된 eywa 반 — null이면 가져오지 않는다(자동 생성 금지). */
  classId: string | null;
  className: string | null;
};

/** 반 1개 처리 결과(미리보기·적용 공통 — 적용이면 written 채움). */
export type EcsClassImportReport = {
  classId: string;
  className: string;
  spreadsheetId: string;
  /** 처리한 주차 탭. */
  weeks: { tab: string; monday: string | null; skipped: string | null }[];
  counts: {
    planLines: number;
    goals: number;
    marks: number;
  };
  written: { planLines: number; goals: number; marks: number } | null;
  /** 사람이 고쳐야 하는 것들 — 조용히 버리지 않고 전부 올린다. */
  issues: EcsImportIssue[];
};

export type EcsImportIssueKind =
  | "week-title" // 탭 제목에서 주차를 못 읽음
  | "week-ambiguous" // 시작/끝 요일이 어긋난 제목
  | "week-duplicate" // 같은 주를 가리키는 탭이 둘 이상(사본) — 하나만 쓴다
  | "slot-unmapped" // 시트 교시를 eywa 시간표 슬롯에 못 붙임
  | "skill-unknown" // 구분(영역)이 학원설정에 없음
  | "skill-missing" // 구분 칸이 비어 있음 — DB가 영역을 요구해 그 줄은 못 넣는다
  | "student-unresolved" // 이름으로 학생을 확정 못함
  | "student-off-roster" // 학생은 찾았지만 그 반 수강생이 아님
  | "save-failed"; // 저장 단계 실패(사유 원문 포함)

export type EcsImportIssue = {
  kind: EcsImportIssueKind;
  detail: string;
  /** 같은 사유가 여러 번이면 합쳐 센다. */
  count: number;
};

export const ISSUE_LABEL: Record<EcsImportIssueKind, string> = {
  "week-title": "주차 인식 실패",
  "week-ambiguous": "주차 제목 불일치",
  "week-duplicate": "같은 주 탭 중복",
  "slot-unmapped": "시간표에 없는 교시",
  "skill-unknown": "설정에 없는 영역",
  "skill-missing": "영역이 비어 있는 줄",
  "student-unresolved": "학생 확정 실패",
  "student-off-roster": "수강명단 밖 학생",
  "save-failed": "저장 실패",
};

export const ISSUE_HINT: Record<EcsImportIssueKind, string> = {
  "week-title": "탭 이름이 '7/27-31 …' 형식이어야 그 주로 들어갑니다. 그대로 두면 그 탭만 건너뜁니다.",
  "week-ambiguous": "탭 이름의 시작·끝 날짜가 다른 주를 가리킵니다. 끝 날짜 기준으로 넣었습니다.",
  "week-duplicate":
    "같은 주를 가리키는 탭이 둘 이상입니다(보통 '…의 사본'). 사본이 아닌 쪽만 넣고 나머지는 건너뜁니다 — 필요 없는 사본 탭은 시트에서 지워 주세요.",
  "skill-missing":
    "교재·진도는 적혀 있는데 '구분'(영역) 칸이 비어 있습니다. 어느 영역인지 없으면 저장할 수 없어 그 줄만 건너뜁니다 — 시트에서 영역을 채워 주세요.",
  "save-failed": "저장 중 오류가 났습니다. 그 반의 그 항목만 안 들어갔고 나머지는 그대로 들어갔습니다.",
  "slot-unmapped": "시트의 교시 시각이 eywa 시간표에 없습니다. 그 교시의 계획·기록은 넣지 않습니다.",
  "skill-unknown": "학원 설정 → 과목 운영의 영역 목록에 없는 이름입니다. 그 줄은 영역 없이 들어갑니다.",
  "student-unresolved": "같은 이름이 여럿이거나 없는 이름입니다. 그 학생 기록은 넣지 않습니다.",
  "student-off-roster":
    "eywa에서 그 반 수강생이 아닙니다(퇴원·미등록·다른 반 학생). 그 기록은 넣지 않습니다 — 수강 등록이 먼저입니다.",
};

/**
 * 시트의 '구분' 라벨 → 저장 slug. 학원설정 skillAreas가 단일 소스(라벨·key 양쪽 허용, 대소문자·공백 무시).
 * 못 찾으면 null — **slug를 지어내지 않는다**(raw 키 누출·미등록 영역 양산 방지).
 */
export function resolveSkillKey(label: string | null, areas: readonly SkillAreaSetting[]): string | null {
  if (!label) return null;
  const t = label.replace(/\s+/g, "").toLowerCase();
  const hit = areas.find(
    (a) => a.key.replace(/\s+/g, "").toLowerCase() === t || a.label.replace(/\s+/g, "").toLowerCase() === t,
  );
  return hit ? hit.key : null;
}

/** 이슈 목록에 한 건 누적(같은 kind+detail은 count만 증가). */
export function addIssue(list: EcsImportIssue[], kind: EcsImportIssueKind, detail: string): void {
  const hit = list.find((i) => i.kind === kind && i.detail === detail);
  if (hit) hit.count += 1;
  else list.push({ kind, detail, count: 1 });
}
