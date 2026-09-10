import "server-only";
/**
 * 일일 AI 브리핑 — 수집·생성·저장(0114a daily_briefings). cron(/api/cron/daily-briefing)과
 * '다시 생성' 서버 액션이 공유하는 단일 소스.
 *
 * - 페이지 로드는 절대 이 파일의 generate를 부르지 않는다(CLAUDE.md AI 정책) — 저장분 렌더만.
 * - daily_briefings엔 RLS 정책이 없다(0114a 의도: payload가 master 관점 전신호, #77) —
 *   읽기도 admin으로 하되 **호출부(page.tsx·액션)가 canManageStaff 게이트를 먼저 통과**해야 한다.
 * - 숫자·명단은 payload(결정론)가 진실. narrative는 validateNarrative 통과분만 저장,
 *   실패는 processing_error에 한글 사유(완료+narrative null = "서술만 실패" 시멘틱).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { kstToday } from "@/lib/date-kst";
import { generateJSON } from "@/lib/ai/generate";
import { reportError, reportWarning } from "@/lib/observability/report-error";
import { notifyUsers } from "@/features/notifications/server/notify";
import { computeRetentionRoster } from "@/features/retention/server/queries";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { canAccess, resolveMatrix } from "@/lib/permissions";
import { summarizeRoster } from "@/features/retention/roster";
import { addIsoDateDays } from "@/features/consultations/follow-up-urgency";
import { getTodayActionSignals, type DashboardSignalsDb } from "./action-signals";
import { getAbsenceBreakdown, getAbsenceRiskAnchor, getAbsenceRiskStudents } from "./queries";
import {
  buildDailyBriefingPayload,
  shouldGenerateNarrative,
  type DailyBriefingPayload,
} from "../briefing-digest";
import {
  buildFallbackTeamReport,
  buildTeamPrompt,
  validateTeamReport,
  type TeamReport,
} from "../briefing-team-report";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type DailyBriefingRow = {
  id: string;
  briefing_date: string;
  processing_status: string; // idle | analyzing | completed | failed
  processing_error: string | null;
  payload: DailyBriefingPayload | null;
  narrative: string | null; // v1 하위호환(구 행 표시용)
  team_report: TeamReport | null;
  generated_at: string | null;
};

/** KST 날짜 문자열에서 n일 전(YYYY-MM-DD) — 결정적 UTC 산술(date-kst 주석 규칙). */
function daysBefore(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
}

/** count 응답 → 숫자. 실패는 throw — 브리핑 전체 try/catch가 processing_error로 정직하게 기록한다. */
function countOrThrow(res: { count: number | null; error: { message: string } | null }, label: string): number {
  if (res.error) throw new Error(`${label} count 실패: ${res.error.message}`);
  return res.count ?? 0;
}

/** 오늘 브리핑 행 — ⚠️ 호출부가 canManageStaff 게이트 통과 후에만 부를 것(admin 읽기). */
export async function getDailyBriefing(tenantId: string, date: string): Promise<DailyBriefingRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("daily_briefings")
    .select("id, briefing_date, processing_status, processing_error, payload, narrative, team_report, generated_at")
    .eq("tenant_id", tenantId)
    .eq("briefing_date", date)
    .maybeSingle();
  if (error) throw new Error(`getDailyBriefing: ${error.message}`);
  return (data as DailyBriefingRow | null) ?? null;
}

/**
 * 테넌트 1건의 브리핑 생성 → upsert(tenant×date 멱등). 실패도 행으로 남겨 카드가 정직하게 표시.
 * notifyOnFirstGeneration: 그날 최초 생성시에만 master에게 벨 1회(notified_at 게이트 — 재생성은 미발송).
 */
export async function generateDailyBriefing(
  tenantId: string,
  opts: { notifyOnFirstGeneration?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient();
  const supabase = admin as unknown as Supabase;
  const db: DashboardSignalsDb = { supabase, tenantId };
  const date = kstToday();
  const yesterday = daysBefore(date, 1);
  try {
    const dayKey = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][
      new Date(`${date}T00:00:00Z`).getUTCDay()
    ]!;
    // ⚠️ 권한 게이트 — /retention 메뉴가 그 테넌트에서 꺼져 있으면(전 역할 none) 브리핑에도 싣지 않는다.
    // 예전엔 화면은 전원 차단인데 브리핑·AI 비서로는 이탈 명단과 '매출 위험' 금액이 매일 보고돼,
    // **볼 수 없는 화면의 데이터가 다른 경로로 새어 나갔다**(게다가 눌러서 확인할 화면조차 없다).
    // master 기준으로 판정: 원장조차 못 여는 메뉴면 브리핑 재료가 될 수 없다. 겸사겸사 cron 비용도 준다.
    // 과목 라벨(운영 enum 단일 소스)과 retention 게이트가 같은 설정에서 나온다 — 한 번만 읽는다.
    // 조회 실패 시 라벨 리졸버가 없으면 과목 분해를 생략한다(raw 키를 화면에 흘리는 것보다 낫다).
    const settings = await getTenantSettingsByTenantId(tenantId).catch(() => null);
    const subjectLabel = settings ? buildSubjectMaps(settings.operations.subjects).labelOf : undefined;
    const retentionEnabled = settings
      ? canAccess("master", "retention", resolveMatrix(settings.permissions.overrides))
      : true; // 설정 조회 실패는 기존 동작 유지(fail-open — perm-matrix.ts와 같은 취지)
    // retention은 앱 최중량 읽기 — 실패해도 브리핑 본체는 살린다(B7 준수: 라이브가 아니라 cron에서만 계산).
    // B4: 아래 신호 배치와 독립 조회라 직렬 await 금지 — 같은 Promise.all에 편입(cron 120s·regen 60s 예산 절약).
    const retentionPromise = (retentionEnabled
      ? computeRetentionRoster(tenantId)
      : Promise.reject(new Error("retention 메뉴 비활성 — 브리핑에서 제외")))
      .then((roster) => {
        const stats = summarizeRoster(roster);
        return {
          retention: { total: stats.total, risk: stats.risk, warn: stats.warn, revenueRisk: stats.revenueRisk },
          // roster는 위험도 내림차순 — 상위 위험 학생의 사유·권장 조치(전부 결정론)를 스포트라이트 재료로.
          retentionTop: roster
            .filter((student) => student.risk.level !== "ok")
            .slice(0, 5)
            .map((student) => ({
              studentId: student.id,
              name: student.name,
              reasons: student.risk.reasons,
              action: student.primaryAction || null,
            })),
          missing: null as string | null,
        };
      })
      .catch((e: unknown) => {
        reportWarning("브리핑 retention 계산 실패 — 이탈 신호 없이 진행", {
          scope: "briefing.retention",
          tenantId,
          error: e instanceof Error ? e.message : String(e),
        });
        return {
          retention: null,
          retentionTop: [] as { studentId: string; name: string; reasons: string[]; action: string | null }[],
          // 메뉴를 꺼둔 건 '정상적으로 제외'라 알릴 게 없다. 켜져 있는데 계산이 실패한 것만
          // "확인 불가"로 표면화한다 — 안 그러면 이탈 신호 0으로 위장된다(2026-07-31 실측).
          missing: retentionEnabled ? "재등록 이탈 신호" : null,
        };
      });

    const [
      yesterdayRaw,
      todayRaw,
      overdueRes,
      dueSoonRes,
      absenceRisks,
      classSessionsRes,
      retentionResult,
      absenceAnchor,
    ] = await Promise.all([
      // 어제 마감: asOf=어제 + nowMinutes=1440(전 수업 시작됨) — '어제 무단결석·어제 미작성'이 정확해진다.
      // 🔴 timetable=false — '내일 시간표 예약'은 어제 기준으로 모으면 '오늘'을 가리켜 라벨과 어긋난다.
      //    briefing-digest가 payload에서 어차피 비우므로 조회 자체를 건너뛴다(헛도는 왕복 2회 제거).
      //    attendanceNow=false — 어제 재생분은 아래 '어제 미기록'과 같은 날짜·같은 쿼리라 두 번 돌 뿐이다.
      getTodayActionSignals(
        { timetable: false, attendanceNow: false },
        { db, asOf: { date: yesterday, nowMinutes: 1440 } },
      ),
      // 오늘: 어제 미기록 반·오늘 휴가·승인 대기만(나머지 도메인은 어제 수집분과 중복이라 스킵).
      getTodayActionSignals(
        {
          meetings: false,
          enrollment: false,
          consultations: false,
          lessonReports: false,
          students: false,
          billing: false,
          owner: false,
          timetable: false,
          // 신규생 지연은 **어제 수집분**(위 호출)이 이미 담는다 — 같은 무거운 조회를 두 번 돌리지 않는다.
          newcomers: false,
          // 브리핑은 '지금 미기록'을 쓰지 않는다(payload에서 비운다) — 조회 자체를 건너뛴다.
          attendanceNow: false,
        },
        { db },
      ),
      // 후속조치는 **절대 건수**로 보고되므로 fetch-후-필터(60행 절단, B2) 대신 exact count 2건 —
      // 경계는 followUpUrgency와 동일(overdue: <오늘 / today+soon: 오늘~오늘+3일).
      supabase
        .from("student_consultations")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("follow_up_done", false)
        .not("follow_up_date", "is", null)
        .lt("follow_up_date", date),
      supabase
        .from("student_consultations")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("follow_up_done", false)
        .gte("follow_up_date", date)
        .lte("follow_up_date", addIsoDateDays(date, 3)),
      getAbsenceRiskStudents(db),
      supabase
        .from("class_schedules")
        .select("class_id, class:class_id!inner ( is_active, closed_at )", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("day_of_week", dayKey)
        .eq("class.is_active", true)
        // 종강 반 제외 — 종강은 is_active=true 유지 + closed_at만 찍는 별도 상태(classes/actions 주석).
        // 다른 신호들(unrecorded/unwritten)은 JS에서 closed_at<date를 거르는데 이 카운트만 빠져 있었다.
        .or(`closed_at.is.null,closed_at.gte.${date}`, { referencedTable: "class" })
        .lte("valid_from", date)
        .or(`valid_to.is.null,valid_to.gte.${date}`),
      retentionPromise,
      // 과목 분해가 쓸 14일 창의 기준일 — 위험 학생 id와 **무관**하므로 같은 배치에 넣는다(B4).
      // 🔴 **여기서 throw하면 브리핑이 통째로 안 만들어진다**(Promise.all은 하나만 깨져도 reject).
      //    같은 배치의 `getAbsenceRiskStudents`는 명단 그 자체라 없으면 안 되지만, 이 조회는 **과목 라벨용
      //    부가 정보**다 — 부가 기능이 본체를 죽이면 안 된다. null이면 아래에서 분해를 건너뛴다(2026-08-29 리뷰).
      getAbsenceRiskAnchor(db).catch((e: unknown) => {
        reportWarning("브리핑 결석 창 기준일 조회 실패 — 과목 표기 없이 진행", {
          scope: "briefing.absenceAnchor",
          tenantId,
          error: e instanceof Error ? e.message : String(e),
        });
        return null;
      }),
    ]);
    const { retention, retentionTop, missing: retentionMissing } = retentionResult;

    // 결석 위험 "N회"의 과목 분해(원장 2026-08-29 "과목별 표기"). 위험 학생 id가 나와야 좁힐 수 있어
    // 위 배치 뒤에 온다(진짜 의존). 🔴 실패해도 브리핑 본체는 살린다 — 과목은 있으면 더 좋은 정보이지,
    // 없다고 "결석 8회"가 틀려지는 것은 아니다(사유 없는 '확인 불가' 줄을 늘리지 않는다).
    const absenceBreakdown =
      absenceAnchor && absenceRisks.length > 0
        ? await getAbsenceBreakdown(
            db,
            absenceRisks.map((risk) => risk.studentId),
            absenceAnchor,
          ).catch((e: unknown) => {
            reportWarning("브리핑 결석 과목·사유 분해 실패 — 과목·사유 표기 없이 진행", {
              scope: "briefing.absenceSubjects",
              tenantId,
              error: e instanceof Error ? e.message : String(e),
            });
            return null;
          })
        : null;

    const payload = buildDailyBriefingPayload({
      date,
      yesterdayRaw,
      todayRaw,
      followUps: {
        overdue: countOrThrow(overdueRes, "후속조치 기한경과"),
        dueSoon: countOrThrow(dueSoonRes, "후속조치 임박"),
      },
      absenceRisks: absenceRisks.map((risk) => ({
        studentId: risk.studentId,
        studentName: risk.studentName,
        absences: risk.absences,
        bySubject: absenceBreakdown?.subjects.get(risk.studentId),
        reasonSummary: absenceBreakdown?.reasons.get(risk.studentId),
      })),
      retention,
      retentionTop,
      todayClassSessions: classSessionsRes.error ? null : (classSessionsRes.count ?? null),
      missingDomainLabels: retentionMissing ? [retentionMissing] : [],
      subjectLabel,
    });

    let teamReport: TeamReport | null = null;
    let note: string | null = null;
    let modelVersion: string | null = null;
    if (shouldGenerateNarrative(payload)) {
      try {
        const { data, model } = await generateJSON<TeamReport>({
          prompt: buildTeamPrompt(payload),
          // ⚠️ 1200은 부족했다 — 실측(ai_usage_logs) 결과 실패한 날은 output_tokens가 **정확히 1200**,
          // 즉 JSON이 문장 도중에 잘려 파싱이 깨진 것이었다(16일 중 4일이 이 사유). 신호가 많은 날은
          // 5개 영역 × 한국어 3문장이 1200을 쉽게 넘는다. 프롬프트에도 900자 제한을 함께 걸었다.
          maxTokens: 2400,
          meta: { tenantId, feature: "daily_briefing" },
        });
        modelVersion = `${model}-${date}`;
        const check = validateTeamReport(data, payload);
        if (check.ok) teamReport = check.value;
        else {
          note = "AI 팀 보고가 검증에서 탈락해 결정론 요약으로 대체했습니다.";
          reportWarning("브리핑 팀 보고 검증 탈락", {
            scope: "briefing.teamReport.guard",
            tenantId,
            reason: check.reason,
          });
        }
      } catch (e) {
        // generateJSON이 키/한도 오류를 이미 한글화(rethrowAi) — 그대로 표면화.
        note = `AI 팀 보고 생성 실패: ${e instanceof Error ? e.message : String(e)}`;
        reportError(e, { scope: "briefing.teamReport", tenantId });
      }
    }

    const { error: upsertError } = await admin.from("daily_briefings").upsert(
      {
        tenant_id: tenantId,
        briefing_date: date,
        processing_status: "completed",
        processing_error: note,
        payload,
        narrative: null, // v1 컬럼 — 새 행은 team_report 사용(구 행 표시 하위호환만)
        team_report: teamReport,
        model_version: modelVersion,
        generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,briefing_date" },
    );
    if (upsertError) throw new Error(`브리핑 저장 실패: ${upsertError.message}`);

    if (opts.notifyOnFirstGeneration) await notifyMasterOnce(tenantId, date, payload);
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    reportError(e, { scope: "briefing.generate", tenantId });
    // 실패도 행으로 남긴다(정직성) — 기존 payload가 있으면 upsert가 해당 컬럼만 갱신해 보존된다.
    const { error: markError } = await admin.from("daily_briefings").upsert(
      {
        tenant_id: tenantId,
        briefing_date: date,
        processing_status: "failed",
        processing_error: `브리핑 생성 실패: ${message}`,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,briefing_date" },
    );
    if (markError) reportError(markError, { scope: "briefing.generate.failmark", tenantId });
    return { ok: false, error: message };
  }
}

/**
 * 벨 알림 1회 게이트 — notifications엔 유니크 제약이 없어 재실행이 중복 벨을 쌓는다.
 * 수신자는 master만(원장 결정 2026-07-16 — 관리자 전원 아침 벨은 경보 피로).
 */
async function notifyMasterOnce(tenantId: string, date: string, payload: DailyBriefingPayload): Promise<void> {
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("daily_briefings")
    .select("id, notified_at")
    .eq("tenant_id", tenantId)
    .eq("briefing_date", date)
    .maybeSingle();
  if (!row || row.notified_at) return;
  const { data: masters, error } = await admin
    .from("users")
    .select("id")
    .eq("tenant_id", tenantId) // admin은 RLS 우회 — 이 필터가 유일한 격리선(notifyClassAssignment 선례)
    .eq("system_role", "master")
    .eq("status", "active");
  if (error || !masters || masters.length === 0) return;
  await notifyUsers(
    masters.map((master) => ({
      tenantId,
      recipientId: master.id as string,
      type: "daily_briefing" as const,
      title: "오늘의 운영 브리핑이 준비됐습니다",
      body: buildFallbackTeamReport(payload).headline.slice(0, 120),
      // 보고는 운영실 2차 줄(접힌 <details id="daily-briefing">) 안에 있다 — 해시로 그 줄을 펼친 채 착지(DetailsHashOpen).
      link: "/dashboard/briefing#daily-briefing",
    })),
  );
  await admin.from("daily_briefings").update({ notified_at: new Date().toISOString() }).eq("id", row.id);
}
