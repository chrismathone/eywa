/**
 * 선생님 원스크린 — 표(스프레드시트) 뷰 순수 헬퍼.
 * 카드↔표 토글의 표 쪽 행 구성·발송대상 판정을 순수 함수로 분리(CLAUDE.md: 계산 함수 분리+Vitest).
 */
import { toHomeworkRateChoice } from "./homework-rate";
import { asProgressMode } from "./progress-mode";
import { attitudeNeedsNote, isHomeworkMissed, testSkipComplete, type DailyTestSkip } from "./math-report-pilot-sections";
import { pilotLessons } from "./math-report-pilot";
import { resolveRowFields } from "./row-fields";
import type { OneScreenStudent, PrevReport, Subject } from "./types";

/**
 * 표 한 행 = (학생 × **반**). lesson_reports 1건·발송 1건과 1:1(0134a — 예전엔 과목 단위였다).
 * ⚠️ `subject.name`은 그래서 학생 안에서 유일하다(같은 과목 두 반이면 로스터가 반 이름을 덧붙인다).
 *    그 유일성이 깨지면 두 행이 같은 state·같은 보고서를 가리켜 서로를 덮는다.
 */
export type GridRow = {
  student: OneScreenStudent;
  subject: Subject;
  subjectIndex: number;
  key: string; // `${student.id}::${subject.name}` — React key·상태 인덱싱
};

/** 학생 목록 → (학생 × 과목) 행 평탄화. 과목 순서 보존, 과목 없는 학생 제외(발송 단위가 과목). */
/** 행 키 = `${studentId}::${subjectName}` — 선택·로딩·첨부 상태를 이 키로 인덱싱한다(문자열 조립 산재 금지). */
export const rowKey = (studentId: string, subjectName: string): string => `${studentId}::${subjectName}`;

export function buildGridRows(students: OneScreenStudent[]): GridRow[] {
  const rows: GridRow[] = [];
  for (const student of students) {
    student.subjects.forEach((subject, subjectIndex) => {
      rows.push({ student, subject, subjectIndex, key: rowKey(student.id, subject.name) });
    });
  }
  return rows;
}

/**
 * 표시 행 목록 → 렌더 메타(학생 묶음 첫 행 여부·학생 묶음 순번). **표시 순서 기준**이라 순서 모드 재배열에도 정합.
 * 키보드 세로 이동(3-1)의 nav 인덱스 원천: 학생 단위 열(일일/확인 점수)은 studentRow(첫 행만),
 * 과목 단위 열(교재·오늘과제)은 행 렌더 인덱스를 쓴다 — 다과목 학생의 중복 점수칸에 Enter가 멈추지 않게(리뷰 확정 결함).
 */
export type RowRenderMeta = { firstOfStudent: boolean; studentRow: number };
export function buildRowRenderMeta(rows: readonly { student: { id: string } }[]): RowRenderMeta[] {
  let seq = -1;
  let prev: string | null = null;
  return rows.map((r) => {
    const first = r.student.id !== prev;
    if (first) seq += 1;
    prev = r.student.id;
    return { firstOfStudent: first, studentRow: seq };
  });
}

/**
 * 저장·발송 대상 판정 — 오늘 진도가 입력된 행만(빈 보고서 방지).
 * `progressOptional` = 진도 칸이 없는 글(SRS 보고서 — `isProgressOptionalReport`, jj-books.ts)이라 진도 없이도 대상.
 */
export function isReportEligible(subject: Subject, progressOptional = false): boolean {
  return progressOptional || (!!subject.today && subject.today.trim().length > 0);
}

/**
 * 반 필터 매칭 — 특정 반 선택 시 그 반 소속 과목 행만(다과목/다반 학생의 타 반 행 혼입 차단).
 * classFilter=null("전체")면 전부. 반 모호(className=null, 같은 과목 두 반)는 통과(어느 반인지 못 가르므로 표시).
 */
export function rowInClass(subject: Subject, classFilter: string | null): boolean {
  if (!classFilter) return true;
  // 보강 행은 반이 없다 — **어느 수업 시간에 한 보강인지**(앵커)가 있으면 그 반에서만 보인다(원장 2026-08-03).
  // ⚠️ 앵커가 없는 행(옛 기록·'전체'에서 추가)까지 숨기면 안 된다 — 카드는 보이는데 그 안의 보강 행만
  //    사라져 "발송한 보고서가 또 없어졌다"가 된다. 앵커 없는 행은 종전대로(반 모호 = 어디서나 표시).
  if (subject.makeup && !subject.classId)
    return !subject.makeupClassName || subject.makeupClassName === classFilter;
  return subject.className == null || subject.className === classFilter;
}

/**
 * 이 행의 반(이름) — 반 필터(`rowInClass`)와 **같은 열쇠**. 보강 행(반 없음)은 보강을 넣은 수업(앵커), 모르면 null.
 * 일괄 동작이 "같은 반인가"를 볼 때 쓴다(원장 2026-10-15 — 맨 위 행 복사가 다른 반까지 채우던 것).
 */
export function rowClassName(subject: Pick<Subject, "makeup" | "classId" | "className" | "makeupClassName">): string | null {
  if (subject.makeup && !subject.classId) return subject.makeupClassName ?? null;
  return subject.className ?? null;
}

/**
 * 이 학생이 필터한 반의 **실제 수강생**인가 — 좌측 그룹 라벨을 필터 반으로 리맵할지의 기준이기도 하다.
 * `tags`(수강 반 전체)가 원천이고, 비면 대표 `tag`로 폴백(로스터 규약, roster.ts `os.tags`).
 */
export function isClassMember(
  student: Pick<OneScreenStudent, "tag" | "tags">,
  classFilter: string,
): boolean {
  return (student.tags ?? [student.tag]).includes(classFilter);
}

/**
 * 반 필터가 이 **학생 카드**를 남기는가(행 단위는 위 `rowInClass`).
 *
 * 🔴 2026-07-27엔 보강 학생을 **모든 반 필터에 통과**시켰다(특정 반을 고른 채 보강을 추가하면 카드가
 *    사라져서). 그 우회가 이번엔 반대 불만이 됐다 — *"보강 추가한 학생이 모든 수업에서 보인다"*(원장
 *    2026-08-03). 뿌리는 같다: **보강 행에 소속이 없었다.**
 *    → 0171a `makeup_class_id`(어느 수업 시간에 한 보강인가)를 앵커로 두고, 앵커가 맞는 반에서만 보인다.
 *    추가 시점의 반 필터가 그대로 앵커가 되므로 07-27의 "추가했는데 사라짐"은 재발하지 않는다.
 * ⚠️ 조건이 `su.makeup`만이면 안 된다 — 정규 행에도 강사가 "보강" 토글을 켤 수 있다(그 행은 `classId`가
 *    있고 그 반 소속이라 필터를 우회할 이유가 없다). **반이 없는(`classId` 없음) 보강 행만** 앵커로 판정한다.
 */
export function studentInClass(
  student: Pick<OneScreenStudent, "tag" | "tags" | "isMakeup" | "subjects">,
  classFilter: string | null,
): boolean {
  if (!classFilter) return true;
  // 이 반에서 한 보강 행이 있으면 카드를 남긴다(정규 카드에 병합된 보강 포함).
  if (student.subjects.some((su) => su.makeup && !su.classId && su.makeupClassName === classFilter))
    return true;
  // 보강 전용 카드(담당 반 수강생이 아님)는 앵커가 맞을 때만 — 앵커가 없으면 '전체'에서만 보인다.
  if (student.isMakeup) return false;
  return isClassMember(student, classFilter);
}

// ───────────────────────── 결석 연동 — 작업별 대상 판정 (2-3) ─────────────────────────

export type RowAction = "save" | "send" | "autowrite";

/**
 * 이미 학부모 게시판에 올라간 보고서인가 — 발송 대상에서 뺄 유일한 상태.
 *
 * ⚠️ `success`만 본다. queued·processing은 "발송 진행 중"이라 서버가 따로 막고(in-flight 보호),
 *    failed·too_old·name_conflict는 **아직 학부모에게 안 갔으므로** 다시 시도할 수 있어야 한다.
 *    여기서 그 상태들까지 막으면 실패한 보고서를 강사가 영영 못 보낸다.
 */
export function isAlreadySent(status: string | null | undefined): boolean {
  // `already_sent`는 서버 액션의 **결과 코드**(DB 상태 아님)다. 호출부가 배지용으로 success로 정규화하지만,
  // 어딘가 그대로 흘러들어도 게이트가 fail-open 되지 않도록 여기서도 같이 인정한다(가드는 보수적으로).
  return status === "success" || status === "already_sent";
}

/**
 * 행이 액션 대상인가 — 진도 입력은 공통 필수(빈 보고서 방지).
 * ⚠️ save=결석·발송완료 포함(기록은 언제든 보존해야), send=결석·**발송완료** 제외, autowrite=결석 제외.
 * 결석 판정은 행(반) 단위 raw(absent)만 — 조퇴(early_leave)는 수업을 들었으므로 발송 유지.
 *
 * 발송완료 제외(2026-07-22): 일괄 발송을 두 번 누르면 그날 전원에게 게시글이 하나씩 더 붙었다
 * (ClassNote는 수정·삭제가 없어 되돌릴 수 없다). 서버(saveAndQueueClassnote)가 권위 있는 차단이고
 * 여기는 화면 게이트 — 버튼을 잠그고 일괄 대상에서 빼서 "눌렀는데 아무 일도 안 남"을 없앤다.
 * ⚠️ `subject.classnoteStatus`는 **로스터가 로드한 시점** 값이라 세션 중 방금 보낸 건을 모른다 →
 *    호출부(selectRows)가 화면 state의 최신 상태를 넣어 준다(`statusOverride`).
 */
/**
 * 이 행의 **실효** ClassNote 상태 — 화면 state가 로스터 스냅샷을 이긴다.
 *
 * 🔴 `undefined`(아직 모름)와 `null`(이번 세션에서 **명시적으로 지워짐**)을 구분하는 게 핵심이다.
 *    공유링크 재발급·첨부 변경은 서버가 상태를 리셋하고 화면도 지운다 — 그때 `?? 스냅샷`으로 읽으면
 *    **로스터가 실어 온 옛 "success"가 되살아나** 방금 푼 잠금이 그대로 다시 걸린다.
 *    그러면 재발급이 유일한 탈출구인데 그 탈출구가 새로고침 전까지 죽는다(적대 검수 확정).
 */
export function effectiveClassnoteStatus(
  live: string | null | undefined,
  snapshot: string | null | undefined,
): string | null | undefined {
  return live !== undefined ? live : snapshot;
}

/**
 * 출결 미체크 발송 게이트(2026-08-17 원장 지시) — 진도·멘트처럼 **출결 체크도 발송의 필요 입력**이다.
 * 기존 결석 게이트는 "기록 없음 = 통과"(fail-open)였는데, 그 틈으로 출결을 안 찍은 보고서가 나갔다.
 *
 * ⚠️ **정규 반 행(classId 있음·보강 아님)만** 판정한다 — 결석 게이트의 예외와 같은 이유:
 *    보강·수업외 행은 강사에게 출결을 기록할 수단이 없고, 반 없는 행(이관·반 모호)은 attendanceRaw가
 *    안 채워져 판정 근거 자체가 없다(로스터가 classId 있는 행만 채운다, roster.ts). 그 행들까지 막으면
 *    체크할 방법이 없는 행이 영영 발송 불가가 된다.
 * ⚠️ **send에만** 건다 — save(기록 보존)·autowrite(멘트 초안)는 출결과 무관한 작업이다.
 */
export function isAttendanceUnchecked(
  subject: Pick<Subject, "attendanceRaw" | "classId" | "makeup">,
): boolean {
  if (subject.makeup || !subject.classId) return false;
  return subject.attendanceRaw == null;
}

/**
 * 이 행의 반이 **'수업보고서 미발송'**(0174a)인가 — 보고서 쪽만 잠그는 축.
 *
 * 🔴 2026-08-19 원장: *"보고서는 안보내지만 이제부터라도 출결은 찍을것"*. 그래서 반은 로스터에 **남고**
 *    (예전엔 통째로 빠져 출결 알약이 없었다) 여기서 **발송·자동작성·보고서 입력**만 잠근다.
 * ⚠️ `save`는 잠그지 않는다 — 결석 행과 같은 규약("기록은 언제든 보존")이고, 이 반의 **지난 보고서**
 *    수정 경로까지 막으면 report-optout.ts가 못 박아 둔 "숨김이지 차단이 아니다"를 깨뜨린다.
 * ⚠️ 출결·수업타임·결석 사유도 대상이 아니다(이 반이 화면에 돌아온 이유가 그것이다).
 */
export function isReportOptoutRow(subject: Pick<Subject, "reportOptout">): boolean {
  return subject.reportOptout === true;
}

export function isRowActionable(
  subject: Subject,
  action: RowAction,
  statusOverride?: string | null,
  opts?: {
    /**
     * 출결 쓰기 권한이 없는 계정(roster canEditAttendance=false) — 미체크 게이트 **해당 없음**.
     * 충족할 수 없는 입력을 요구하면 발송이 영구 차단되고, 알약도 없는데 "출결을 기록하라"는
     * 거짓 안내가 된다(2026-08-17 적대 감사 P0-3). 서버 게이트도 같은 예외를 탄다.
     */
    attendanceReadOnly?: boolean;
    /** 진도가 필요 없는 글(SRS 보고서, 원장 2026-11-05) — `isProgressOptionalReport`(jj-books.ts)를 그대로 넣는다. */
    progressOptional?: boolean;
  },
): boolean {
  if (!isReportEligible(subject, opts?.progressOptional)) return false;
  // 발송 완료 = **수정도 금지**(2026-07-22 원장 지시). ClassNote는 게시글 수정·삭제가 없어 학부모는
  // 발송 시점의 이미지를 그대로 갖고 있다 — 여기서 내용을 바꾸면 기록과 학부모가 본 것이 갈라진다.
  // 그래서 save·send·autowrite **전부** 막는다(예전엔 save만 열려 있었다).
  // 푸는 유일한 문 = 공유링크 재발급(그 건을 무효화 선언). 서버 saveLessonReport가 같은 규칙을 강제한다.
  if (isAlreadySent(statusOverride ?? subject.classnoteStatus)) return false;
  // 수업 나누기로 온 행(0351a) = 저장·발송·자동작성 **전부** 대상이 아니다 — 그 학생의 보고서는 원래 반 담임이 쓴다
  // (원장 2026-10-06). 미발송 반과 달리 지켜야 할 '지난 보고서'도 없다(이 반 수강생이 아니다).
  if (subject.splitIn) return false;
  if (action === "save") return true;
  // 미발송 반 = 발송·자동작성 대상이 아니다(save는 위에서 이미 통과했다 — 기록은 보존).
  if (isReportOptoutRow(subject)) return false;
  // 출결 미체크 = 발송만 제외(위 게이트) — 서버 saveAndQueueClassnote가 같은 규칙을 이중 방어한다.
  if (action === "send" && !opts?.attendanceReadOnly && isAttendanceUnchecked(subject)) return false;
  return subject.attendanceRaw !== "absent";
}

/**
 * 이 행의 **보고서 입력**을 열어도 되는가 — 표·카드 모드 **공용 단일 소스**
 * (원장 2026-08-07: *"카드뷰 모드에서도 비활성화 되니까 일관성이 있어야함"* → 같은 날
 *  *"결석을 눌렀는데 진도 같은거 전부다 적을 수 있던데? 완전히 차단되어있지 않은것 같은데"*).
 *
 * 잠그는 경우는 셋뿐이다:
 *  · **이미 발송** — 수정 금지(2026-07-22). ClassNote는 게시글 수정이 없어 여기서 고치면 기록과
 *    학부모가 본 것이 갈라진다.
 *  · **'수업보고서 미발송' 반**(0174a, 2026-08-19) — 그 반의 보고서는 학부모에게 나가지 않는다.
 *    반은 출결을 찍으라고 화면에 돌아왔을 뿐이라, 보고서 칸을 열어 두면 **아무도 안 볼 글**을 쓰게 된다.
 *  · **결석** — 그 학생은 그 수업에 없었다. 진도·테스트·태도·과제는 **일어나지 않은 일**이고,
 *    멘트·추세는 발송이 구조적으로 막히는 행이라(`isRowActionable` send·autowrite + 서버 게이트 +
 *    일괄 발송 사전 필터) 어디로도 나가지 않는다. 둘 다 적어봐야 헛수고이자 거짓 기록이다.
 *
 * 🔴 **출결 계열(출결 알약·수업타임·결석 사유 메모)은 이 판정의 대상이 아니다** — 잘못 누른 결석을
 *    되돌릴 **유일한 문**이라 함께 잠그면 강사가 스스로 빠져나올 수 없다(그 행이 영영 잠긴다).
 *    결석한 날에도 사유·시수는 남겨야 하는 기록이기도 하다.
 * ⚠️ **진도 미입력은 잠그지 않는다** — 멘트를 먼저 쓰고 진도를 채우는 순서가 실제로 있다.
 *    그래서 `isRowActionable`을 재사용하면 안 된다(그건 `isReportEligible`을 먼저 본다 — 회귀 선례 #167 주석).
 * ⚠️ 이건 **입력 잠금**이지 게이트가 아니다 — 저장·발송 판정은 위 함수와 서버가 따로 잡는다(#77).
 */
export function isRowInputEditable(subject: Subject, statusOverride?: string | null): boolean {
  // ⚠️ `??`가 아니라 `!== undefined` — **null은 "이번 세션에서 명시적으로 지워짐"**(재발급·첨부변경)이라
  //    스냅샷의 옛 "success"를 되살리면 안 된다(effectiveClassnoteStatus와 같은 규약). `??`로 쓰면
  //    링크를 재발급해 잠금을 푼 행이 다시 잠긴다.
  const status = statusOverride !== undefined ? statusOverride : subject.classnoteStatus;
  if (isAlreadySent(status)) return false;
  // 미발송 반(0174a) — 학부모에게 나갈 일이 없는 칸이라 적어 봐야 헛수고다(결석 행과 같은 이유).
  // ⚠️ 출결 알약·수업타임·결석 사유는 이 판정의 대상이 아니다(위 🔴 주석).
  if (isReportOptoutRow(subject)) return false;
  return subject.attendanceRaw !== "absent";
}

/**
 * '맨 위 행 복사'의 **대상** 판정 — 제외 사유는 **발송 완료 하나뿐**이다.
 *
 * 🔴 여기에 `isRowActionable(…,"save")`를 쓰면 안 된다(2026-07-23 회귀). 그 판정은
 *    `isReportEligible`(=진도가 있어야 통과)을 먼저 보기 때문에, **진도가 빈 행**을 전부 대상에서 뺀다.
 *    그런데 진도가 빈 행이야말로 복사로 채우려는 대상이라, 기능이 사실상 항상 0건이 됐다.
 *    (실제 증상: 보고서가 한 건도 없는 반에서 "복사할 칸이 없습니다 — 발송 완료 6행".)
 *
 * 🔴 **결석 행도 제외한다**(2026-08-07 확대) — 예전엔 대상이었다("기록은 언제든 보존"). 그런데 이제
 *    결석 행은 입력이 잠기므로, 복사가 값을 밀어 넣으면 **강사가 지울 수 없는 값**이 남는다(잠근 문 옆의
 *    뒷문 = #77의 뒤집힌 꼴). 게다가 그 학생은 그 수업에 없었으니 진도·교재를 채우는 것 자체가 거짓이다.
 *    되돌리려면 출결을 되돌리면 된다 — 그러면 이 판정도 함께 열린다.
 */
export function isCopyTargetRow(subject: Subject, statusOverride?: string | null): boolean {
  return isRowInputEditable(subject, statusOverride);
}

/**
 * 일괄 발송 confirm 누락 요약(2-4) — **고유 학생 수** 기준(과목 행 수 아님).
 * 호출부가 결석 제외된(send 대상) 행만 넘기므로 결석 학생은 누락 카운트에 안 들어간다.
 */
export function summarizeSendGaps(
  rows: GridRow[],
  opts: { dailyEnabled: boolean; checkEnabled: boolean },
): { missingAttitude: number; missingTest: number } {
  const seen = new Set<string>();
  let missingAttitude = 0;
  let missingTest = 0;
  for (const r of rows) {
    if (seen.has(r.student.id)) continue;
    seen.add(r.student.id);
    // 요약 카운트도 **행 기준**(row-fields.ts) — 보강 행이 정규 값을 빌려 "입력됨"으로 세지 않게.
    const rowEval = resolveRowFields(r.student, r.subject);
    if (!rowEval.attitude) missingAttitude++;
    const t = rowEval.tests;
    if ((opts.dailyEnabled && t.daily.score == null) || (opts.checkEnabled && t.check.score == null))
      missingTest++;
  }
  return { missingAttitude, missingTest };
}

// ───────────────────────── 값 일괄 적용 (1-2) ─────────────────────────

/** 값 일괄 적용 patch — **비어 있는(undefined/공백) 필드는 적용하지 않는다**(값 지우기 아님 — 지우기는 개별 셀에서). */
export type BulkPatch = {
  attitude?: string;
  homework?: string;
  textbook?: string;
  homeworkToday?: string;
  /** 오늘 진도 — 필드명은 모듈 전체 규약(planPrevFill·planCopyFirstRow)과 같은 `today`. */
  today?: string;
  /** 오늘 수업 성격(복습·문제풀이, progress-mode.ts) — 진도와 같은 과목 행에만(원장 2026-10-26). */
  progressMode?: string;
  /** 소단원별 이해도 — 그 행 오늘 진도의 소단원 전부에 같은 점수(0~10, 단계 버튼 우수·보통·나쁨, 원장 2026-10-26). 새 수학 보고서 행에만. */
  understanding?: number;
  /** 이해도에서 뺄 소단원(진도칸 원문 차시) — 그 행 오늘 진도에 있는 것만 뺀다. 새 수학 보고서 행에만(원장 2026-10-27). */
  understandingOff?: string[];
  /** 수업 태도 의견(하·중하일 때 강사 원문, 2026-10-26) — 태도가 하·중하인(이번에 그렇게 바꾸는 것 포함) 새 수학 보고서 행에만. */
  attitudeNote?: string;
  /** 숙제 미제출 사유(원장 2026-10-27 표 일괄 점검) — 숙제가 미제출·0%인(이번에 그렇게 바꾸는 것 포함) 새 수학 보고서 행에만. */
  homeworkMissReason?: string;
  /**
   * 일일 테스트 '안 봄' + 사유(원장 2026-10-27) — 새 수학 보고서 행에만. 사유를 다 고른 값만 넣는다(`testSkipComplete`).
   * 계획 결과(`set`)에서 null = '봄'으로 되돌림 — 이번 일괄이 그 행에 일일 점수를 넣을 때(점수를 넣었는데 '안 봄'이 남으면 점수가 안 읽힌다).
   */
  dailyTestSkip?: DailyTestSkip | null;
  // ── 2026-10-02 추가(원장 *"일괄 입력에 지금 없는거 추가"*) — 전부 **행 단위**. 값이 없으면(undefined) 적용하지 않는다. ──
  /** 특이사항(강사 메모). */
  note?: string;
  /** 일일·확인 테스트 — 맞은 개수 / 문항수. */
  dailyScore?: number;
  dailyMax?: number;
  checkScore?: number;
  checkMax?: number;
  /** 오늘 영상 과제 있음/없음 — 영상 과제를 쓰는 행(`videoOk`)에만. */
  videoHomework?: boolean;
  /** 영상 첨부 링크 넣기 — 고를 수 있는 행(`linkOk`)이고 영상 과제가 켜진(이번에 켜는 것 포함) 행에만 켠다. */
  videoSubmitLink?: boolean;
  /** 영상 숙제 마감(7일 · 다음 수업, 원장 2026-10-15) — 마감을 고를 수 있는 행(`dueOk`)이고 영상 과제가 켜진(이번에 켜는 것 포함) 행에만. */
  videoHomeworkDue?: "week" | "next";
};

/** 일괄 적용 대상 행의 현재값(경량 shape — 테스트 용이). 태도·과제는 학생 단위, 교재·오늘과제·진도는 과목(행) 단위. */
export type BulkTarget = {
  studentId: string;
  subjectName: string;
  /** 진도 setter가 인덱스 기반(setProgressFor) — 이름만으론 못 쓴다. */
  subjectIndex: number;
  /** 진도를 같은 과목 행에만 넣기 위한 키(미지정=math, 진도 셀 분기와 동일 규약). */
  subjectKey: string;
  today: string;
  /** 지금 수업 성격(복습·문제풀이) — "빈 칸만" 판정용. */
  progressMode?: string | null;
  /** 새 수학 보고서 행인가(이해도 칸이 있는 행) — 아니면 이해도를 넣지 않는다. */
  understandingOk?: boolean;
  /** 강사가 이해도를 하나라도 직접 매겼나 — '빈 칸만'이면 이런 행은 건너뛴다. */
  understandingStored?: boolean;
  attitude: string | null;
  /** 지금 수업 태도 의견 — '빈 칸만' 판정용(2026-10-26). */
  attitudeNote?: string;
  /** 태도 의견을 쓰는 행인가(새 수학 보고서) — 아니면 의견을 넣지 않는다. 숙제 미제출 사유·일일 테스트 '안 봄'도 같은 행에만. */
  attitudeNoteOk?: boolean;
  /** 지금 숙제 미제출 사유 — '빈 칸만' 판정용. */
  homeworkMissReason?: string;
  /** 지금 일일 테스트 '안 봄' 상태 — 있으면 일일 테스트 칸은 '찬' 것으로 본다('빈 칸만'). */
  dailyTestSkip?: DailyTestSkip | null;
  homework: string;
  textbook: string;
  homeworkToday: string;
  // ── 2026-10-02 추가분의 현재값 — 안 넘기면 그 칸은 '비어 있음'·'대상 아님'으로 본다(옛 호출부·테스트 그대로). ──
  note?: string;
  dailyScore?: number | null;
  dailyMax?: number;
  checkScore?: number | null;
  checkMax?: number;
  /** 지금 값 — undefined = 고른 적 없음('빈 칸'). */
  videoHomework?: boolean;
  videoSubmitLink?: boolean;
  videoHomeworkDue?: "week" | "next";
  /** 이 행에 '영상 과제' 토글이 있나(반 있음 + 학원 설정이 켠 반) — 화면 토글과 같은 판정. */
  videoOk?: boolean;
  /** 이 행에서 '영상 첨부 링크 넣기'를 고를 수 있나(`submitLinkChoosable`). */
  linkOk?: boolean;
  /** 이 행에서 마감을 고를 수 있나 — `videoOk` + 마감 칸이 준비됨(행의 마감 토글과 같은 조건). */
  dueOk?: boolean;
  /**
   * 입력이 잠긴 행(발송 완료·결석) — 값을 **밀어 넣지 않는다**.
   * ⚠️ 행 자체를 목록에서 빼는 게 아니라 값 적용만 건너뛴다 — 같은 목록을 출결 일괄 적용이 함께 쓰는데,
   *    거기서 빠지면 잘못 찍은 결석을 일괄로 되돌릴 수 없다.
   */
  locked?: boolean;
};

const normPatchField = (v: string | undefined): string | undefined => {
  const t = v?.trim();
  return t ? t : undefined;
};
/** 테스트 숫자 — 0 이상의 정수만(문항수는 1~100). 그 밖은 '적용 안 함'. */
const normCount = (v: number | undefined, min: number): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && Math.round(v) >= min ? Math.min(100, Math.round(v)) : undefined;

/**
 * 값 일괄 적용 계획 — patch에 채워진 필드만, onlyEmpty면 현재값이 빈 칸인 행만.
 * 태도·과제도 보고서 행 단위다. 선택된 행만 각각 채우며 다른 수업의 값을 덮지 않는다.
 *
 * ⚠️ **진도(today)는 `progressSubjectKey`와 같은 과목 행에만** 넣는다 — 수학 진도가 영어 행에 들어가면
 * 그대로 학부모에게 나간다(planCopyFirstRow의 과목 가드와 같은 이유). 키를 안 주면 진도는 적용하지 않는다
 * (대상 과목이 모호한 채로 진도를 뿌리는 것보다 아무것도 안 하는 게 낫다).
 */
export function planBulkApply(
  targets: BulkTarget[],
  patch: BulkPatch,
  onlyEmpty: boolean,
  progressSubjectKey?: string,
): Array<{ studentId: string; subjectName: string; subjectIndex: number; set: BulkPatch }> {
  const p = {
    attitude: normPatchField(patch.attitude),
    homework: normPatchField(patch.homework),
    textbook: normPatchField(patch.textbook),
    homeworkToday: normPatchField(patch.homeworkToday),
    today: normPatchField(patch.today),
    note: normPatchField(patch.note),
    dailyScore: normCount(patch.dailyScore, 0),
    dailyMax: normCount(patch.dailyMax, 1),
    checkScore: normCount(patch.checkScore, 0),
    checkMax: normCount(patch.checkMax, 1),
  };
  const out: Array<{ studentId: string; subjectName: string; subjectIndex: number; set: BulkPatch }> = [];
  for (const t of targets) {
    if (t.locked) continue; // 잠긴 행엔 아무 값도 넣지 않는다(지울 수 없는 값이 남는다)
    const set: BulkPatch = {};
    if (p.attitude !== undefined && (!onlyEmpty || !t.attitude)) set.attitude = p.attitude;
    // 수업 태도 의견 — 결과 태도가 하·중하인 행만. '빈 칸만'은 의견이 빈 행에만(적어 둔 의견을 덮지 않는다).
    if (
      patch.attitudeNote?.trim() &&
      t.attitudeNoteOk &&
      attitudeNeedsNote(set.attitude ?? t.attitude) &&
      (!onlyEmpty || !(t.attitudeNote ?? "").trim())
    )
      set.attitudeNote = patch.attitudeNote;
    if (p.homework !== undefined && (!onlyEmpty || !t.homework)) set.homework = p.homework;
    // 숙제 미제출 사유 — 결과 숙제가 미제출·0%인 행만(태도 의견과 같은 규칙). '빈 칸만'은 사유가 빈 행에만.
    if (
      patch.homeworkMissReason?.trim() &&
      t.attitudeNoteOk &&
      isHomeworkMissed(set.homework ?? t.homework) &&
      (!onlyEmpty || !(t.homeworkMissReason ?? "").trim())
    )
      set.homeworkMissReason = patch.homeworkMissReason;
    if (p.textbook !== undefined && (!onlyEmpty || !t.textbook.trim())) set.textbook = p.textbook;
    if (p.homeworkToday !== undefined && (!onlyEmpty || !t.homeworkToday.trim())) set.homeworkToday = p.homeworkToday;
    if (
      p.today !== undefined &&
      progressSubjectKey !== undefined &&
      t.subjectKey === progressSubjectKey &&
      (!onlyEmpty || !t.today.trim())
    )
      set.today = p.today;
    // 수업 성격 — 진도와 같은 규칙(고른 과목 행에만 · '빈 칸만'은 성격을 안 고른 행에만).
    const pm = asProgressMode(patch.progressMode);
    if (pm && progressSubjectKey !== undefined && t.subjectKey === progressSubjectKey && (!onlyEmpty || !asProgressMode(t.progressMode)))
      set.progressMode = pm;
    // 이해도 단계 — 새 수학 보고서 행에만(과목 고르기와 무관: 이해도는 수학에만 있다). '빈 칸만'은 직접 매긴 점수가 없는 행에만.
    if (patch.understanding !== undefined && t.understandingOk && (!onlyEmpty || !t.understandingStored)) {
      const u = Math.round(patch.understanding);
      if (Number.isFinite(u) && u >= 0 && u <= 10) set.understanding = u;
    }
    // 이해도에서 뺄 소단원(원장 2026-10-27 *"몇개 선택 빼기"*) — 그 행 오늘 진도(이번에 바꾸면 그 값)에 있는 소단원만.
    // 빼기는 점수를 덮지 않아 '빈 칸만'과 무관하다(되살리기는 카드·표 행의 소단원별 창에서).
    if (patch.understandingOff?.length && t.understandingOk) {
      const lessons = pilotLessons(set.today ?? t.today);
      const off = patch.understandingOff.filter((l) => lessons.includes(l));
      if (off.length) set.understandingOff = off;
    }
    if (p.note !== undefined && (!onlyEmpty || !(t.note ?? "").trim())) set.note = p.note;
    // 테스트 — '빈 칸만'은 **점수가 빈 행**에만(문항수는 늘 값이 있어 빈 칸 판정이 없다 — 점수가 찬 행의 문항수를 바꾸면 그 점수가 깎인다).
    // 점수는 그 행의 문항수(이번에 바꾸면 그 값)를 넘지 않게 맞춘다 — 화면 점수 칸과 같은 규칙.
    // 일일 테스트 '안 봄'(원장 2026-10-27) — 새 수학 보고서 행에만. 사유를 골라 둔 행은 '빈 칸만'에서 찬 칸이다(점수가 비어 있어도).
    const skipOk = !!t.attitudeNoteOk;
    const skipNow = skipOk && !!t.dailyTestSkip;
    const bulkSkip = skipOk && patch.dailyTestSkip && testSkipComplete(patch.dailyTestSkip) ? patch.dailyTestSkip : null;
    // '안 봄'을 넣는 일괄에선 그 행에 일일 점수를 넣지 않는다(한 칸의 두 답이다).
    if (bulkSkip && (!onlyEmpty || (t.dailyScore == null && !skipNow)))
      set.dailyTestSkip = { reason: bulkSkip.reason, detail: bulkSkip.detail };
    for (const which of ["daily", "check"] as const) {
      if (which === "daily" && bulkSkip) continue;
      const score = p[`${which}Score`];
      const max = p[`${which}Max`];
      if ((score === undefined && max === undefined) || (onlyEmpty && (t[`${which}Score`] != null || (which === "daily" && skipNow)))) continue;
      if (max !== undefined) set[`${which}Max`] = max;
      const cap = max ?? t[`${which}Max`];
      if (score !== undefined) {
        set[`${which}Score`] = cap != null ? Math.min(score, cap) : score;
        // 점수를 넣는 행이 '안 봄'이었으면 '봄'으로 — 안 그러면 넣은 점수가 보고서에서 안 읽힌다(row-fields.ts).
        if (which === "daily" && skipNow) set.dailyTestSkip = null;
      }
    }
    // 영상 과제 — 토글이 있는 행에만. '빈 칸만'은 고른 적 없는 행(undefined)에만.
    if (patch.videoHomework !== undefined && t.videoOk && (!onlyEmpty || t.videoHomework === undefined))
      set.videoHomework = patch.videoHomework;
    const homeworkAfter = set.videoHomework ?? t.videoHomework;
    // 링크 넣기 — 영상 과제가 켜져 있는(이번에 켜는 것 포함) 행에만 켠다. 과제를 끄는 행은 링크도 끈다(토글과 같은 규칙).
    if (patch.videoSubmitLink === true && t.linkOk && homeworkAfter === true && (!onlyEmpty || t.videoSubmitLink === undefined))
      set.videoSubmitLink = true;
    else if (patch.videoSubmitLink === false && t.linkOk && (!onlyEmpty || t.videoSubmitLink === undefined))
      set.videoSubmitLink = false;
    if (set.videoHomework === false && t.videoSubmitLink) set.videoSubmitLink = false;
    // 마감 — 영상 과제가 켜진(이번에 켜는 것 포함) 행에만. '빈 칸만'은 고른 적 없는 행에만(고른 적 없으면 7일이다).
    if (patch.videoHomeworkDue !== undefined && t.dueOk && homeworkAfter === true && (!onlyEmpty || t.videoHomeworkDue === undefined)
      && t.videoHomeworkDue !== patch.videoHomeworkDue)
      set.videoHomeworkDue = patch.videoHomeworkDue;
    if (Object.keys(set).length)
      out.push({ studentId: t.studentId, subjectName: t.subjectName, subjectIndex: t.subjectIndex, set });
  }
  return out;
}

// ───────────────────────── 이전 회차 가져오기 (1-3) ─────────────────────────

/** 이전 회차 가져오기 대상 행의 현재값. */
export type PrevFillCurrent = {
  today: string;
  attitude: string | null;
  homework: string;
  homeworkToday: string;
};

/** 이전 회차에서 채울 필드(빈 칸만). */
export type PrevFill = {
  today?: string;
  attitude?: string;
  homework?: string;
  homeworkToday?: string;
};

/**
 * 이전 회차 → 오늘 행 "빈 칸만" 채움 계획.
 * ⚠️ 특이사항은 제외 — prevReport.note(lesson_reports.notes)는 **학부모 발송 본문**이라 특이사항이 아니다(오염 방지).
 * ⚠️ 교재는 제외 — roster가 이미 직전 교재를 자동 승계한다.
 * 태도는 현 학원 선택지에 있는 값만(옛 선택지 잔존값은 스킵).
 * 과제는 **퍼센트 전환(2026-08-03) 이전 값도 뜻이 분명하면 옮긴다** — 완료→100%·미제출→0%.
 * 🔴 단 '일부 미흡'은 정도를 모르므로 **안 채운다**(임의로 50%를 찍지 않는다 — 그게 이번 사고였다).
 */
export function planPrevFill(args: {
  prev: PrevReport | undefined;
  current: PrevFillCurrent;
  attitudes: readonly string[];
}): PrevFill {
  const { prev, current, attitudes } = args;
  const out: PrevFill = {};
  if (!prev) return out;
  if (!current.today.trim() && prev.progress?.trim()) out.today = prev.progress;
  if (!current.attitude && prev.attitude && attitudes.includes(prev.attitude)) out.attitude = prev.attitude;
  if (!current.homework && prev.homeworkScore) {
    const choice = toHomeworkRateChoice(prev.homeworkScore);
    if (choice) out.homework = choice;
  }
  if (!current.homeworkToday.trim() && prev.homeworkToday?.trim()) out.homeworkToday = prev.homeworkToday;
  return out;
}

/** 멘트 일괄 채우기 대상 행 — 직전 회차 멘트(lesson_reports.notes)와 오늘 초안. */
export type PrevCommentRow = {
  studentId: string;
  subjectName: string;
  prevNote: string | null | undefined; // prevReport.note = 직전에 학부모에게 보낸 멘트 본문
  currentDraft: string;
};

/** 멘트 일괄 채우기 계획 1건. */
export type PrevCommentPlan = { studentId: string; subjectName: string; comment: string };

/**
 * 직전 회차 **멘트** 일괄 채우기 계획 — 초안이 비어 있고 직전 멘트가 있는 행만.
 *
 * ⚠️ 멘트는 planPrevFill(진도·태도·과제)과 **분리**한다 — 이건 학부모에게 이미 나간 문장을 그대로 옮기는 것이라
 * 오늘 진도·점수와 어긋날 수 있다. 그래서 호출부가 별도 확인(ConfirmDialog)을 받은 뒤에만 적용한다.
 * ⚠️ 채워진 초안은 절대 덮지 않는다(빈 칸만 = 이 버튼의 계약).
 */
export function planPrevComments(rows: readonly PrevCommentRow[]): PrevCommentPlan[] {
  const out: PrevCommentPlan[] = [];
  for (const r of rows) {
    if (r.currentDraft.trim()) continue;
    const note = r.prevNote?.trim();
    if (!note) continue;
    out.push({ studentId: r.studentId, subjectName: r.subjectName, comment: note });
  }
  return out;
}

/** 일괄 채우기 대상 행 — planPrevFill 인자 + 학생/과목 식별자. */
export type PrevFillRow = {
  studentId: string;
  subjectName: string;
  subjectIndex: number;
  prev: PrevReport | undefined;
  current: PrevFillCurrent;
  /** 입력이 잠긴 행(발송 완료·결석) — 채우지 않는다(위 BulkTarget.locked와 같은 이유). */
  locked?: boolean;
};

/** 일괄 채우기 계획 1건 — 그 행에 실제로 적용할 필드만 담긴다(빈 fill 행은 결과에서 제외). */
export type PrevFillPlan = { studentId: string; subjectName: string; subjectIndex: number; set: PrevFill };

/** 선택된 각 수업의 이전값으로 그 수업의 빈 칸만 채운다. */
export function planBulkPrevFill(rows: readonly PrevFillRow[], attitudes: readonly string[]): PrevFillPlan[] {
  const out: PrevFillPlan[] = [];
  for (const r of rows) {
    if (r.locked) continue;
    const set = planPrevFill({ prev: r.prev, current: r.current, attitudes });
    if (Object.keys(set).length) {
      out.push({ studentId: r.studentId, subjectName: r.subjectName, subjectIndex: r.subjectIndex, set });
    }
  }
  return out;
}

// ───────────────────────── 첫 행 내용 아래로 복사 (2026-07-23) ─────────────────────────

/**
 * 같은 수업을 들은 반은 **진도·교재·오늘 과제가 대체로 같다**. 그런데 표에서는 학생마다 진도 피커를
 * 다시 열어 고르고 있었다(원장 2026-07-23: "같은 진도일 때 일일이 진도선택 등 고르지 않도록").
 * → 맨 위 행에 한 번 입력하고 **아래 행 전부에 복사**한다.
 *
 * ⚠️ **복사하는 것은 '수업'이지 '학생'이 아니다.** 진도·교재·오늘 과제만 옮기고
 *    테스트 점수·태도·과제 수행·학부모 문구는 손대지 않는다 — 그건 학생마다 다른 **개별 사실**이라
 *    한 명의 값을 반 전체에 붙이면 기록이 거짓이 된다(태도·과제를 일부러 통일하려면 '값 일괄 입력'으로
 *    강사가 값을 **직접 골라** 넣는다).
 * ⚠️ **다른 과목 행에는 복사하지 않는다** — 수학 진도가 영어 행에 들어가면 학부모에게 그대로 나간다.
 * ⚠️ **발송 완료 행은 제외** — 발송분 수정 금지(원장 2026-07-22)와 같은 규칙.
 */
export type CopyRowValues = {
  subjectKey: string; // 과목 일치 판정 키(미지정은 "math"로 간주 — isMathSubject와 동일 규칙)
  /**
   * 이 행의 반(`rowClassName` — 보강 행은 앵커 반) — 같은 반 행에만 복사한다(원장 2026-10-15). 반을 고른 보기에선 부르는 쪽이
   * 모르는 행을 그 반으로 채워 넘긴다(보이는 행이 전부 그 반이라 종전과 같다). 안 주면 모름.
   */
  classKey?: string | null;
  today: string;
  /** 오늘 수업 성격(복습·문제풀이) — 진도와 **함께** 옮긴다(원장 2026-10-27: 진도만 오고 성격이 안 오면 진도 문장이 달라진다). */
  progressMode?: string | null;
  textbook: string;
  homeworkToday: string;
};

export type CopyRowTarget = CopyRowValues & {
  studentId: string;
  subjectName: string;
  subjectIndex: number;
  actionable: boolean; // isCopyTargetRow(subject, live상태) — **발송 완료면만** false(진도 유무와 무관)
};

export type CopyRowPlan = {
  studentId: string;
  subjectName: string;
  subjectIndex: number;
  set: { today?: string; progressMode?: string; textbook?: string; homeworkToday?: string };
};

export type CopyRowResult = {
  plan: CopyRowPlan[];
  skippedSent: number; // 발송 완료라 건너뜀
  skippedSubject: number; // 과목이 달라 건너뜀
  skippedClass: number; // 반이 달라 건너뜀(맨 위 행의 반을 모르면 반을 아는 행도 여기)
  skippedNoClass: number; // 이 행의 반을 몰라 건너뜀('전체' 보기에서만 생긴다)
  skippedFilled: number; // 이미 값이 있어 건너뜀(덮어쓰기 끔)
};

/** 원본 행에서 실제로 복사할 값만 추린다(빈 값은 복사하지 않음 — 지우기가 아니다). */
export function copyableFields(source: CopyRowValues): { today?: string; progressMode?: string; textbook?: string; homeworkToday?: string } {
  const out: { today?: string; progressMode?: string; textbook?: string; homeworkToday?: string } = {};
  if (source.today.trim()) out.today = source.today;
  // 성격은 진도가 있을 때만 — 진도 없는 성격은 아무 문장도 바꾸지 않는다.
  const mode = asProgressMode(source.progressMode);
  if (mode && source.today.trim()) out.progressMode = mode;
  if (source.textbook.trim()) out.textbook = source.textbook;
  if (source.homeworkToday.trim()) out.homeworkToday = source.homeworkToday;
  return out;
}

export function planCopyFirstRow(
  source: CopyRowValues,
  targets: readonly CopyRowTarget[],
  opts: { overwrite: boolean },
): CopyRowResult {
  const fields = copyableFields(source);
  const srcKey = source.subjectKey || "math";
  const res: CopyRowResult = { plan: [], skippedSent: 0, skippedSubject: 0, skippedClass: 0, skippedNoClass: 0, skippedFilled: 0 };
  const srcClass = source.classKey ?? null;
  if (Object.keys(fields).length === 0) return res;

  for (const t of targets) {
    if (!t.actionable) {
      res.skippedSent++;
      continue;
    }
    if ((t.subjectKey || "math") !== srcKey) {
      res.skippedSubject++;
      continue;
    }
    // 🔴 반도 같아야 한다(원장 2026-10-15) — 원스크린은 처음 열면 그날 모든 반을 한 표에 보여 줘서, 행을 안 고르고 누르면
    //    다른 반(학년도 다른)의 빈 칸까지 맨 위 행의 진도·오늘 과제로 채웠다(10/15 PS3A ← MS1A · 9/21엔 MS2A 2명이 그대로 발송).
    //    같은 내용을 여러 반에 넣고 싶으면 '직접 입력' 일괄을 쓴다(그쪽은 반 이름을 밝히고 확인받는다).
    //    반을 모르는 쪽이 있으면 넣지 않는다 — 맨 위 행 반을 몰라도(보강 행이 위로 온 이름순 등) 같은 사고가 난다.
    //    단 둘 다 모르면(반 정보가 아예 없는 표) 종전대로 과목만 본다.
    const tClass = t.classKey ?? null;
    if (srcClass !== null && tClass === null) {
      res.skippedNoClass++;
      continue;
    }
    if (tClass !== srcClass) {
      res.skippedClass++;
      continue;
    }
    const set: CopyRowPlan["set"] = {};
    if (fields.today !== undefined && (opts.overwrite || !t.today.trim())) set.today = fields.today;
    // 성격 — 진도와 같은 칸 규칙('빈 칸만'은 성격을 안 고른 행에만).
    if (fields.progressMode !== undefined && (opts.overwrite || !asProgressMode(t.progressMode))) set.progressMode = fields.progressMode;
    if (fields.textbook !== undefined && (opts.overwrite || !t.textbook.trim())) set.textbook = fields.textbook;
    if (fields.homeworkToday !== undefined && (opts.overwrite || !t.homeworkToday.trim()))
      set.homeworkToday = fields.homeworkToday;
    if (Object.keys(set).length === 0) {
      res.skippedFilled++;
      continue;
    }
    res.plan.push({ studentId: t.studentId, subjectName: t.subjectName, subjectIndex: t.subjectIndex, set });
  }
  return res;
}
