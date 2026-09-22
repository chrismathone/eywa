import Link from "next/link";
import { redirect } from "next/navigation";
import { EyIcon } from "@/components/icons/aywa-icons";
import { ACCESS_FAQ, ACCESS_STEPS, PRODUCT_FEATURES, WORKSPACE_ROLES } from "@/data/marketing";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getPermMatrix } from "@/lib/auth/perm-matrix";
import { landingPath } from "@/lib/auth/teacher-home";
import styles from "@/components/public-site/public-site.module.css";
import { ProductPreview } from "./_components/product-preview";

export default async function LandingPage() {
  const user = await getCurrentUser();
  if (user) {
    const home = await landingPath(user.systemRole, await getPermMatrix());
    if (home !== "/") redirect(home);
  }

  return (
    <>
      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroCopy}>
          <p className={styles.intro}>학원을 위한 하나의 업무 공간</p>
          <h1 id="hero-title">학원의 하루를,<br />하나의 흐름으로.</h1>
          <p className={styles.heroDescription}>수업을 준비하고, 학생을 살피고, 운영을 마무리하는 일.<br className={styles.desktopBreak} /> 매일의 업무가 AYWA에서 이어집니다.</p>
          <div className={styles.heroActions}>
            <Link href="/login" className={styles.primaryLink}>로그인<EyIcon name="arrowRight" size={18} /></Link>
            <a href="#features" className={styles.textLink}>기능 살펴보기<EyIcon name="arrowDown" size={16} /></a>
          </div>
          <p className={styles.accountNote}>학원에서 발급받은 계정으로 이용하세요.</p>
        </div>
        <ProductPreview />
      </section>

      <div className={styles.scopeBand}>
        <p>수업에서 운영까지, 끊김 없이.</p>
        <div><span>수업과 출결</span><span>학생과 상담</span><span>수납과 행정</span><span>팀과 학원 운영</span></div>
      </div>

      <section id="features" className={styles.section} aria-labelledby="features-title">
        <div className={styles.sectionHeading}>
          <h2 id="features-title">매일 하는 일에,<br />꼭 맞는 도구.</h2>
          <p>각자 기록하던 업무를 연결해<br />우리 학원의 흐름을 함께 살펴보세요.</p>
        </div>
        <div className={styles.features}>
          {PRODUCT_FEATURES.map((feature) => (
            <article key={feature.title} className={styles.feature}>
              <EyIcon name={feature.icon} size={26} className={styles.featureIcon} />
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
              <span>{feature.tools}</span>
            </article>
          ))}
        </div>
      </section>

      <section id="workspace" className={styles.workspace} aria-labelledby="workspace-title">
        <div className={styles.workspaceHeading}>
          <span className={styles.workspaceMark}><EyIcon name="building" size={30} /></span>
          <h2 id="workspace-title">같은 학원,<br />각자의 일에 맞는 화면.</h2>
          <p>하나의 업무 공간 안에서<br />맡은 일에 필요한 정보부터 만납니다.</p>
          <a href="#guide" className={styles.textLink}>이용 방법 확인<EyIcon name="arrowRight" size={17} /></a>
        </div>
        <div className={styles.roles}>
          {WORKSPACE_ROLES.map((role) => (
            <article key={role.title}>
              <EyIcon name={role.icon} size={22} />
              <div><h3>{role.title}</h3><p>{role.description}</p></div>
            </article>
          ))}
          <p className={styles.roleNote}><EyIcon name="shield" size={16} />소속 학원과 계정 권한에 따라 이용 메뉴가 달라집니다.</p>
        </div>
      </section>

      <section id="guide" className={styles.section} aria-labelledby="guide-title">
        <div className={styles.sectionHeading}>
          <h2 id="guide-title">우리 학원에서<br />AYWA 이용하기.</h2>
          <p>이용 준비부터 계정 접속까지,<br />담당자와 함께 확인해 주세요.</p>
        </div>
        <ol className={styles.steps}>
          {ACCESS_STEPS.map((step, index) => (
            <li key={step.title}><span>{String(index + 1).padStart(2, "0")}</span><h3>{step.title}</h3><p>{step.description}</p></li>
          ))}
        </ol>
        <div className={styles.faq}>
          <h3>접속 전에 확인해 주세요</h3>
          <div>
            {ACCESS_FAQ.map((item) => (
              <details key={item.question}>
                <summary>{item.question}<EyIcon name="plus" size={18} /></summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.loginBand} aria-labelledby="login-band-title">
        <div><h2 id="login-band-title">오늘의 업무를 이어가세요.</h2><p>계정이 준비되어 있다면, 우리 학원의 AYWA로.</p></div>
        <Link href="/login" className={styles.primaryLink}>로그인<EyIcon name="arrowRight" size={18} /></Link>
      </section>
    </>
  );
}
