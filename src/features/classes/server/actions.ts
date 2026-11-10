"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { accessLevelTenant, canManageTenant } from "@/lib/auth/perm-matrix";
import { kstToday } from "@/lib/date-kst";
import { PERIOD_NO_SLOT_ERROR } from "@/features/classes/period-notice";
import { isHexColor, readableTextColor } from "@/lib/color-utils";
import { isAssignableTeacherRole } from "@/lib/permissions";
import { parseSeatValue } from "@/features/timetable/lib/teacher-label";
import { logAction } from "@/features/audit/server/log";
import { normalizeClassName, reservedClassNameReason } from "@/features/classes/class-name";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { notifyUsers } from "@/features/notifications/server/notify";
import { createAdminClient } from "@/lib/supabase/admin";
import { delegationRangeLabel, validateDelegationRange } from "../delegation-window";
import { getClassroomAssignmentData } from "./queries";
// 🔴 반 쓰기 게이트는 **공용 함수 하나**를 지난다(강사=담임 반만) — class-scope.ts 헤더 주석 참조.
import { requireClassWrite } from "./class-scope";
import { CLASS_NOT_MINE_DELEGATE_ERROR, canWriteClassRecord } from "../class-write-scope";
import { moveLiveSlotTeacher } from "./handover";
import { detectOverlaps } from "./overlap-detect";
import {
  ARCHIVE_REASON,
  reopenClassEnrollments,
} from "./enrollment-lifecycle";
import { deleteCurrentSlots, loadCurrentSlots } from "./schedule-sync";
import { isMissingColumnError } from "./lab-separate";
import type { ClassroomAssignData } from "../lib/classroom-assign";
import { DAY_LABEL_KO, type OverlapItem } from "../overlap";
import {
  labSeparateChanges,
  periodPairKey,
  planSlotArchives,
  preserveScheduleFields,
  type PeriodPairs,
} from "../schedule-preserve";
import {
  settingsToPeriodsConfig,
  subjectWeekdayPeriods,
  subjectWeekendPeriods,
} from "@/features/timetable/lib/periods";
import { normalizeEnglishTrack } from "../english-track";
import { readFreeClosedNameRequest, type ClassNameConflict } from "../class-name-conflict";
import { freedLeftNotice, rollbackFreedClassName, writeWithClassNameGuard } from "./class-name-guard";
import { ClassTermError, endClassWithName, reopenClassWithSchedules } from "./class-term-store";
import { explainDbError, logDbError } from "@/lib/supabase/db-error";
import { classFlagChanges } from "../class-flag-changes";

export type ClassFormState =
  | {
      error?: string;
      fieldErrors?: Record<string, string>;
      /**
       * 🔴 겹침 **경고**(차단 아님, 원장 확정 2026-07-22). 저장은 이미 끝난 상태로 온다.
       * 화면은 이 목록으로 "몇 개 반이 · 어떤 반과 · 언제 · 무엇이" 겹치는지 상세히 알린다
       * (`overlapSummary`/`overlapItemLabel` 사용). 비었으면 겹침 없음.
       */
      overlaps?: OverlapItem[];
      /**
       * @deprecated 폐기 — **서버는 이 값을 더 이상 채우지 않는다**(겹침이 저장을 막지 않으므로).
       * 구 폼(`class-form.tsx`)의 "겹침 무시하고 저장" 분기를 컴파일만 살려두려고 남긴 자리다.
       * UI는 `overlaps`로 옮기고 이 필드와 `ignoreTeacherConflict` 우회 버튼을 지울 것.
       */
      teacherConflict?: string;
      /**
       * 반 이름이 같은 과목의 다른 반과 겹쳐 저장하지 않았다(원장 2026-10-01). 문구는 `fieldErrors.className`에도 같이 온다.
       * `freeTo`가 있으면(겹친 반이 종강·폐지) 화면이 "그 반 이름을 바꾸고 저장" 버튼을 준다 — class-name-conflict.ts.
       */
      nameConflict?: ClassNameConflict;
      ok?: true;
      redirectTo?: string;
      nonce?: number;
    }
  | undefined;

type ScheduleInput = {
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  // 교시별 오버라이드 — null이면 반 담임/기본 강의실 상속.
  teacherId: string | null;
  classroomId: string | null;
  /** 자유 시각 입력 행(교시표 밖 = 오전 특강·불규칙 시각)인가. 교시 클릭그리드 셀이면 false. */
  explicitTime?: boolean;
  /**
   * 담당 칸에서 **자리(LAB·JJ)** 를 골랐으면 그 이름. 자리는 계정이 없어 `teacherId`에 못 담는다 →
   * `teacher_id = null` + `slot_teacher_label = <자리>`로 저장한다(teacher-label.ts 규칙).
   */
  seatLabel?: string | null;
  /** LAB '따로 수업(*LAB)' 표식(0271a) — 폼이 `*_labsep_i`를 보냈을 때만 값이 있다(없으면 기존 행 승계). */
  labSeparate?: boolean;
};

/** DB 오류를 화면 문구로 — 영문 원문(PostgREST 메시지)을 그대로 내보내지 않는다(UI raw 노출 금지). */
const SAVE_FAILED = "저장에 실패했습니다. 잠시 후 다시 시도해주세요.";

/** 반 이름 충돌 → 반 이름 칸의 오류 + (종강·폐지 반이면) 버튼 정보. ⚠️ export 금지 — "use server" 파일은 async만([[#119]]). */
function nameConflictState(conflict: ClassNameConflict): ClassFormState {
  return { fieldErrors: { className: conflict.message }, nameConflict: conflict };
}

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
// 레거시 기본 과목 — owner 설정의 과목 key와 합쳐 허용 집합을 만든다(설정에 추가한 과목도 저장 허용).
const LEGACY_SUBJECTS = ["math", "english", "korean", "science", "arts", "etc"] as const;

/** 저장 허용 과목 key 집합 = owner 설정 과목 ∪ 레거시 기본. (설정에 추가한 과목도 반에 저장 가능.) */
async function allowedSubjectSet(): Promise<ReadonlySet<string>> {
  const settings = await getTenantSettings();
  return new Set<string>([
    ...LEGACY_SUBJECTS,
    ...settings.operations.subjects.map((s) => s.key),
  ]);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (v: string) => (ISO_DATE.test(v) ? v : null);

function readForm(formData: FormData, allowedSubjects: ReadonlySet<string>) {
  const get = (k: string) => String(formData.get(k) ?? "").trim();
  const subject = get("subject") || "math";
  const bgRaw = get("bgColor");
  // 반 헤더색(시간표 통합뷰 소비) — 유효 hex만, 없으면 null=과목색 폴백. 글자색은 휘도로 자동.
  const bgColor = isHexColor(bgRaw) ? bgRaw : null;
  // 특강 토글 — 폼은 hidden value="0" 뒤에 체크박스 value="1"을 둔다(체크 해제 시 필드가 통째로
  // 사라지는 HTML 기본 동작 때문). 키가 아예 없으면 '이 폼은 특강 필드를 모른다'로 보고 수정 시 건드리지 않는다.
  const specialValues = formData.getAll("isSpecial").map((v) => String(v));
  // '수업보고서 미발송'(0174a) — 특강 토글과 **똑같은 hidden+체크박스 쌍 계약**(위 주석 참조).
  const optoutValues = formData.getAll("reportOptout").map((v) => String(v));
  // 영어 프로그램 구분(0176a) — 라디오라 hidden 마커가 필요 없다(체크된 하나만 온다). 다만 **키가 없으면**
  // '이 폼은 이 칸을 모른다'로 보고 수정 시 건드리지 않는다(옛 폼·다른 진입점이 값을 지우지 않게).
  const trackProvided = formData.has("englishTrack");
  const englishTrack = normalizeEnglishTrack(
    allowedSubjects.has(subject) ? subject : "etc",
    formData.get("englishTrack"),
  );
  // 운영 기간(특강은 방학 한정 → 끝나면 시간표에서 자동으로 내려간다). periodProvided=1이면
  // 종료일을 **비운 것도 명시**(무기한으로 되돌리기)로 해석한다 — schedule-preserve.ts 참조.
  return {
    // 공백 정리(연속 공백 한 칸) — ClassNote 반 보드 이름과 글자까지 같아야 한다(class-name.ts).
    className: normalizeClassName(get("className")),
    // 허용 집합(설정 과목 ∪ 레거시)에 없는 값만 'etc'로 강등(쓰레기 입력 가드).
    subject: allowedSubjects.has(subject) ? subject : "etc",
    teacherId: get("teacherId") || null,
    classroomId: get("classroomId") || null,
    notes: get("notes") || null,
    bgColor,
    textColor: bgColor ? readableTextColor(bgColor) || null : null,
    isSpecialProvided: specialValues.length > 0,
    isSpecial: specialValues.some((v) => v === "1" || v === "on" || v === "true"),
    reportOptoutProvided: optoutValues.length > 0,
    reportOptout: optoutValues.some((v) => v === "1" || v === "on" || v === "true"),
    trackProvided,
    englishTrack,
    periodProvided: get("periodProvided") === "1",
    // 교시마다 종료일이 갈려 폼이 칸을 비운 경우 — 빈 칸을 "무기한으로 되돌리기"가 아니라
    // "안 정함(교시별 기존값 유지)"으로 읽는다(조용한 일괄 삭제 방지).
    periodKeepValidTo: get("periodKeepValidTo") === "1",
    validFrom: asDate(get("validFrom")),
    validTo: asDate(get("validTo")),
    schedules: parseSchedules(formData),
  };
}

/** 한 네임스페이스(`schedule_` 또는 `custom_`)의 인덱스 hidden을 슬롯 배열로. */
function readSlotNamespace(
  formData: FormData,
  prefix: string,
  limit: number,
  explicitTime: boolean,
): ScheduleInput[] {
  const result: ScheduleInput[] = [];
  for (let i = 0; i < limit; i++) {
    const dayOfWeek = String(formData.get(`${prefix}day_${i}`) ?? "").trim();
    const startTime = String(formData.get(`${prefix}start_${i}`) ?? "").trim().slice(0, 5);
    const endTime = String(formData.get(`${prefix}end_${i}`) ?? "").trim().slice(0, 5);
    if (!dayOfWeek || !startTime || !endTime) continue;
    if (!DAYS.includes(dayOfWeek as (typeof DAYS)[number])) continue;
    // 담당 칸은 uuid | "" | "seat:LAB"|"seat:JJ" 셋 중 하나 — 자리는 계정이 없어 uuid로 못 담는다.
    const rawTeacher = String(formData.get(`${prefix}teacher_${i}`) ?? "").trim();
    const seatLabel = parseSeatValue(rawTeacher);
    const teacherId = seatLabel ? null : rawTeacher || null;
    const classroomId = String(formData.get(`${prefix}classroom_${i}`) ?? "").trim() || null;
    // '따로 수업(*LAB)' 표식 — **보냈을 때만** 읽는다(옛 탭·자유 시각 행은 안 보낸다 = 기존 값 승계).
    const rawLabSep = formData.get(`${prefix}labsep_${i}`);
    const labSeparate = rawLabSep === null ? undefined : String(rawLabSep) === "1";
    result.push({
      dayOfWeek,
      startTime,
      endTime,
      teacherId,
      classroomId,
      explicitTime,
      seatLabel,
      ...(labSeparate === undefined ? {} : { labSeparate }),
    });
  }
  return result;
}

/**
 * 폼이 보낸 스케줄 = **교시 클릭그리드 + 자유 시각 행** 두 네임스페이스의 합.
 *  · `schedule_*` = 클릭그리드 셀(교시표 파생 시각). 요일×교시라 슬롯이 많을 수 있어 상한 80.
 *  · `custom_*`   = 자유 시각 행. **교시표에 없는 시각**(방학 오전 특강 09~14시 / 불규칙 배치)의
 *    유일한 입력·보존 경로다. 인덱스 공간이 겹치지 않게 이름을 분리했다(그리드 선택 수에 따라
 *    번호가 밀리면 두 컴포넌트가 서로의 hidden을 덮어쓴다).
 * ⚠️ 상한은 **폼이 만들 수 있는 최대보다 넉넉하게**(둘 다 80). 상한을 넘긴 행은 조용히 사라지므로
 *    UI 쪽 추가 상한(자유 시각 행 40개)보다 낮게 잡지 말 것.
 */
function parseSchedules(formData: FormData): ScheduleInput[] {
  return [
    ...readSlotNamespace(formData, "schedule_", 80, false),
    ...readSlotNamespace(formData, "custom_", 80, true),
  ];
}

function validate(input: ReturnType<typeof readForm>): Record<string, string> | null {
  const errors: Record<string, string> = {};
  if (!input.className) errors.className = "반 이름은 필수입니다";
  else {
    const reserved = reservedClassNameReason(input.className);
    if (reserved) errors.className = reserved;
  }
  if (!input.subject) errors.subject = "과목을 선택해주세요";
  for (const s of input.schedules) {
    if (s.startTime >= s.endTime) {
      errors.schedules = "시작 시간이 종료 시간보다 빠르야 합니다";
      break;
    }
  }
  // 운영 기간은 뒤집힐 수 없다(종료일 < 시작일이면 그 스케줄은 하루도 안 열린다 = 조용히 사라짐).
  if (input.validFrom && input.validTo && input.validTo < input.validFrom) {
    errors.validTo = "종료일이 시작일보다 빠릅니다";
  }
  // 🔴 운영 기간은 **교시 행에** 저장된다(class_schedules.valid_from/valid_to) — 폼이 교시를 하나도
  //    안 실어 보내면 날짜를 적을 자리가 없어 저장이 **아무 일도 안 한다**. 지금까지 그게 조용해서
  //    "저장이 안 되는데 왜인지 알 수 없다"였다(원장 제보 2026-08-27). 이유를 말하고 거절한다.
  //    ⚠️ 여기(쓰기 전)에서 막는 게 중요하다 — 아래 updateClass는 이미 delete를 끝낸 뒤라 늦게 돌아가면
  //    그 반의 교시가 통째로 사라진다.
  if (input.periodProvided && (input.validFrom || input.validTo) && input.schedules.length === 0) {
    errors.period = PERIOD_NO_SLOT_ERROR;
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

export async function createClass(
  _prev: ClassFormState,
  formData: FormData,
): Promise<ClassFormState> {
  // 새 반 생성 = 관리자만(위 requireClassManage 주석). 수정(updateClass)은 담당 반 개념이 성립해 write 유지.
  const { user, error: gateError } = await requireClassManage();
  if (gateError || !user) return { error: gateError };

  const allowed = await allowedSubjectSet();
  const input = readForm(formData, allowed);
  const fieldErrors = validate(input);
  if (fieldErrors) return { fieldErrors };

  const supabase = await createClient();

  // 🔴 겹침은 **저장을 막지 않는다**(원장 확정 2026-07-22) — 정규·특강 모두. 합반이 실제 운영이라
  // 겹침은 사고가 아니라 정상 업무다. 상세 경고만 결과에 실어 화면이 알린다.
  const overlaps = await collectOverlaps(supabase, input);

  // 🔴 반 이름이 같은 과목의 다른 반(종강·폐지 반 포함 — 유니크 인덱스에 is_active 조건이 없다, [[#120]])과 겹치면
  //    저장하지 않고 그 반의 상태를 알린다. 종강·폐지 반 이름을 비우는 건 화면 버튼을 누른 요청뿐(class-name-guard.ts).
  const nameTarget = { tenantId: user.tenantId, subject: input.subject, name: input.className };
  const guarded = await writeWithClassNameGuard({
    db: supabase,
    target: nameTarget,
    today: kstToday(),
    request: readFreeClosedNameRequest(formData),
    // 새 반 만들기 자체가 관리자 전용(requireClassManage)이라 비울 권한도 이미 있다.
    canFree: async () => true,
    write: async () => {
      const { data, error } = await supabase
        .from("classes")
        .insert({
          tenant_id: user.tenantId,
          class_name: input.className,
          subject: input.subject,
          teacher_id: input.teacherId,
          classroom_id: input.classroomId,
          // 새 반은 **항상 활성**. 끄는 것은 반 상세의 '반 폐지'뿐이다(2026-07-21) — 폐지만이 그 반 활성
          // 수강까지 함께 종료해 학생목록·학생상세와 어긋나지 않는다. 폼에서 끄는 문은 폐지했다.
          is_active: true,
          is_special: input.isSpecial,
          report_optout: input.reportOptout,
          // 영어 프로그램 구분(0176a) — 영어가 아니면 normalizeEnglishTrack이 이미 null로 만든다.
          english_track: input.englishTrack,
          notes: input.notes,
          bg_color: input.bgColor,
          text_color: input.textColor,
        })
        .select("id")
        .single();
      return { data: data as { id: string } | null, error };
    },
    savedClassId: (d) => d?.id ?? null,
    failMessage: SAVE_FAILED,
  });
  if (!guarded.ok) return "conflict" in guarded ? nameConflictState(guarded.conflict) : { error: guarded.error };

  // ⚠️ 원문(PostgREST 영문)을 화면에 내보내지 않는다. 배포 순서가 어긋나 0133a(`is_special`)가 아직
  // 안 올라갔을 때도 여기로 떨어진다 — 마이그레이션은 **코드보다 먼저** 적용할 것(0133a 헤더 참조).
  const data = guarded.data;
  if (!data) return { error: SAVE_FAILED };

  if (input.schedules.length > 0) {
    // valid_from은 NOT NULL(기본값 없음) — 반드시 채워야 insert 성공(없으면 전 스케줄 저장이 조용히 실패).
    // 운영 기간을 입력했으면 그 값으로(특강은 종료일이 지나면 시간표가 알아서 내린다 — timetable
    // fetchSlots가 valid_from/valid_to를 이미 본다). 비우면 오늘~무기한(기존 동작).
    const validFrom = input.validFrom ?? kstToday();
    const rows = input.schedules.map((s) => ({
      tenant_id: user.tenantId,
      class_id: data.id,
      day_of_week: s.dayOfWeek,
      start_time: s.startTime,
      end_time: s.endTime,
      valid_from: validFrom,
      valid_to: input.validTo,
      teacher_id: s.teacherId,
      classroom_id: s.classroomId,
    }));
    const { error: schedErr } = await supabase.from("class_schedules").insert(rows);
    if (schedErr) {
      // 반은 생성됐지만 스케줄 실패 - 반 삭제 후 에러 반환
      const { error: delErr } = await supabase.from("classes").delete().eq("id", data.id);
      // ⚠️ 삭제도 실패하면 반은 **남아 있다**(그 이름도 쥔 채) — "다시 시도"라고 하면 다음 생성이 그 반과 겹친다.
      if (delErr) {
        return { error: "수업 시간 저장에 실패했습니다. 반은 만들어졌지만 수업 시간이 비어 있습니다 — 반 목록에서 그 반을 열어 수업 시간을 다시 저장해주세요." };
      }
      // 이 반을 위해 종강·폐지 반 이름을 비웠다면 되돌린다(반이 사라졌으니 비울 이유도 사라졌다).
      const freed = guarded.freed;
      const kept = freed ? !(await rollbackFreedClassName(supabase, nameTarget, freed)) : false;
      return {
        error: `스케줄 저장에 실패했습니다. 잠시 후 다시 시도해주세요.${kept && freed ? freedLeftNotice(freed.to) : ""}`,
      };
    }
  }

  // 반과 수업 시간이 모두 저장된 뒤에만 남긴다(수업 시간 실패로 반을 지운 경우는 위에서 돌아갔다).
  // 종강·폐지 반 이름을 비운 일은 class-name-guard가 따로 남긴다.
  await logAction({
    action: "class_create",
    targetType: "class",
    targetLabel: input.className,
    metadata: {
      classId: data.id,
      subject: input.subject,
      teacherId: input.teacherId,
      isSpecial: input.isSpecial,
      // '수업보고서 미발송'(0174a)으로 만든 반인지 — 없으면 처음부터 미발송이었는지 되짚을 근거가 없다(2026-11-04 사고).
      reportOptout: input.reportOptout,
      schedules: input.schedules.length,
      ...(input.validFrom || input.validTo ? { validFrom: input.validFrom ?? null, validTo: input.validTo ?? null } : {}),
    },
  });

  revalidatePath("/classes");
  revalidatePath("/timetable");
  // redirect 대신 결과 반환 — 클라가 성공 확정(nonce) 후 초안 삭제·동시편집 신호·이동(B-2).
  // (redirect()면 NEXT_REDIRECT throw로 폼의 nonce 효과가 안 돌아 'class:new' 초안이 안 비워진다.)
  return { ok: true, redirectTo: `/classes/${data.id}`, nonce: Date.now(), overlaps };
}

/**
 * 학원설정 → 교시표의 (시작,종료) 짝 집합. 과목별 평일 교시(`subjects[].weekdayPeriods`)를 쓰므로
 * **과목 목록을 받아 합집합**으로 만든다(저장 중 과목이 바뀔 수 있다). 주말은 과목 무관 단일 표.
 * 쓰임새는 `formEndTimeWins` 하나뿐 — "이 시각 조합이 진짜 교시인가"만 답한다.
 */
function buildPeriodPairs(
  settings: Awaited<ReturnType<typeof getTenantSettings>>,
  subjects: (string | null | undefined)[],
): PeriodPairs {
  const config = settingsToPeriodsConfig(settings.operations);
  const weekday = new Set<string>();
  for (const subject of new Set(subjects.filter((v): v is string => !!v))) {
    for (const p of subjectWeekdayPeriods(subject, config)) {
      weekday.add(periodPairKey(p.startTime, p.endTime));
    }
  }
  const weekend = new Set(
    subjectWeekendPeriods(config).map((p) => periodPairKey(p.startTime, p.endTime)),
  );
  return { weekday, weekend };
}

export async function updateClass(
  _prev: ClassFormState,
  formData: FormData,
): Promise<ClassFormState> {
  // 🔴 게이트보다 **반 id를 먼저** 읽는다 — 강사(scoped)는 자기 담임 반만 고칠 수 있어서
  //    "누구인가"만으로는 판정이 끝나지 않는다(class-write-scope.ts).
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "반 ID가 누락되었습니다" };

  const { user, error: gateError } = await requireClassWrite(id);
  if (gateError || !user) return { error: gateError };

  const allowed = await allowedSubjectSet();
  const input = readForm(formData, allowed);
  const fieldErrors = validate(input);
  if (fieldErrors) return { fieldErrors };

  const supabase = await createClient();
  const today = kstToday();

  // 🔴 겹침은 저장을 막지 않는다(경고만). 자기 자신(id)은 제외.
  // 독립 조회 2건은 병렬(B4) — 겹침 진단과 "delete 전에 기존 스케줄 읽어두기"는 서로 안 쓴다.
  // 교시마다 고른 강의실의 이름 — 강의실을 바꾼 교시의 라벨을 새 강의실로 맞춘다(schedule-preserve `resolveSlotRoomLabel`).
  const slotRoomIds = [...new Set(input.schedules.map((s) => s.classroomId).filter((v): v is string => !!v))];
  const [overlaps, priorRes, beforeRes, settingsForPeriods, slotRoomRes] = await Promise.all([
    collectOverlaps(supabase, input, id),
    loadCurrentSlots(supabase, id, today),
    // 감사로그용 **변경 전 스냅샷** — 무엇이 바뀌었는지는 바꾸기 전에만 알 수 있다(독립 조회라 병렬, B4).
    // 특강·수업보고서 미발송도 함께 읽는다 — 켜고 끈 기록이 없어 누가 미발송으로 바꿨는지 몰랐다(2026-11-04 사고).
    supabase
      .from("classes")
      .select("class_name, subject, teacher_id, classroom_id, is_special, report_optout")
      .eq("id", id)
      .maybeSingle(),
    // 교시표 — "폼이 보낸 종료시각을 믿어도 되나" 판정에 쓴다(schedule-preserve `formEndTimeWins`).
    // 캐시된 조회지만 저장 경로에 직렬 왕복을 얹지 않으려고 여기서 함께 받는다(B4).
    getTenantSettings(),
    slotRoomIds.length > 0
      ? supabase.from("classrooms").select("id, name").in("id", slotRoomIds)
      : Promise.resolve(null),
  ]);
  // 못 읽었으면 바뀐 교시의 라벨은 비운다(옛 강의실 라벨을 남기지 않는다 — 화면은 강의실 이름으로 떨어진다).
  if (slotRoomRes?.error) logDbError(slotRoomRes.error, "classes.updateClass.slotRooms");
  const slotRoomNames = new Map((slotRoomRes?.data ?? []).map((r) => [r.id as string, (r.name as string) || ""]));
  const before = beforeRes.data as
    | {
        class_name: string;
        subject: string;
        teacher_id: string | null;
        classroom_id: string | null;
        is_special: boolean | null;
        report_optout: boolean | null;
      }
    | null;
  // ⚠️ 승계 자료를 못 읽었으면 **아무것도 쓰기 전에** 멈춘다 — 빈 배열로 진행하면 delete 뒤 재insert가
  // 라벨·기간을 전부 null로 덮어쓰는데 그땐 복구가 불가능하다(규칙 B3: error를 `?? []`로 삼키지 않는다).
  if (priorRes.error || !priorRes.rows) return { error: priorRes.error ?? SAVE_FAILED };
  const prior = priorRes.rows;
  // 0271a '따로 수업(*LAB)' 칸을 못 읽었으면(미적용·조회 실패) 폼 값도 버리고 insert에서 칸을 뺀다([[#95]]) —
  // 키를 실은 insert가 delete 뒤에 실패하면 그 반의 현재 교시가 사라진다.
  const labSupported = priorRes.labSeparateSupported === true;
  if (!labSupported) {
    input.schedules = input.schedules.map((sch) => {
      const rest = { ...sch };
      delete rest.labSeparate;
      return rest;
    });
  }
  const labCol = (v: boolean | undefined) => (labSupported ? { lab_separate: v ?? false } : {});

  // 🔴 반 이름 충돌(같은 과목의 다른 반 — 종강·폐지 반 포함, [[#120]])은 일반 실패가 아니라 **무엇과 겹쳤는지** 알린다
  //    (원장 2026-10-01, PL4 → PL5가 7월 종강한 PL5 때문에 "저장에 실패했습니다"만 떴다). 종강·폐지 반 이름을
  //    비우는 건 화면 버튼을 누른 요청뿐이고, 남의 반을 바꾸는 일이라 관리자(full)만 할 수 있다.
  //    ⚠️ 이 쓰기가 첫 쓰기다 — 여기서 돌아가도 교시는 아직 안 지웠다(아래 delete보다 앞).
  const guarded = await writeWithClassNameGuard({
    db: supabase,
    target: { tenantId: user.tenantId, subject: input.subject, name: input.className, excludeId: id },
    today,
    request: readFreeClosedNameRequest(formData),
    canFree: () => canManageTenant(user.systemRole, "classes"),
    write: async () => {
      const { error } = await supabase
        .from("classes")
        .update({
          class_name: input.className,
          subject: input.subject,
          teacher_id: input.teacherId,
          classroom_id: input.classroomId,
          // ⚠️ **is_active를 여기서 건드리지 않는다**(2026-07-21). 예전엔 폼 체크박스가 이 값을 썼는데,
          // 폐지 버튼과 달리 **그 반 활성 수강을 종료하지 않아** 시간표·출석부에선 사라지고 학생목록엔
          // "수강중"으로 남는 사각지대가 생겼다. 폐지/재운영은 archiveClass 단일 경로.
          // 특강 토글은 **폼이 그 필드를 보냈을 때만** 쓴다 — 안 보내는 폼(구 폼·부분 저장)이 조용히 false로 되돌리지 않게.
          ...(input.isSpecialProvided ? { is_special: input.isSpecial } : {}),
          // '수업보고서 미발송'(0174a)도 같은 계약 — 안 보내는 폼이 조용히 false로 되돌리지 않게.
          ...(input.reportOptoutProvided ? { report_optout: input.reportOptout } : {}),
          // 영어 프로그램 구분(0176a) — 같은 계약(폼이 보냈을 때만). 과목을 영어에서 바꾸면 값은 null로
          // 정리된다(normalizeEnglishTrack) — 수학 반에 남은 'eie'는 필터에서 거짓 분류가 된다.
          ...(input.trackProvided ? { english_track: input.englishTrack } : {}),
          notes: input.notes,
          bg_color: input.bgColor,
          text_color: input.textColor,
        })
        .eq("id", id);
      return { data: true, error };
    },
    savedClassId: () => id,
    failMessage: SAVE_FAILED,
  });
  if (!guarded.ok) return "conflict" in guarded ? nameConflictState(guarded.conflict) : { error: guarded.error };

  // 🔴 반 행(미발송·특강 포함)은 여기서 이미 저장됐다 — 아래 교시 저장이 실패해 돌아가도 그 켜고 끄기는 남긴다.
  //    안 남기면 다시 저장할 때 이전값이 이미 바뀐 값이라 누가 켰는지 끝내 기록되지 않는다(적대적 리뷰 2026-11-04 ·
  //    11-04 사고 = 미발송을 누가 켰는지 몰랐다). 성공 경로는 아래 class_update 하나에 함께 남긴다.
  const logFlagsBeforeFailedReturn = async () => {
    const flags = classFlagChanges(before, input);
    if (flags.length === 0) return;
    await logAction({
      action: "class_update",
      targetType: "class",
      targetLabel: input.className,
      metadata: { classId: id, changed: flags.map((c) => c.field), changes: flags, note: "교시 저장 실패 — 반 정보만 저장됨" },
    });
  };

  // 스케줄 동기화 = **현재 유효한 행만** delete 후 재삽입. 만료 행(valid_to 지난 = 지난 배치 이력)은
  // 건드리지 않는다 — 옛 코드의 무조건 전삭제는 반 메모 한 줄 수정에도 3~6월 배치 기록을 영구 삭제했다.
  const del = await deleteCurrentSlots(supabase, id, today);
  if (del.error) {
    await logFlagsBeforeFailedReturn();
    return { error: del.error };
  }

  // 🔴 담당·강의실이 바뀌거나 슬롯이 사라지면 **옛 배치를 마감 행으로 남긴다**(원장 2026-08-04
  //    "주차변경시에 실제로 일어났던 모든것이 반영되도록"). 지금까지는 같은 행을 덮어써서 지난 주를
  //    봐도 현재 담당·강의실이 보였다(무기한 슬롯 587행이 전부 여기 해당). 마감 행은 아래 재삽입에
  //    함께 실어 왕복을 늘리지 않는다 — delete가 이미 끝났으므로 이 insert가 유일한 복원 지점이다.
  // 교시표의 (시작,종료) 짝 — **과목이 바뀌는 저장**도 있으므로 이전 과목·새 과목 표를 합집합으로 본다
  // (그리드는 마운트 시점 과목 표로 기존 슬롯을 복원하고, 제출은 화면의 현재 과목 표로 만든다).
  const periodPairs = buildPeriodPairs(settingsForPeriods, [before?.subject, input.subject]);
  const archiveRows = planSlotArchives({
    incoming: input.schedules,
    prior,
    today,
    periodPairs,
    // 이미 끝난 구간으로 저장하면 마감 행을 만들지 않는다(재삽입 행이 그 구간을 덮는다 — schedule-preserve 주석).
    ...(input.periodProvided ? { periodValidTo: input.validTo } : {}),
  }).map((a) => ({
    tenant_id: user.tenantId,
    class_id: id,
    day_of_week: a.dayOfWeek,
    start_time: a.startTime,
    end_time: a.endTime,
    valid_from: a.validFrom,
    valid_to: a.validTo,
    teacher_id: a.teacherId ?? null,
    classroom_id: a.classroomId ?? null,
    slot_teacher_label: a.slotTeacherLabel,
    slot_room_label: a.slotRoomLabel,
    period_label: a.periodLabel,
    merge_group: a.mergeGroup,
    ...labCol(a.labSeparate),
  }));

  // 새로 열린 구간 수 — 감사로그가 "수업 배치" 변경을 잡는 두 번째 근거다(아래 changes).
  let openedRows = 0;
  if (input.schedules.length > 0 || archiveRows.length > 0) {
    // ⚠️ 재삽입 값은 **반드시** preserveScheduleFields를 거친다 — 폼이 안 보내는
    // valid_to·slot_teacher_label·slot_room_label·period_label·merge_group을 기존 행에서 되살리고
    // valid_from이 오늘로 리셋되는 것을 막는다(실측 위험분: 라벨 492/342행, valid_to 372행).
    const rows = preserveScheduleFields({
      incoming: input.schedules,
      prior,
      period: {
        validFrom: input.validFrom,
        validTo: input.validTo,
        provided: input.periodProvided,
        ...(input.periodKeepValidTo ? { keepValidTo: true } : {}),
      },
      today,
      periodPairs,
      roomNames: slotRoomNames,
    }).map((s) => ({
      tenant_id: user.tenantId,
      class_id: id,
      day_of_week: s.dayOfWeek,
      start_time: s.startTime,
      end_time: s.endTime,
      valid_from: s.validFrom,
      valid_to: s.validTo,
      teacher_id: s.teacherId,
      classroom_id: s.classroomId,
      slot_teacher_label: s.slotTeacherLabel,
      slot_room_label: s.slotRoomLabel,
      period_label: s.periodLabel,
      merge_group: s.mergeGroup,
      ...labCol(s.labSeparate),
    }));
    // ⚠️ `rows`는 이미 **DB 컬럼명(snake_case)** 으로 변환된 뒤다 — 여기서 `r.validFrom`을 보면
    //    항상 undefined라 openedRows가 늘 0이었다(감사로그의 "수업 배치" 근거 하나가 조용히 죽는다).
    openedRows = rows.filter((r) => r.valid_from === today).length;
    const { error: schedErr } = await supabase.from("class_schedules").insert([...archiveRows, ...rows]);
    if (schedErr) {
      // 🔴 delete는 이미 끝났다 — 여기서 그냥 돌아가면 **그 반의 현재 교시가 통째로 사라진다**(저장 실패
      //    메시지만 뜨고 시간표·출석부에서 반이 빈다). PostgREST insert는 한 문장이라 전부 실패했으므로,
      //    지우기 전에 읽어 둔 `prior`를 **그대로 되돌려** 원상복구를 시도한다(best-effort).
      //    ⚠️ 트랜잭션이 아니다 — 복구까지 실패하면 사용자에게 그 사실을 **말해야** 한다(조용한 소실 금지).
      const restoreRows = (withLab: boolean) =>
        prior.map((pr) => ({
          tenant_id: user.tenantId,
          class_id: id,
          day_of_week: pr.dayOfWeek,
          start_time: pr.startTime,
          end_time: pr.endTime,
          valid_from: pr.validFrom,
          valid_to: pr.validTo,
          teacher_id: pr.teacherId ?? null,
          classroom_id: pr.classroomId ?? null,
          slot_teacher_label: pr.slotTeacherLabel,
          slot_room_label: pr.slotRoomLabel,
          period_label: pr.periodLabel,
          merge_group: pr.mergeGroup,
          ...(withLab ? labCol(pr.labSeparate) : {}),
        }));
      // 🔴 복구는 **행 보존이 표식 보존보다 먼저**다 — 칸 추가 직후 스키마 캐시가 늦어 키 때문에 insert가 실패했을 수
      //    있다(적대적 리뷰 2026-09-17). 표식을 실은 복구가 실패하면 표식 없이 한 번 더 되살린다.
      let restore = await supabase.from("class_schedules").insert(restoreRows(labSupported));
      // ⚠️ 재시도는 **칸 때문일 때만** — 아무 오류에나 다시 넣으면, 1차가 서버에선 커밋됐는데 응답만 실패한 경우
      //    같은 교시가 두 줄이 된다(`class_schedules`엔 유니크 제약이 없어 주 시수가 2배가 된다, 재리뷰 2026-09-17).
      if (restore.error && labSupported && isMissingColumnError(restore.error)) {
        restore = await supabase.from("class_schedules").insert(restoreRows(false));
      }
      await logFlagsBeforeFailedReturn();
      return {
        error: restore.error
          ? "스케줄 저장에 실패했고 되돌리기도 실패했습니다. 이 반의 교시를 확인해주세요."
          : "스케줄 저장에 실패했습니다. 잠시 후 다시 시도해주세요.",
      };
    }
  }

  // 🔴 반 수정에는 그동안 **감사로그가 아예 없었다**(2026-08-04 발견) — 담당·강의실이 언제 누구로
  //    바뀌었는지 되살릴 근거가 여기서 끊겼다. best-effort라 실패해도 저장을 막지 않는다.
  //
  // 🔴 2026-08-05: 항목 이름만 남겨서 이력이 "변경: 강의실"이었다 — **어디서 어디로 바뀌었는지가 없어**
  //    이력으로서 거의 쓸모가 없었다(원장: *"강의실만 딸랑 남기지말고 어디서 → 어디로 이렇게. 담당도"*).
  //    이제 항목마다 이전값·이후값을 함께 남긴다.
  const teacherChanged = !!before && before.teacher_id !== input.teacherId;
  const roomChanged = !!before && before.classroom_id !== input.classroomId;
  const nameChanged = !!before && before.class_name !== input.className;
  const subjectChanged = !!before && before.subject !== input.subject;

  // ⚠️ 이름은 **바뀌는 이 시점에 박아 둔다**(denormalize). id만 남기면 나중에 강의실이 지워지거나
  //    개명됐을 때 그날의 사실이 사라지고, 읽는 화면마다 별도 조회를 달아야 한다(감사 화면엔 강의실
  //    이름 맵이 아예 없다). 감사로그는 "그때 그랬다"를 적는 곳이라 당시 이름이 옳다.
  const userIds = [before?.teacher_id, input.teacherId].filter((v): v is string => !!v);
  const roomIds = [before?.classroom_id, input.classroomId].filter((v): v is string => !!v);
  const [userRes, roomRes] = await Promise.all([
    teacherChanged && userIds.length > 0
      ? supabase.from("users").select("id, display_name").in("id", userIds)
      : Promise.resolve(null),
    roomChanged && roomIds.length > 0
      ? supabase.from("classrooms").select("id, name").in("id", roomIds)
      : Promise.resolve(null),
  ]);
  const userName = new Map((userRes?.data ?? []).map((u) => [u.id as string, (u.display_name as string) || ""]));
  const roomName = new Map((roomRes?.data ?? []).map((r) => [r.id as string, (r.name as string) || ""]));
  const pick = (map: Map<string, string>, key: string | null | undefined) =>
    key ? (map.get(key) ?? null) : null;

  const changes: Array<{ field: string; from?: string | null; to?: string | null }> = [];
  // 배치는 짝이 되는 한 쌍이 아니다(교시 여러 개가 한꺼번에 바뀐다) — 상세는 배치 구간 이력이 갖는다.
  // ⚠️ 마감 행(archiveRows)만 보면 **순수 추가**(없던 교시를 새로 켬)가 이력에서 통째로 빠진다 —
  //    마감할 옛 배치가 없기 때문이다. 오늘 새로 열린 구간(openedRows)도 같은 근거로 센다.
  if (archiveRows.length > 0 || openedRows > 0) changes.push({ field: "수업 배치" });
  // '따로 수업(*LAB)' 켜기·끄기는 어느 교시인지까지 남긴다 — "수업 배치"만으로는 표식이 바뀐 줄 모른다.
  const labToggles = labSupported ? labSeparateChanges(input.schedules, prior) : [];
  if (labToggles.length > 0) {
    // 짝(이전→이후)이 아니라 교시별 켬·끔 목록이라 이름 한 칸에 싣는다 — from/to로 두면 "없음 → …"으로 읽힌다(describe.ts).
    changes.push({
      field: `따로 수업(*LAB) ${labToggles.map((t) => `${DAY_LABEL_KO[t.dayOfWeek] ?? t.dayOfWeek} ${t.startTime} ${t.on ? "켬" : "끔"}`).join(", ")}`,
    });
  }
  if (teacherChanged)
    changes.push({
      field: "담임",
      from: pick(userName, before?.teacher_id),
      to: pick(userName, input.teacherId),
    });
  if (roomChanged)
    changes.push({
      field: "강의실",
      from: pick(roomName, before?.classroom_id),
      to: pick(roomName, input.classroomId),
    });
  if (nameChanged) changes.push({ field: "반 이름", from: before?.class_name ?? null, to: input.className });
  if (subjectChanged) {
    // 과목 라벨은 학원설정이 단일 소스(하드코딩 금지). 캐시된 조회라 저장 경로에 부담이 없다.
    const subjects = buildSubjectMaps((await getTenantSettings()).operations.subjects);
    changes.push({
      field: "과목",
      from: before?.subject ? subjects.labelOf(before.subject) : null,
      to: input.subject ? subjects.labelOf(input.subject) : null,
    });
  }
  // 특강·수업보고서 미발송 켜고 끄기(2026-11-04) — "수업보고서 미발송 꺼짐 → 켜짐". 폼이 그 칸을 보냈을 때만 비교한다.
  changes.push(...classFlagChanges(before, input));

  if (changes.length > 0) {
    await logAction({
      action: "class_update",
      targetType: "class",
      targetLabel: input.className,
      // 담임이 바뀌었으면 **새 담임 id도** 남긴다 — 지난 주 담임 복원(teacher-as-of)이 인수인계 로그와
      // 이 로그를 같은 전이 목록으로 읽는다. 안 남기면 폼으로 바꾼 교체가 이력에서 통째로 빠진다.
      metadata: {
        classId: id,
        // `changed`(항목 이름만)는 옛 형식 — 이미 쌓인 행과 모양이 같아야 하므로 그대로 함께 남긴다.
        changed: changes.map((c) => c.field),
        changes,
        ...(teacherChanged ? { newTeacherId: input.teacherId, previousTeacherId: before?.teacher_id ?? null, effectiveDate: today } : {}),
      },
    });
  }

  revalidatePath("/classes");
  revalidatePath(`/classes/${id}`);
  revalidatePath("/timetable");
  // redirect 대신 결과 반환 — 클라가 성공 확정 후 동시편집 신호(publish) → 이동(B-2).
  revalidatePath("/attendance");
  return { ok: true, redirectTo: `/classes/${id}`, nonce: Date.now(), overlaps };
}

/**
 * 후보 슬롯의 **실효** 강사/강의실(슬롯 override ?? 반 기본)로 겹침 상세를 모은다. 저장은 막지 않는다.
 * ⚠️ 기간은 폼이 보낸 값만 쓴다 — 폼에 기간 UI가 없으면 무기한(null)으로 보고 **넓게** 판정한다.
 *    경고이므로 과다보고는 안전한 쪽(놓치는 것보다 낫다). 정확한 기간은 저장 후 스케줄 행이 진실.
 * 🔴 **best-effort**: 이 진단이 실패해도 저장은 그대로 진행한다(경고 없이). `detectOverlaps`는 안에서
 *    `fetchAllPaged`를 쓰는데 그건 error를 throw하므로, 감싸지 않으면 "진단 쿼리 한 번 실패 = 반이 아예
 *    안 만들어짐"이 된다 — 원장 지시("경고만 남기고 실제로는 만들어지는걸로")와 정반대다.
 */
async function collectOverlaps(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: ReturnType<typeof readForm>,
  excludeClassId?: string,
): Promise<OverlapItem[]> {
  if (input.schedules.length === 0) return [];
  try {
    return await detectOverlaps(supabase, {
      candidates: input.schedules.map((s) => ({
        dayOfWeek: s.dayOfWeek,
        startTime: s.startTime,
        endTime: s.endTime,
        validFrom: input.validFrom,
        validTo: input.validTo,
        // 자리 슬롯은 반 담임을 상속하지 않는다 — 상속하면 담임이 자기 자신과 겹친 것처럼 보고된다.
        teacherId: s.seatLabel ? null : (s.teacherId ?? input.teacherId),
        classroomId: s.classroomId ?? input.classroomId,
        seatLabel: s.seatLabel ?? null,
      })),
      ...(excludeClassId ? { excludeClassId } : {}),
    });
  } catch {
    // 경고를 못 만든 것뿐 — 쓰기의 선행 조건이 되면 안 된다.
    return [];
  }
}

export type ArchiveClassState = { error?: string } | undefined;

/**
 * 반 폐지/재운영 토글.
 * 폐지 = is_active=false + **그 반 활성 수강을 오늘로 종료**(reason='반 폐지'). 재운영 = 되돌림.
 * ⚠️ 학생 상태(students.status)는 건드리지 않는다 — 수강이 0이 된 학생은 재원인 채로 남아
 * 대시보드 '반 미배정 재원생'에서 재배정한다. 근거는 enrollment-lifecycle.ts 주석 참조.
 */
export async function archiveClass(
  _prev: ArchiveClassState,
  formData: FormData,
): Promise<ArchiveClassState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  // 폐지/복구는 그 반 **전원의 수강을 일괄 종료/복원**한다(학생 기록 대량 변경) — 관리자(full)만.
  // 종전 scoped 허용은 담당 반 확인도 없어서 강사가 임의 반을 폐지할 수 있던 구멍(적대 리뷰 후속,
  // 강사=학생 기록 열람 전용 결정과 0219a RLS(enrollments 쓰기 역할 게이트)에 정합).
  if (!(await canManageTenant(user.systemRole, "classes"))) {
    return { error: "반 폐지/복구는 관리자만 할 수 있습니다" };
  }

  const id = String(formData.get("id") ?? "").trim();
  const next = String(formData.get("isActive") ?? "false") === "true";
  if (!id) return { error: "반 ID가 누락되었습니다" };

  if (!next) {
    try {
      await endClassWithName(user, { classId: id, date: kstToday(), archive: true });
    } catch (error) {
      return { error: explainDbError(error, { scope: "classes.archiveClass", op: "write",
        fallback: error instanceof ClassTermError ? error.message : "반 폐지를 저장하지 못했습니다. 반 이름과 수강 정보가 변경됐는지 확인하고 다시 시도해 주세요." }).message };
    }
    revalidatePath("/classes");
    revalidatePath(`/classes/${id}`);
    revalidatePath("/timetable");
    revalidatePath("/students");
    revalidatePath("/");
    return undefined;
  }

  const supabase = await createClient();
  const { data: klass } = await supabase
    .from("classes")
    .select("class_name")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase
    .from("classes")
    .update({ is_active: next })
    .eq("id", id);

  if (error) return { error: explainDbError(error, { scope: "classes.actions.archiveClass", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };

  // 수강 동기화는 classes 갱신이 성공한 뒤 — 실패해도 반 상태와 수강이 어긋나지 않게 순서를 고정.
  const sync = await reopenClassEnrollments(supabase, id, ARCHIVE_REASON);
  if (sync.error) return { error: sync.error };

  await logAction({
    action: "class_unarchive",
    targetType: "class",
    targetLabel: klass?.class_name,
    metadata: { classId: id, affectedStudents: sync.studentIds.length },
  });

  revalidatePath("/classes");
  revalidatePath(`/classes/${id}`);
  revalidatePath("/timetable");
  revalidatePath("/students");
  revalidatePath("/");
  return undefined;
}

// ────────────────────── 종강 / 재개강 (운영 종료일) ──────────────────────
// 폐지(archiveClass, is_active)와 별개: 종강은 closed_at에 종료일을 찍고 is_active=true를 유지.
// → 타임머신에서 종강일 이전 주엔 표시(수강이력 보존), 이후 주에선 숨김(폐지는 전체 숨김).
export type ClassTermState = { error?: string } | undefined;

/** 종강 — closed_at에 종료일 기록(기본 오늘). */
export async function endClassTerm(_prev: ClassTermState, formData: FormData): Promise<ClassTermState> {
  // 종강 = 그 반 활성 수강 전원 종료(학생 기록 대량 변경) — 관리자(full)만(archiveClass와 같은 근거).
  const { user, error } = await requireClassManage();
  if (error || !user) return { error };

  const id = String(formData.get("id") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim() || kstToday();
  if (!id) return { error: "반 ID가 누락되었습니다" };

  try {
    // 종강일 뒤로 남은 시간표 배치도 그날 닫는다(안 닫으면 시트 가져오기가 없는 반을 "제거"로 띄운다, 2026-11-02).
    await endClassWithName(user, { classId: id, date, closeSchedules: true });
  } catch (error) {
    return { error: explainDbError(error, { scope: "classes.endClassTerm", op: "write",
      fallback: error instanceof ClassTermError ? error.message : "종강을 저장하지 못했습니다. 종강일·반 이름·수강 정보를 확인하고 다시 시도해 주세요." }).message };
  }
  revalidatePath("/classes");
  revalidatePath(`/classes/${id}`);
  revalidatePath("/timetable");
  revalidatePath("/students");
  revalidatePath("/");
  return undefined;
}

/** 재개강 — closed_at 비움(다시 운영). */
export async function reopenClassTerm(_prev: ClassTermState, formData: FormData): Promise<ClassTermState> {
  // 재개강도 수강 일괄 복원(학생 기록 대량 변경) — 관리자(full)만(endClassTerm과 한 쌍).
  const { user, error } = await requireClassManage();
  if (error || !user) return { error };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "반 ID가 누락되었습니다" };

  // 종강일 비우기 · 종강이 닫은 시간표 배치 · 종강이 끝낸 수강 · 재개강 기록을 한 거래로(확인 창의 "시간표·일정에
  // 다시 표시됩니다"). 되살릴 산 배치가 없으면 막는다 — 그 밤 정리가 수강을 다시 닫는다(class-term-store.ts).
  try {
    await reopenClassWithSchedules(user, id);
  } catch (error) {
    return { error: explainDbError(error, { scope: "classes.reopenClassTerm", op: "write",
      fallback: error instanceof ClassTermError ? error.message : "재개강을 저장하지 못했습니다. 반 정보를 확인하고 다시 시도해 주세요." }).message };
  }
  revalidatePath("/classes");
  revalidatePath(`/classes/${id}`);
  revalidatePath("/timetable");
  revalidatePath("/students");
  revalidatePath("/");
  return undefined;
}

// ────────────────────── 강사 인수인계(담임 교체 예약) ──────────────────────
// ijw TeacherHandover 경량 이식: 예약(scheduleHandover) → 배너 → 적용(applyHandover)/취소(cancelHandover).
// ⚠️ ijw의 enrollment eager-split·배치 롤백·적용일 자동적용은 미이식(데모 과중). 적용은 수동(배너 버튼).
export type HandoverState = { error?: string; ok?: boolean } | undefined;

// `requireClassWrite`는 [`./class-scope`](./class-scope.ts)로 이관했다 — 종전 로컬 판이 접근 수준만
// 보고 **어느 반인지는 안 봐서**, 강사가 반 id만 바꿔 보내면 남의 반도 저장됐다(2026-09-04 원장 지시로 수정).

/**
 * **학원 전체를 바꾸는 반 작업**(반 생성·강의실 자동배정) 게이트 — 관리자(full)만.
 *
 * 🔴 `requireClassWrite`를 쓰면 안 되는 자리다 — 그건 `scoped`(강사)도 통과시킨다(뜻: "내 담당 반은 쓸 수
 *    있다"). 새 반 생성은 담당이라는 개념 자체가 없고(아직 반이 없다), 강의실 자동배정은 **전 반의**
 *    classroom_id를 한 번에 바꾼다. 둘 다 "전체/없음"만 의미가 있다.
 * ⚠️ 2026-08-06 원장 지시("강사에게 강의실 자동배정·새 반은 필요없음 — 관리자만 필요한 것") + 실측:
 *    강사 화면에 두 버튼이 그대로 떴고, 서버도 scoped를 통과시켜 화면만 숨겨선 우회가 남았을 자리다(#77).
 */
async function requireClassManage() {
  const user = await getCurrentUser();
  if (!user) return { user: null, error: "로그인이 필요합니다" };
  if (!(await canManageTenant(user.systemRole, "classes"))) {
    return { user: null, error: "학원 전체 반 설정은 관리자만 할 수 있습니다" };
  }
  return { user, error: undefined as string | undefined };
}

/**
 * 인계 대상이 이 학원의 **배정 가능한 재직자**인지 검증 — 예약(schedule)·적용(apply) 공통.
 * RLS가 users SELECT를 자기 테넌트로 제한 → 타 테넌트 id는 null로 거부.
 * ⚠️ apply에서도 반드시 재검증할 것 — 예약~적용 사이에 대상이 퇴사/역할변경되면 schedule 검증이 무의미해진다.
 *
 * 🔴 역할 판정은 **선택지 쿼리(`getClassTeacherOptions`)와 같은 소스**([`ASSIGNABLE_TEACHER_ROLES`])를
 *    써야 한다. 2026-08-03에 선택지만 고치고 여기를 빼먹어, **드롭다운엔 뜨는데 저장하면
 *    "유효한 강사가 아닙니다"로 거절되는** 상태가 잠깐 있었다 — 두 벌로 적으면 반드시 갈라진다.
 */
async function isAssignableTeacher(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("users")
    .select("system_role, status")
    .eq("id", userId)
    .maybeSingle();
  return !!data && isAssignableTeacherRole(data.system_role) && data.status === "active";
}

/** 강사 인수인계 예약 — 예정 강사·적용일·사유를 classes에 저장(아직 teacher_id 미변경). */
export async function scheduleHandover(_prev: HandoverState, formData: FormData): Promise<HandoverState> {
  const classId = String(formData.get("classId") ?? "").trim();
  const newTeacherId = String(formData.get("newTeacherId") ?? "").trim();
  const effectiveDate = String(formData.get("effectiveDate") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim() || null;
  if (!classId) return { error: "반 ID가 누락되었습니다" };

  const { user, error } = await requireClassWrite(classId);
  if (error || !user) return { error };
  if (!newTeacherId) return { error: "인계받을 강사를 선택해주세요" };
  if (!effectiveDate) return { error: "적용일을 입력해주세요" };

  const supabase = await createClient();
  const { data: klass } = await supabase
    .from("classes")
    .select("class_name, teacher_id")
    .eq("id", classId)
    .single();
  if (!klass) return { error: "반을 찾을 수 없습니다" };
  if (klass.teacher_id === newTeacherId) return { error: "현재 담임과 동일한 강사입니다" };

  // 인계 대상이 이 학원의 활성 강사/실장/원장인지 검증 — UI는 검색으로 전체 강사를 노출하므로
  // 서버에서도 유효성을 못박는다(변조 payload·타 테넌트 id 방어).
  if (!(await isAssignableTeacher(supabase, newTeacherId))) {
    return { error: "유효한 강사가 아닙니다" };
  }

  const { error: updErr } = await supabase
    .from("classes")
    .update({
      pending_teacher_id: newTeacherId,
      pending_teacher_date: effectiveDate,
      pending_teacher_reason: reason,
    })
    .eq("id", classId);
  if (updErr) return { error: explainDbError(updErr, { scope: "classes.actions.scheduleHandover", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };

  await logAction({
    action: "class_handover_schedule",
    targetType: "class",
    targetLabel: klass.class_name,
    metadata: { newTeacherId, effectiveDate },
  });
  // 새 담임으로 예약된 강사에게 알림 — best-effort(실패해도 예약은 성공).
  await notifyUsers([
    {
      tenantId: user.tenantId,
      recipientId: newTeacherId,
      type: "teacher_handover",
      title: "강사 인수인계 예약",
      body: `${klass.class_name} 반의 새 담임으로 예약되었습니다 (적용일 ${effectiveDate}).`,
      link: `/classes/${classId}`,
      actorId: user.id,
    },
  ]);
  revalidatePath(`/classes/${classId}`);
  revalidatePath("/classes");
  revalidatePath("/timetable");
  return { ok: true };
}

/** 인수인계 예약 취소 — 예정 필드 비움(teacher_id 불변). */
export async function cancelHandover(_prev: HandoverState, formData: FormData): Promise<HandoverState> {
  const classId = String(formData.get("classId") ?? "").trim();
  if (!classId) return { error: "반 ID가 누락되었습니다" };

  const { user, error } = await requireClassWrite(classId);
  if (error || !user) return { error };

  const supabase = await createClient();
  const { error: updErr } = await supabase
    .from("classes")
    .update({ pending_teacher_id: null, pending_teacher_date: null, pending_teacher_reason: null })
    .eq("id", classId);
  if (updErr) return { error: explainDbError(updErr, { scope: "classes.actions.cancelHandover", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };

  await logAction({ action: "class_handover_cancel", targetType: "class", metadata: { classId } });
  revalidatePath(`/classes/${classId}`);
  revalidatePath("/classes");
  revalidatePath("/timetable");
  return { ok: true };
}

/** 인수인계 적용 — teacher_id ← pending_teacher_id로 교체하고 예정 필드 비움. */
export async function applyHandover(_prev: HandoverState, formData: FormData): Promise<HandoverState> {
  const classId = String(formData.get("classId") ?? "").trim();
  if (!classId) return { error: "반 ID가 누락되었습니다" };

  const { user, error } = await requireClassWrite(classId);
  if (error || !user) return { error };

  const supabase = await createClient();
  const { data: klass } = await supabase
    .from("classes")
    .select("class_name, teacher_id, pending_teacher_id")
    .eq("id", classId)
    .single();
  if (!klass) return { error: "반을 찾을 수 없습니다" };
  if (!klass.pending_teacher_id) return { error: "예약된 인수인계가 없습니다" };

  // ⚠️ 예약 시점 검증만으론 부족 — 예약~적용 사이에 대상이 퇴사/역할변경됐을 수 있어 적용 직전 재검증.
  // (FK onDelete:set null이라 하드삭제는 위 null 가드가 잡지만 status/role 변경은 안 잡힘.)
  if (!(await isAssignableTeacher(supabase, klass.pending_teacher_id))) {
    return { error: "예정된 강사가 더 이상 유효하지 않습니다(퇴사·역할 변경). 인수인계를 다시 예약해주세요." };
  }

  const { error: updErr } = await supabase
    .from("classes")
    .update({
      teacher_id: klass.pending_teacher_id,
      pending_teacher_id: null,
      pending_teacher_date: null,
      pending_teacher_reason: null,
    })
    .eq("id", classId);
  if (updErr) return { error: explainDbError(updErr, { scope: "classes.actions.applyHandover", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };

  // 담임만 바꾸면 시간표엔 옛 강사가 그대로 남는다 — 이 반의 **유효한 교시 오버라이드**도 함께 옮긴다.
  // (옛 담임을 가리키는 슬롯만. 원래 다른 사람이 맡던 교시는 그대로 두고, 만료 슬롯도 손대지 않는다.)
  // 실패해도 담임 교체 자체는 성공으로 둔다 — 되돌리면 더 헷갈린다(로그에 slotsMoved로 남김).
  const slots = klass.teacher_id
    ? await moveLiveSlotTeacher(supabase, {
        tenantId: user.tenantId,
        classIds: [classId],
        fromTeacherId: klass.teacher_id,
        toTeacherId: klass.pending_teacher_id,
      })
    : { moved: 0 };

  await logAction({
    action: "class_handover_apply",
    targetType: "class",
    targetLabel: klass.class_name,
    metadata: { classId, previousTeacherId: klass.teacher_id, newTeacherId: klass.pending_teacher_id, effectiveDate: kstToday(), slotsMoved: slots.moved },
  });
  revalidatePath(`/classes/${classId}`);
  revalidatePath("/classes");
  revalidatePath("/timetable");
  revalidatePath("/attendance");
  return { ok: true };
}

// ────────────────────── 강의실 자동배정 ──────────────────────
// ijw ClassroomAssignment 경량 이식: 미리보기(loadClassroomAssignmentData + 순수 알고리즘) → 적용.
// ⚠️ 데이터는 클라가 미리보기 열 때만 지연 로드(페이지 로드 비용 0). 적용은 반 기본 강의실(classes.classroom_id)만.

/** 자동배정 미리보기 데이터 지연 로드 — 반 쓰기 권한자만(읽기 전용엔 도구 비노출). */
export async function loadClassroomAssignmentData(): Promise<{
  data?: ClassroomAssignData;
  error?: string;
}> {
  // 자동배정은 전 반의 강의실을 한 번에 바꾼다 — 조회 단계부터 관리자만(대상 목록 자체가 학원 전체다).
  const { user, error } = await requireClassManage();
  if (error || !user) return { error };
  return { data: await getClassroomAssignmentData() };
}

export type ApplyAssignState = { error?: string; ok?: boolean; applied?: number } | undefined;

/** 자동배정 적용 — 변경분만 classes.classroom_id 업데이트(강의실별 묶어 한 번씩). */
export async function applyClassroomAssignments(
  _prev: ApplyAssignState,
  formData: FormData,
): Promise<ApplyAssignState> {
  const { user, error } = await requireClassManage();
  if (error || !user) return { error };

  let parsed: { classId: string; roomId: string }[];
  try {
    parsed = JSON.parse(String(formData.get("assignments") ?? "[]"));
  } catch {
    return { error: "배정 데이터 파싱 실패" };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return { error: "적용할 변경이 없습니다" };

  // 강의실별로 묶어 update 횟수 최소화(데모 규모 ≤5 강의실 → ≤5 update).
  const byRoom = new Map<string, string[]>();
  for (const a of parsed) {
    if (!a?.classId || !a?.roomId) continue;
    const arr = byRoom.get(a.roomId) ?? [];
    arr.push(a.classId);
    byRoom.set(a.roomId, arr);
  }
  if (byRoom.size === 0) return { error: "적용할 변경이 없습니다" };

  const supabase = await createClient();
  let applied = 0;
  for (const [roomId, ids] of byRoom) {
    const { error: updErr } = await supabase
      .from("classes")
      .update({ classroom_id: roomId })
      .in("id", ids);
    if (updErr) return { error: explainDbError(updErr, { scope: "classes.actions.applyClassroomAssignments", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
    applied += ids.length;
  }

  await logAction({
    action: "classroom_auto_assign",
    targetType: "class",
    metadata: { applied, rooms: byRoom.size },
  });
  revalidatePath("/classes");
  revalidatePath("/timetable");
  return { ok: true, applied };
}


// ────────────────────── 반 임시 위임(결근 대체 수업, 0173a) ──────────────────────
// 인수인계(위)와의 차이: **담임을 바꾸지 않는다.** 기간 동안 대체 강사의 원스크린 로스터에 반을 얹기만 한다.
// 그래서 시간표·급여 splits·ECS 스코프가 따라 움직이지 않고, 기간이 끝나면 저절로 원상복귀된다.
// 🔒 class_delegations에는 쓰기 RLS 정책이 없다(0173a) — 이 액션들이 게이트를 통과한 뒤 admin client로만 쓴다.
export type DelegationState = { error?: string; ok?: boolean } | undefined;

/**
 * 위임 쓰기 게이트 — **모든 위임 쓰기 표면이 이 함수 하나를 지난다**(#77).
 * · `full`(원장·부원장·실장) = 학원 전체 반.
 * · `scoped`(강사) = **자기 담당 반만** — 결근을 아는 사람은 본인이라 미리 맡기고 갈 수 있어야 한다.
 *   ⚠️ classes 메뉴는 강사가 scoped라 권한 검사만으론 남의 반까지 열린다. 담임 확인이 여기서 필수.
 */
type DelegationGate =
  | { ok: false; error: string }
  | {
      ok: true;
      user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
      klass: { class_name: string; teacher_id: string | null };
    };

async function requireDelegationWrite(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classId: string,
): Promise<DelegationGate> {
  // 담당 판정·기록 명의(created_by·revoked_by·알림 actor)는 화면 주인 — 강사뷰면 검증된 대상 강사(class-scope.ts 머리 주석).
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const lvl = await accessLevelTenant(user.systemRole, "classes");
  if (lvl !== "full" && lvl !== "scoped") return { ok: false, error: "반 관리 권한이 없습니다" };
  if (!classId) return { ok: false, error: "반 정보가 없습니다" };
  const { data: klass } = await supabase
    .from("classes")
    .select("class_name, teacher_id")
    .eq("id", classId)
    .maybeSingle();
  if (!klass) return { ok: false, error: "반을 찾을 수 없습니다" };
  // 판정은 반 수정과 **같은 순수 함수**를 쓴다 — 손으로 복사하면 반드시 갈라진다(같은 버튼 하나가
  // 서버 둘에게 다른 답을 듣게 된다). 문구만 하는 일에 맞춰 다르다.
  // super_admin은 새로 만든 '담임 확인'을 자동 통과한다(위 접근 수준 검사는 그대로 지난다).
  if (
    !canWriteClassRecord({
      level: lvl,
      classTeacherId: (klass.teacher_id as string | null) ?? null,
      userId: user.id,
    }) &&
    !(await isCurrentUserSuperAdmin())
  ) {
    return { ok: false, error: CLASS_NOT_MINE_DELEGATE_ERROR };
  }
  return {
    ok: true,
    user,
    klass: { class_name: klass.class_name as string, teacher_id: klass.teacher_id as string | null },
  };
}

/** 반 임시 위임 생성 — 대체 강사·기간(양끝 포함)·사유. 담임(teacher_id)은 건드리지 않는다. */
export async function createClassDelegation(
  _prev: DelegationState,
  formData: FormData,
): Promise<DelegationState> {
  const classId = String(formData.get("classId") ?? "").trim();
  const delegateUserId = String(formData.get("delegateUserId") ?? "").trim();
  const fromDate = String(formData.get("fromDate") ?? "").trim();
  const toDate = String(formData.get("toDate") ?? "").trim() || fromDate; // 비우면 하루 위임
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 200) || null;

  const supabase = await createClient();
  const gate = await requireDelegationWrite(supabase, classId);
  if (!gate.ok) return { error: gate.error };
  const { user, klass } = gate;

  if (!delegateUserId) return { error: "대신 맡을 선생님을 선택해주세요" };
  if (delegateUserId === klass.teacher_id) return { error: "이미 이 반 담임입니다" };
  // 기간 유효성은 폼과 **같은 순수함수**로 — 두 벌로 적으면 화면과 서버가 다른 말을 한다.
  const rangeError = validateDelegationRange(fromDate, toDate);
  if (rangeError) return { error: rangeError };
  // 대상이 이 학원의 배정 가능한 재직자인지 — 인수인계와 같은 소스(ASSIGNABLE_TEACHER_ROLES).
  if (!(await isAssignableTeacher(supabase, delegateUserId))) return { error: "유효한 강사가 아닙니다" };

  // ⚠️ admin client = RLS 우회 → tenant_id를 **명시**로 싣는다(세션 테넌트, 클라 입력 아님).
  const admin = createAdminClient();
  const { error: insErr } = await admin.from("class_delegations").insert({
    tenant_id: user.tenantId,
    class_id: classId,
    delegate_user_id: delegateUserId,
    from_date: fromDate,
    to_date: toDate,
    reason,
    created_by: user.id,
  });
  if (insErr) return { error: explainDbError(insErr, { scope: "classes.actions.createClassDelegation", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };

  await logAction({
    action: "class_delegate",
    targetType: "class",
    targetLabel: klass.class_name,
    metadata: { delegateUserId, fromDate, toDate },
  });
  // 대체 강사에게 알림 — best-effort(실패해도 위임은 성립). 링크는 원스크린(거기서 실제로 쓴다).
  await notifyUsers([
    {
      tenantId: user.tenantId,
      recipientId: delegateUserId,
      type: "class_delegation",
      title: "대신 맡을 수업이 생겼습니다",
      body: `${klass.class_name} 반을 ${delegationRangeLabel(fromDate, toDate)}에 대신 맡습니다. 원스크린 반 목록의 '위임'에서 보입니다.`,
      link: "/onescreen",
      actorId: user.id,
    },
  ]);
  revalidatePath(`/classes/${classId}`);
  revalidatePath("/classes");
  revalidatePath("/onescreen");
  return { ok: true };
}

/** 위임 해제 — 행을 지우지 않고 revoked_at을 남긴다(누가 언제 대신 맡았는지는 감사 대상). */
export async function revokeClassDelegation(
  _prev: DelegationState,
  formData: FormData,
): Promise<DelegationState> {
  const delegationId = String(formData.get("delegationId") ?? "").trim();
  if (!delegationId) return { error: "위임 정보가 없습니다" };

  const supabase = await createClient();
  // 먼저 대상 위임을 읽어 **그 반 기준으로** 게이트를 태운다(강사는 자기 반 위임만 해제).
  // RLS(select 정책 = 같은 테넌트)가 타 테넌트 행을 걸러낸다.
  const { data: row } = await supabase
    .from("class_delegations")
    .select("id, class_id, delegate_user_id, from_date, to_date, revoked_at")
    .eq("id", delegationId)
    .maybeSingle();
  if (!row) return { error: "위임을 찾을 수 없습니다" };
  if (row.revoked_at) return { ok: true }; // 이미 해제됨 — 더블클릭·경합을 성공으로 흡수

  const gate = await requireDelegationWrite(supabase, row.class_id as string);
  if (!gate.ok) return { error: gate.error };
  const { user, klass } = gate;

  const admin = createAdminClient();
  const { error: updErr } = await admin
    .from("class_delegations")
    .update({ revoked_at: new Date().toISOString(), revoked_by: user.id })
    .eq("id", delegationId)
    .eq("tenant_id", user.tenantId) // admin = RLS 우회 → 테넌트 필터 필수
    .is("revoked_at", null);
  if (updErr) return { error: explainDbError(updErr, { scope: "classes.actions.revokeClassDelegation", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };

  await logAction({
    action: "class_delegate_revoke",
    targetType: "class",
    targetLabel: klass.class_name,
    metadata: { delegationId, delegateUserId: row.delegate_user_id },
  });
  revalidatePath(`/classes/${row.class_id as string}`);
  revalidatePath("/classes");
  revalidatePath("/onescreen");
  return { ok: true };
}
