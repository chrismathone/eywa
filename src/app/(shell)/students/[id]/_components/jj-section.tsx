/**
 * 학생 상세 **'SRS 성적' 탭** — JJ실 학습(인재원 단어 학습 프로그램) 구역. 서버 컴포넌트.
 * ⚠️ 2026-09-21까지는 '성적' 탭 안에 있었다(원장 지시로 탭을 갈랐다) — 조각은 그대로 옮겨 왔다.
 *
 * 짝(students.ijw_student_id)이 걸린 학생만 보인다 — 짝이 없거나 연동이 설정되지 않은 학원이면 아무것도
 * 그리지 않는다(수학만 듣는 학생 화면에 빈 구역이 생기지 않게). 숫자는 매번 인재원에 묻는다.
 * 학생 상세 자체가 이미 담당 학생 게이트(canViewStudentDetail)를 지난 뒤라 스코프를 다시 계산하지 않는다(getJjAccess).
 *
 * 2026-09-11(사용자 *"anki 한장짜리 학습분석지 … aywa식"*): 숫자 다섯 칸 → **학습 분석지**(학부모 카드와 같은 조각,
 * `layout="wide"`) · 기간 7·30·90일(주소 `jjFrom`·`jjTo` — 성적관리 JJ실이 같은 기간을 싣고 넘어온다) ·
 * 최근 시험 표의 시험 이름 → 그 시험 전체 결과, '결과지' → 응시 한 건의 시험 결과지.
 * 🔑 두 덩어리의 기간이 다르다 — 위 분석지는 **고른 기간(학습일)**, 아래 시험 표는 **기간과 무관한 최근 시험**(설명서 2번).
 *    한 머리말 아래 두면 표도 그 기간짜리로 읽힌다(적대 리뷰 2026-09-10) → 덩어리마다 기간을 따로 적는다.
 * 🔴 조회가 실패해도 성적 탭 전체를 죽이지 않는다(getStudentJj는 던지지 않는다) — 이 구역에 한 줄로 알린다.
 */
import { JjRangeBar } from "@/features/ijw/components/jj-range-bar";
import { JjRecentExams } from "@/features/ijw/components/jj-recent-exams";
import { JjStudySheet } from "@/features/ijw/components/jj-study-sheet";
import { JJ_STUDY_MAX_DAYS, ijwStudyDay, resolveJjRange } from "@/features/ijw/range";
import { ijwConfigFor } from "@/features/ijw/server/client";
import { getJjAccess, getJjViewer, getStudentJj } from "@/features/ijw/server/queries";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { JjUnlinkButton } from "./jj-unlink-button";

const EXAM_LIMIT = 10;
const STUDY_DAYS = 30;
/** 기간을 바꿔도 이 구역으로 돌아오게(주소만 바뀌면 페이지 맨 위로 튄다). */
const ANCHOR = "jj-study";

/**
 * 시험 창·결과지를 **열 수 있는가** — 그 창들의 게이트와 같은 판정(성적관리 열람 + 영어 담당 + 스코프 성공,
 * 결과지는 이 학생이 스코프 안). 학생 상세 게이트만 지난 사람에게 404로 가는 링크를 달지 않는다(적대 리뷰 2026-09-11).
 */
async function jjLinkRights(studentId: string): Promise<{ deck: boolean; attempt: boolean }> {
  const [viewer, user] = await Promise.all([getJjViewer(), getCurrentUser()]);
  if (!viewer || !user || !viewer.hasEnglish || viewer.scopeFailed) return { deck: false, attempt: false };
  if ((await accessLevelTenant(user.systemRole, "exams")) === "none") return { deck: false, attempt: false };
  return { deck: true, attempt: !viewer.teacherStudentIds || viewer.teacherStudentIds.has(studentId) };
}

export async function StudentJjSection({
  studentId,
  jjFrom,
  jjTo,
}: {
  studentId: string;
  jjFrom?: string;
  jjTo?: string;
}) {
  const access = await getJjAccess();
  if (!access || !ijwConfigFor(access.tenantId)) return null;
  // 학습 기간은 **학습일**로 잡는다 — 자정~03시 KST엔 달력 '오늘'이 아직 시작 안 한 학습일이다.
  const today = ijwStudyDay();
  const range = resolveJjRange({ from: jjFrom, to: jjTo }, { today, defaultDays: STUDY_DAYS, maxDays: JJ_STUDY_MAX_DAYS });
  const [data, links] = await Promise.all([
    getStudentJj(access.tenantId, studentId, range.from, range.to),
    jjLinkRights(studentId),
  ]);
  if (data.state === "unlinked") return null;
  if (data.state === "error") {
    return (
      <section id={ANCHOR} className="border-border scroll-mt-4 border-t pt-4">
        <p className="border-amber/40 bg-amber-soft text-amber rounded-xl border px-3 py-2 text-xs" title={data.failed.detail}>
          JJ실 학습 — {data.failed.message}
        </p>
      </section>
    );
  }
  const exams = data.exams.slice(0, EXAM_LIMIT);
  return (
    <section id={ANCHOR} className="border-border scroll-mt-4 space-y-3 border-t pt-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-foreground text-sm font-bold">
          JJ실 학습 <span className="text-text-faint text-xs font-medium">인재원 계정 {data.ijwId}</span>
        </h3>
        {access.canLink ? <JjUnlinkButton studentId={studentId} /> : null}
      </header>
      {data.failed ? (
        <p className="border-amber/40 bg-amber-soft text-amber rounded-xl border px-3 py-2 text-xs" title={data.failed.detail}>
          {data.failed.message}
        </p>
      ) : null}
      {/* 기간을 바꿔도 **이 탭**으로 돌아온다 — 2026-09-21에 성적 탭에서 'SRS 성적' 탭으로 옮겼다.
          🔴 `?tab=grades`로 두면 기간 칩을 누를 때마다 성적 탭으로 튕겨 이 구역이 사라진다. */}
      <JjRangeBar baseHref={`/students/${studentId}?tab=srs`} range={range} today={today} anchor={ANCHOR} />
      {data.study ? <JjStudySheet study={data.study} layout="wide" /> : null}
      {exams.length ? (
        <div className="space-y-1.5">
          <p className="micro">최근 본 시험 · 기간과 무관 · 최근 {exams.length}개</p>
          <JjRecentExams exams={exams} links={links} />
        </div>
      ) : data.failed ? null : (
        <p className="text-muted-foreground text-xs">인재원에서 본 시험이 아직 없습니다.</p>
      )}
    </section>
  );
}
