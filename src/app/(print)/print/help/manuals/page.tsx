import { requireAccess } from "@/lib/auth/require-access";
import { getShellView } from "@/lib/auth/view-mode";
import { helpManualForTenant, helpManualOpens } from "@/features/help/access";
import { MANUALS } from "@/features/help/manuals";
import type { HelpGroup, HelpManual } from "@/features/help/types";
import { kstToday } from "@/lib/date-kst";
import { PrintManualActions } from "./print-actions";
import styles from "./manual-bundle.module.css";

export const metadata = { title: "전체 화면 설명서 — 에이와" };

const GROUP_ORDER: HelpGroup[] = ["창", "홈", "수업", "원생", "운영", "지원"];

function plain(text: string): string {
  return text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, slug: string, label?: string) => label ?? slug)
    .replace(/\*\*/g, "");
}

function ManualSection({ manual, number }: { manual: HelpManual; number: number }) {
  return (
    <article id={`manual-${manual.slug}`} className={styles.chapter}>
      <div className={styles.chapterTop}><span>{String(number).padStart(2, "0")} / {manual.group}</span><span>에이와 SCREEN GUIDE</span></div>
      <h2>{manual.title}</h2>
      <p className={styles.summary}>{plain(manual.summary)}</p>
      <h3>화면 사용 안내</h3>
      <ol className={styles.steps}>
        {manual.callouts.map((item) => (
          <li key={`${item.n}-${item.label}`}>
            <span className={styles.stepNumber}>{item.n}</span>
            <div><strong>{item.label}</strong><p>{plain(item.body)}</p></div>
          </li>
        ))}
      </ol>
      {manual.faces?.map((face) => (
        <section key={face.title} className={styles.face}>
          <h3>{face.title}</h3>
          <p>{plain(face.summary)}</p>
          {face.callouts.length ? <ol className={styles.steps}>
            {face.callouts.map((item) => (
              <li key={`${face.title}-${item.n}-${item.label}`}>
                <span className={styles.stepNumber}>{item.n}</span>
                <div><strong>{item.label}</strong><p>{plain(item.body)}</p></div>
              </li>
            ))}
          </ol> : null}
        </section>
      ))}
      <p className={styles.chapterFoot}>화면: {manual.href}</p>
    </article>
  );
}

export default async function ManualBundlePage() {
  const [user, view] = await Promise.all([requireAccess("help"), getShellView()]);
  const opens = await Promise.all(MANUALS.map((manual) => helpManualOpens(manual, user.systemRole, view)));
  const visible = await Promise.all(MANUALS.filter((_, index) => opens[index]).map((manual) => helpManualForTenant(manual, user.tenantId)));
  const groups = [...GROUP_ORDER, ...new Set(visible.map((manual) => manual.group).filter((group) => !GROUP_ORDER.includes(group)))];
  const manuals = groups.flatMap((group) => visible.filter((manual) => manual.group === group));
  const referenceDate = kstToday();

  return <>
    <PrintManualActions />
    <main className={`${styles.book} print-portrait`}>
      <section className={styles.cover}>
        <div className={styles.brand}>에이와 <span>USER MANUAL</span></div>
        <div className={styles.coverTitle}>
          <p>학원 운영 화면 안내</p>
          <h1>전체 화면 설명서</h1>
          <div className={styles.coverRule} />
          <p className={styles.coverSub}>업무 흐름에 따라 화면을 찾아보고, 각 버튼의 쓰임을 확인할 수 있습니다.</p>
        </div>
        <div className={styles.coverMeta}>
          <p><strong>자료 기준일</strong><span>{referenceDate}</span></p>
          <p><strong>수록 화면</strong><span>{manuals.length}개</span></p>
          <p>표시된 기준일에 앱에 수록된 설명서 내용을 묶었습니다.</p>
        </div>
      </section>

      <section className={styles.toc}>
        <div className={styles.sectionEyebrow}>CONTENTS</div>
        <h2>목차</h2>
        <p>업무군별로 정리했습니다. PDF의 항목을 누르면 해당 설명으로 이동합니다.</p>
        <div className={styles.tocColumns}>
          {groups.map((group) => {
            const items = manuals.filter((manual) => manual.group === group);
            return items.length ? <div key={group} className={styles.tocGroup}>
              <h3>{group}</h3>
              {items.map((manual) => <a key={manual.slug} href={`#manual-${manual.slug}`}>
                <span>{String(manuals.indexOf(manual) + 1).padStart(2, "0")}</span>{manual.title}
              </a>)}
            </div> : null;
          })}
        </div>
      </section>

      {manuals.map((manual, index) => <ManualSection key={manual.slug} manual={manual} number={index + 1} />)}

      <section className={styles.end}>
        <div className={styles.sectionEyebrow}>END OF GUIDE</div>
        <h2>업무 중에도 바로 찾아보세요.</h2>
        <p>앱의 <strong>도움말</strong>에서 화면 설명서와 자주 묻는 질문을 검색할 수 있습니다.</p>
        <p>화면을 보는 중에는 <strong>F1</strong>을 눌러 해당 화면의 설명을 확인하세요.</p>
        <div className={styles.endRule} />
        <small>에이와 · 전체 화면 설명서 · 자료 기준일 {referenceDate}</small>
      </section>
    </main>
  </>;
}
