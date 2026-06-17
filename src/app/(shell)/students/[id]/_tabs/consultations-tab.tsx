import Link from "next/link";
import { getStudentConsultationHistory } from "@/features/students/server/queries";

const CATEGORY_LABEL: Record<string, string> = {
  general: "일반",
  academic: "학습/성적",
  emotional: "정서/심리",
  career: "진로",
  social: "교우관계",
  other: "기타",
};

const AUDIENCE_LABEL: Record<string, string> = {
  parent: "학부모",
  student: "학생",
  both: "학부모+학생",
};

type Consult = Awaited<ReturnType<typeof getStudentConsultationHistory>>[number];

const CAP = 15;

export async function ConsultationsTab({ studentId }: { studentId: string }) {
  const consults = await getStudentConsultationHistory(studentId);
  const visible = consults.slice(0, CAP);
  const rest = consults.slice(CAP);

  return (
    <div className="space-y-4">
      <header className="border-border flex items-baseline justify-between border-b pb-3">
        <h2 className="text-foreground text-base font-semibold">
          상담 이력
          {consults.length > 0 ? (
            <span className="text-muted-foreground num ml-2 text-xs font-normal">{consults.length}건</span>
          ) : null}
        </h2>
        <Link
          href={`/consultations/new?studentId=${studentId}`}
          className="text-chart-1 hover:underline text-xs"
        >
          + 새 상담 기록
        </Link>
      </header>

      {consults.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">상담 기록이 없습니다</p>
      ) : (
        <>
          <ul className="space-y-3">
            {visible.map((c) => (
              <ConsultItem key={c.id} c={c} />
            ))}
          </ul>
          {rest.length > 0 ? (
            <details className="group">
              <summary className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft mt-3 cursor-pointer list-none rounded-md border py-2 text-center text-xs transition">
                + {rest.length}건 더 보기
              </summary>
              <ul className="mt-3 space-y-3">
                {rest.map((c) => (
                  <ConsultItem key={c.id} c={c} />
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </div>
  );
}

function ConsultItem({ c }: { c: Consult }) {
  return (
    <li className="bg-card border-border space-y-2 rounded-md border px-4 py-3">
      <header className="flex flex-wrap items-baseline gap-3">
        <span className="num text-muted-foreground text-xs">
          {new Date(c.consultedAt).toLocaleDateString("ko-KR")}
        </span>
        {c.category ? (
          <span className="bg-chart-1/10 text-chart-1 border-chart-1/20 rounded-md border px-1.5 py-0.5 text-[10px] font-medium">
            {CATEGORY_LABEL[c.category] ?? c.category}
          </span>
        ) : null}
        {c.audience ? (
          <span className="text-muted-foreground text-[10px]">
            {AUDIENCE_LABEL[c.audience] ?? c.audience}
          </span>
        ) : null}
        {c.counselorName ? (
          <span className="text-muted-foreground text-[10px]">· {c.counselorName}</span>
        ) : null}
        <Link
          href={`/consultations/${c.id}/edit`}
          className="text-chart-1 ml-auto text-[11px] hover:underline"
        >
          수정
        </Link>
      </header>
      <p className="text-foreground text-sm leading-relaxed">{c.summary}</p>
      {c.followUpAction ? (
        <div className="border-border bg-bg-soft/40 rounded-sm border-l-2 border-l-chart-3 px-3 py-2 text-xs">
          <p className="text-muted-foreground">후속 조치</p>
          <p className="text-foreground mt-0.5">{c.followUpAction}</p>
          {c.followUpDate ? (
            <p className="text-muted-foreground num mt-0.5">
              예정일: {c.followUpDate}
              {c.followUpDone ? <span className="text-chart-2 ml-1">· 완료</span> : null}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
