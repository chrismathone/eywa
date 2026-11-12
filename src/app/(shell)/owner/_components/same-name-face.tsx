import { Pill } from "@/components/atoms/pill";
import { WindowLink } from "@/components/workspace/window-link";
import { findSameNameStudents, type SameNameStudentGroup } from "@/features/admin/server/queries";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { studentStatusMeta } from "@/features/students/status/status-labels";
import { phoneLabel } from "@/lib/format/phone";

/**
 * **같은 이름을 쓰는 학생** 섹션 — 데이터 정리 면(owner ?tab=data).
 *
 * 원장 지시(2026-08-20): *"데이터 정리에 이름 중복되는것도 확인가능하도록. 방금 이지호A가 둘이라서
 * 내가 한명을 이지호B로 교체함."*
 *
 * 🔴 **통합 버튼을 두지 않는다.** 동명이인은 **다른 사람**이라 통합하면(= 한쪽을 퇴원 처리하고 기록을
 *    옮긴다) 남의 수강·출결·수납이 통째로 이동한다. 이 섹션이 하는 일은 **알려주기**뿐이고, 개명은
 *    사람이 학생 상세에서 한다(자동으로 학생 기록을 바꾸는 경로는 만들지 않는다는 결정).
 * 🔑 그래서 **판단 근거를 나란히** 보인다 — 학교·학년·상태·수강 과목·학부모 연락처. 같은 사람이면
 *    위 '중복 의심'에서 통합하고, 다른 사람이면 이름을 구분한다(이지호A / 이지호B).
 * ⚠️ 평소엔 0건이다 — 0건 표시는 옆 섹션들과 **같은 모양**으로 둔다.
 */
export async function SameNameFace() {
  // 조회 헬퍼는 규약상 throw한다(B2/B3) — 그대로 새면 **데이터 정리 면 전체**가 죽어 고아 점검·중복
  // 의심까지 함께 사라진다. 이 섹션 안에서 한글 사유로 접는다.
  let groups: SameNameStudentGroup[] = [];
  let error: string | null = null;
  try {
    groups = await findSameNameStudents();
  } catch {
    error = "같은 이름 점검을 불러오지 못했습니다 — 잠시 후 다시 시도해 주세요";
  }
  const total = groups.length;

  return (
    <div className="space-y-4">
      <header className="border-border border-b pb-3">
        <p className="eyebrow">관리 · 이름 구분</p>
        <h2 className="text-foreground text-lg font-bold">
          같은 이름을 쓰는 학생
          {total > 0 ? (
            <span className="text-muted-foreground num ml-2 text-base font-normal">{total}건</span>
          ) : null}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          학교·학년이 달라 위 &lsquo;중복 의심&rsquo;에는 안 걸리지만 목록에서 이름이 똑같이 보이는
          학생들입니다. 같은 사람이면 위에서 통합하고, 다른 사람이면 학생 상세에서 이름을 구분해 주세요
          (예: 이지호A · 이지호B). 여기서 이름을 바꾸지는 않습니다.
        </p>
      </header>

      {error ? (
        <p className="text-danger py-12 text-center text-sm">{error}</p>
      ) : total === 0 ? (
        <p className="text-muted-foreground py-12 text-center text-sm">같은 이름을 쓰는 학생이 없습니다</p>
      ) : (
        <ul className="space-y-3">
          {groups.map((g) => (
            <li key={g.key} className="bg-card border-border rounded-md border p-4">
              <header className="mb-3 flex items-baseline justify-between">
                <h3 className="text-foreground text-sm font-bold">{g.name}</h3>
                <span className="text-muted-foreground num text-xs">{g.students.length}명</span>
              </header>
              <ul className="space-y-1.5">
                {g.students.map((s) => {
                  const meta = studentStatusMeta(s.status);
                  const where = schoolGradeLabel(s.school, s.grade);
                  return (
                    <li
                      key={s.id}
                      className="bg-bg-soft/30 border-border flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sm border px-3 py-1.5 text-xs"
                    >
                      {/* 이름은 창으로 — 이 화면의 다른 링크와 같은 방식(WindowLink 규약). */}
                      <WindowLink
                        href={`/students/${s.id}`}
                        title={s.name}
                        className="text-foreground hover:text-primary font-medium underline-offset-2 hover:underline"
                      >
                        {s.name}
                      </WindowLink>
                      <span className="text-muted-foreground">{where || "학교·학년 없음"}</span>
                      {meta ? (
                        <Pill color={meta.color}>{meta.label}</Pill>
                      ) : null}
                      <span className="text-muted-foreground">
                        {s.subjects.length > 0 ? s.subjects.join(" · ") : "수업 없음"}
                      </span>
                      <span className="text-muted-foreground num ml-auto">
                        {phoneLabel(s.parentPhone) || "연락처 없음"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
