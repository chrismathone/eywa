import "server-only";
/**
 * 출결 요약 — 적재. 화면(요약 탭)과 AI 정리가 **같은 결과**를 쓴다.
 *
 * 🔑 보드는 새로 적재하지 않고 `getLiveBoard(date)`를 그대로 쓴다(React cache라 같은 요청 안에서
 *    좌석표·큐와 왕복을 공유한다). 요약을 위해 별도 집계 쿼리를 새로 짜면 "좌석표엔 12명인데 요약엔
 *    14명" 같은 어긋남이 생긴다 — 당일 출결이 이미 한 적재로 두 면을 그리는 이유와 같다.
 * 🔑 범위(월요일 = 금·토·일)는 **날짜마다 따로 적재해 따로 요약**하고 합계만 더한다 — 뭉쳐서 한 번에
 *    세면 "언제 빠졌나"가 사라진다(원장 2026-08-19 *"내용도 금토 구분해서 정리하고"*).
 * ⚠️ 휴원일은 보드가 비어 있으므로 그날 블록이 자동으로 빈다(이름은 따로 실어 "기록 0"과 구분한다).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { reportError } from "@/lib/observability/report-error";
import { fetchInChunks } from "@/lib/supabase/batch";
import { addDays, kstToday } from "@/lib/date-kst";
import { classifyAbsenceReason } from "@/features/attendance/absence-reason";
import { getLiveBoard, loadFollowups } from "@/features/attendance/live/server/queries";
import { holidayNameOf } from "@/features/attendance/live/server/load";
import { buildDayRecap, type RecapFollowup, type RecapSlotInput } from "../digest";
import { buildRangeRecap, RECAP_MAX_DAYS, type RangeRecap, type RecapDay } from "../range";
import type { RecapBrief } from "../prompt";

/** 반복 결석으로 볼 문턱 — 이 미만은 표시하지 않는다(첫 결석에 "1회"를 붙이면 노이즈다). */
const REPEAT_MIN = 2;

/**
 * 범위 요약(결정론). 관리자(full) 전용 — 이 화면은 전 학원 학생의 결석 사유·담당까지 한 장에 모은다.
 *
 * @param dates 오름차순 날짜들(하루면 1개). 상한 `RECAP_MAX_DAYS`.
 * @returns 권한이 없으면 null(호출부가 탭 자체를 안 그린다).
 */
export async function getRangeRecap(dates: readonly string[]): Promise<RangeRecap | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  if ((await accessLevelTenant(user.systemRole, "attendance")) !== "full") return null;
  const wanted = dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, RECAP_MAX_DAYS);
  if (wanted.length === 0) return null;

  // 반복 결석은 **범위와 무관하게 오늘 기준 14일**이라 한 번만 조회한다(날짜마다 부르면 같은 값을 N번).
  const repeats = await loadRepeatAbsences();

  // 🔑 사전 통보 보정은 **날짜별 적재와 나란히** 돈다(B4) — 그 명단(위 RPC)에만 의존하지, 보드와는
  //    서로 모른다. 앞에 줄 세우면 요약 탭 첫 페인트가 왕복 두 번만큼 늦어진다.
  const [plannedRepeats, loaded] = await Promise.all([
    // 그중 사전 통보(여행·휴가…)가 몇 번이었나 — 숫자를 지우지 않고 **톤만** 내리는 근거(2026-08-20).
    loadPlannedRepeats([...repeats.keys()]),
    // 날짜끼리는 서로 독립이라 병렬(B4). 하루 안에서도 휴일·보드·조치가 독립이라 다시 병렬.
    Promise.all(
      wanted.map(async (date) => {
        const [holiday, board, followups] = await Promise.all([
          holidayNameOf(date),
          getLiveBoard(date),
          loadFollowups(date),
        ]);
        return { date, holiday, board, followups };
      }),
    ),
  ]);

  const days: RecapDay[] = loaded.map(({ date, holiday, board, followups }) => {
    const slots: RecapSlotInput[] = board.teachers.flatMap((teacher) =>
      teacher.slots.map((slot) => ({
        classId: slot.classId,
        className: slot.className,
        subject: slot.subject,
        slotStart: slot.slotStart,
        saveSlot: slot.saveSlot,
        teacherName: teacher.teacherName,
        slotTeacherLabel: slot.slotTeacherLabel,
        hasAnyRecord: slot.hasAnyRecord,
        students: slot.students.map((s) => ({
          studentId: s.studentId,
          studentName: s.studentName,
          schoolGrade: s.schoolGrade,
          status: s.status,
          // ⚠️ 연락처는 싣지 않는다 — 요약은 "무슨 일이 있었나"를 읽는 화면이고, 전화는 데스크 큐가 한다.
          note: s.note,
        })),
      })),
    );
    return {
      ...buildDayRecap({
        date,
        slots,
        followupOf: (studentId, saveSlot) => {
          const hit =
            followups.get(`${studentId}|${saveSlot ?? ""}`) ?? followups.get(`${studentId}|`) ?? null;
          return hit
            ? ({ state: hit.state, outcome: hit.outcome, handledByName: hit.handledByName } as RecapFollowup)
            : null;
        },
        recentAbsenceOf: (studentId) => repeats.get(studentId) ?? null,
        // 🔴 총계를 넘지 않게 자른다 — 두 값이 다른 쿼리에서 오므로(RPC vs 메모 조회) 정정 이력이
        //    남은 칸에서 사전 통보가 총계보다 커질 수 있고, 그러면 화면이 음수를 말한다.
        recentPlannedOf: (studentId) => {
          const total = repeats.get(studentId);
          const planned = plannedRepeats.get(studentId);
          if (total == null || planned == null) return null;
          return Math.min(planned, total);
        },
      }),
      holiday,
    };
  });

  return buildRangeRecap(days);
}

/**
 * 최근 14일 반복 결석(학생 → 회수) — 위험 명단·마일스톤 알림과 **같은 RPC**를 쓴다.
 * 🔑 셈 단위가 (반·날짜)라 영어 연강이 3회로 부풀지 않는다(0221a). 여기서 규칙을 다시 짜지 말 것.
 * ⚠️ 창은 **오늘 기준 14일**이다(0220a). 요약 날짜가 오래 전이면 이 값은 "지금 기준"이라 화면도 그렇게 적는다.
 * ⚠️ 실패해도 요약은 살린다 — 반복 결석 표식이 없을 뿐이고, 조용히 넘기지는 않는다(#89).
 */
async function loadRepeatAbsences(): Promise<Map<string, number>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("dashboard_absence_risk", { p_min: REPEAT_MIN });
  if (error) {
    reportError(error, { scope: "attendance.recap.repeatAbsences" });
    return new Map();
  }
  return new Map(
    ((data as { student_id: string; absences: number }[] | null) ?? []).map((r) => [
      r.student_id,
      Number(r.absences),
    ]),
  );
}

/**
 * 반복 결석 명단의 **사전 통보 횟수**(학생 → 회수). 위 `loadRepeatAbsences`가 뽑은 학생만 대상이다.
 *
 * 🔑 **세는 단위가 RPC와 같아야 한다** — 0221a는 `(반, 날짜)` 하나를 1회로 세므로(영어는 하루가 2~3행)
 *    여기서도 행을 세지 않고 `(반, 날짜)`로 접는다. 행을 세면 영어만 2.19배가 되어 "사전 통보 6회 /
 *    결석 3회" 같은 말이 나온다.
 * 🔑 창도 RPC와 같다 — 기준일은 **오늘 이하의 마지막 출결일**(0220a: 미리 찍은 미래 결석이 창을 밀지
 *    않게)이고 거기서 13일 전까지다. `today - 13`으로 잡으면 일요일 아침에 창이 하루씩 어긋난다.
 * ⚠️ **실패해도 요약을 죽이지 않는다** — 빈 Map을 돌려 보정 없이(종전 동작) 그린다. 단 조용히 넘기지는
 *    않는다(#89: 폴백 있는 기능은 실패를 로그로 남겨야 보인다).
 * ⚠️ 정정 이력이 남은 칸(같은 교시에 여러 행)은 옛 행의 메모도 함께 읽힌다 — 그래서 호출부가
 *    `min(총계)`로 자른다. 톤만 바꾸는 값이라 이 정도 근사를 감수한다.
 * ⚠️ B2/B3: 무페이징 전건 select 금지 — 대상 학생 id로 좁히고 `fetchInChunks`(414 + 1000행 절단 회피).
 */
async function loadPlannedRepeats(studentIds: readonly string[]): Promise<Map<string, number>> {
  if (studentIds.length === 0) return new Map();
  const supabase = await createClient();
  try {
    // 기준일 = 오늘 이하의 마지막 출결일. 행을 세는 게 아니라 한 줄만 집는다(B2).
    const { data: anchorRow, error: anchorErr } = await supabase
      .from("attendance_records")
      .select("session_date")
      .lte("session_date", kstToday())
      .order("session_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (anchorErr) throw anchorErr;
    const anchor = (anchorRow?.session_date as string | undefined) ?? null;
    if (!anchor) return new Map();

    const rows = await fetchInChunks<{
      student_id: string;
      class_id: string;
      session_date: string;
      note: string | null;
    }>([...studentIds], (chunk) =>
      supabase
        .from("attendance_records")
        .select("student_id, class_id, session_date, note")
        .eq("status", "absent")
        .gte("session_date", addDays(anchor, -13))
        .lte("session_date", anchor)
        .in("student_id", chunk),
      // 🔴 청크당 행 수도 1000 미만이어야 한다(B2 silent 절단). 실측 26명 = 115행이라 여유가 크지만,
      //    학생 수가 늘면 100명 청크가 한계에 닿을 수 있어 절반으로 잡는다(요청 하나 더는 병렬이라 공짜).
      50,
    );

    // (학생·반·날짜) 하나가 1회 — 그 칸의 **어느 교시 메모에라도** 사유가 있으면 사전 통보로 본다
    // (영어는 사유를 한 교시에만 적는 편이라 교시별로 따지면 대부분 놓친다).
    const planned = new Map<string, Set<string>>();
    for (const r of rows) {
      if (classifyAbsenceReason(r.note) !== "planned") continue;
      const set = planned.get(r.student_id) ?? new Set<string>();
      set.add(`${r.class_id}|${r.session_date}`);
      planned.set(r.student_id, set);
    }
    return new Map([...planned].map(([id, set]) => [id, set.size]));
  } catch (e) {
    reportError(e, { scope: "attendance.recap.plannedRepeats" });
    return new Map();
  }
}

export type SavedRecapBrief = {
  status: string; // idle | analyzing | completed | failed
  brief: RecapBrief | null;
  error: string | null;
  model: string | null;
  generatedAt: string | null;
};

/**
 * 저장된 AI 정리 — **페이지 로드는 절대 생성하지 않는다**(CLAUDE.md AI 정책). 마지막 결과를 그대로 보인다.
 *
 * 🔑 키는 **범위**(from~to)다 — 토요일 하루 요약과 금~일 종합 요약은 다른 글이라 같은 칸에 덮어쓰면
 *    화면이 엉뚱한 기간의 문장을 보여준다.
 * ⚠️ 표(0226a)가 아직 적용 전이어도 화면은 살아야 한다(#95: 앱은 옛 스키마·새 스키마 둘 다에서 동작) →
 *    조회 실패는 null로 떨어뜨리고 카드가 '정리 없음'으로 뜬다. 로그에는 남긴다.
 * ⚠️ 이 표엔 RLS 정책이 없다(0114a 브리핑과 같은 취지) → admin 클라이언트 + **tenant_id 명시 필터**([[#104]]).
 * 🔴 게이트를 여기서도 건다 — admin은 RLS를 우회하므로 "호출부가 막아주겠지"는 게이트가 아니다(#77).
 *    테넌트도 인자로 받지 않는다(잘못된 id를 넘길 여지 자체를 없앤다).
 */
export async function getSavedRecapBrief(from: string, to: string): Promise<SavedRecapBrief | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  if ((await accessLevelTenant(user.systemRole, "attendance")) !== "full") return null;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("attendance_day_recaps")
    .select("status, summary, error, model_version, generated_at")
    .eq("tenant_id", user.tenantId)
    .eq("from_date", from)
    .eq("recap_date", to)
    .maybeSingle();
  if (error) {
    reportError(error, { scope: "attendance.recap.savedBrief", date: to });
    return null;
  }
  if (!data) return null;
  return {
    status: (data.status as string) ?? "idle",
    brief: (data.summary as RecapBrief | null) ?? null,
    error: (data.error as string | null) ?? null,
    model: (data.model_version as string | null) ?? null,
    generatedAt: (data.generated_at as string | null) ?? null,
  };
}
