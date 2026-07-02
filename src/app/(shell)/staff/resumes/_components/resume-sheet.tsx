import { EMPLOYMENT_TYPES, WORKDAYS, type StaffResumeData } from "@/features/staff/resume";

// 종이 서식("인재원 이력서") 레이아웃을 재현한 읽기 전용 시트 — 화면·A4 인쇄 공용(서버 렌더 가능).

// 인쇄(print:)는 A4 1장에 들어가게 압축 — 화면은 여유 있게(quote-doc 스코프 압축과 같은 취지).
const T = "w-full border-collapse text-[12px] leading-relaxed print:text-[11px] print:leading-snug";
const cell = "border-foreground/35 border px-2 py-1.5 align-middle print:py-1";
const head = `${cell} bg-bg-soft/70 text-center font-semibold whitespace-nowrap`;

// 빈 값도 종이처럼 칸 높이를 유지.
const V = (s: string) => s || " ";

function SectionHead({ children }: { children: React.ReactNode }) {
  return <h2 className="text-foreground mt-5 mb-1.5 text-[13px] font-bold print:mt-3 print:text-[12px]">{children}</h2>;
}

export function ResumeSheet({ data }: { data: StaffResumeData }) {
  const p = data.personal;
  const c = data.contract;
  const day = (k: string) => c.workDays.includes(k);
  return (
    <div className="resume-sheet border-foreground/60 bg-card text-foreground mx-auto w-full max-w-[780px] border-2 p-6 sm:p-8 print:border print:p-3">
      <h1 className="text-center text-[26px] font-bold tracking-[0.6em] print:text-[20px]">이력서</h1>

      <SectionHead>1. 인적사항</SectionHead>
      <table className={T}>
        <tbody>
          <tr>
            <th className={`${head} w-28`}>성명</th>
            <td className={cell}>{V(p.name)}</td>
            <th className={`${head} w-28`}>영문</th>
            <td className={cell}>{V(p.nameEn)}</td>
          </tr>
          <tr>
            <th className={head}>주민등록번호</th>
            <td className={`${cell} num`} colSpan={3}>{V(p.residentId)}</td>
          </tr>
          <tr>
            <th className={head}>주소</th>
            <td className={cell} colSpan={3}>{V(p.address)}</td>
          </tr>
          <tr>
            <th className={head}>전화번호</th>
            <td className={`${cell} num`}>{V(p.phone)}</td>
            <th className={head}>E-mail</th>
            <td className={cell}>{V(p.email)}</td>
          </tr>
        </tbody>
      </table>

      <SectionHead>2. 학력사항</SectionHead>
      <table className={T}>
        <thead>
          <tr>
            <th className={`${head} w-36`}>재학 기간</th>
            <th className={head}>학교명</th>
            <th className={head}>전공</th>
            <th className={`${head} w-16`}>학점</th>
            <th className={head}>소재지</th>
          </tr>
        </thead>
        <tbody>
          {data.education.map((r, i) => (
            <tr key={i}>
              <td className={`${cell} num text-center`}>{V(r.period)}</td>
              <td className={cell}>{V(r.school)}</td>
              <td className={cell}>{V(r.major)}</td>
              <td className={`${cell} text-center`}>{V(r.gpa)}</td>
              <td className={cell}>{V(r.location)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <SectionHead>3. 경력사항</SectionHead>
      <table className={T}>
        <thead>
          <tr>
            <th className={head}>직장명</th>
            <th className={`${head} w-36`}>근무 기간</th>
            <th className={head}>담당 업무</th>
            <th className={`${head} w-24`}>월급여</th>
            <th className={head}>퇴직 사유</th>
          </tr>
        </thead>
        <tbody>
          {data.career.map((r, i) => (
            <tr key={i}>
              <td className={cell}>{V(r.company)}</td>
              <td className={`${cell} num text-center`}>{V(r.period)}</td>
              <td className={cell}>{V(r.duties)}</td>
              <td className={`${cell} num text-right`}>{V(r.salary)}</td>
              <td className={cell}>{V(r.leaveReason)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <SectionHead>4. 자격증 및 외국어 능력</SectionHead>
      <table className={T}>
        <thead>
          <tr>
            <th className={head}>자격증 취득사항</th>
            <th className={`${head} w-32`}>취득년월일</th>
            <th className={head}>발행처</th>
          </tr>
        </thead>
        <tbody>
          {data.certificates.map((r, i) => (
            <tr key={i}>
              <td className={cell}>{V(r.name)}</td>
              <td className={`${cell} num text-center`}>{V(r.date)}</td>
              <td className={cell}>{V(r.issuer)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className={`${T} mt-2`}>
        <thead>
          <tr>
            <th className={head}>외국어 능력</th>
            <th className={`${head} w-32`}>시험일</th>
            <th className={head}>점수/등급</th>
          </tr>
        </thead>
        <tbody>
          {data.languages.map((r, i) => (
            <tr key={i}>
              <td className={cell}>{V(r.name)}</td>
              <td className={`${cell} num text-center`}>{V(r.testDate)}</td>
              <td className={`${cell} text-center`}>{V(r.score)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <SectionHead>5. 계약사항</SectionHead>
      <table className={T}>
        <tbody>
          <tr>
            <th className={`${head} w-32`}>근무부서</th>
            <td className={cell} colSpan={3}>{V(c.department)}</td>
          </tr>
          <tr>
            <th className={head}>근무요일</th>
            <td className={cell} colSpan={3}>
              {WORKDAYS.map((d) => (
                <span key={d.key} className="mr-3 whitespace-nowrap">
                  {day(d.key) ? "☑" : "☐"} {d.label}
                </span>
              ))}
            </td>
          </tr>
          <tr>
            <th className={head}>급여 계약</th>
            <td className={cell} colSpan={3}>
              (월급) {c.salaryMonthly || "      "} &nbsp;&nbsp; (연봉){" "}
              {c.salaryAnnual || " "}
            </td>
          </tr>
          <tr>
            <th className={head}>근무형태</th>
            <td className={cell} colSpan={3}>
              {EMPLOYMENT_TYPES.map((t) => (
                <span key={t} className="mr-3 whitespace-nowrap">
                  {t === c.employmentType ? "■" : "□"} {t}
                </span>
              ))}
            </td>
          </tr>
          <tr>
            <th className={head}>계좌번호</th>
            <td className={`${cell} num`} colSpan={3}>
              {V(c.account)} {c.bank ? `(${c.bank})` : "(은행)"}
            </td>
          </tr>
          <tr>
            <th className={head}>입사일</th>
            <td className={`${cell} num`} colSpan={3}>{V(c.startDate)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
