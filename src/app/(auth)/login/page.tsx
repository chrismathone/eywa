import type { Metadata } from "next";
import Link from "next/link";
import { EyIcon } from "@/components/icons/aywa-icons";
import { PublicBrand } from "@/components/public-site/public-brand";
import styles from "@/components/public-site/public-site.module.css";
import { LoginForm } from "./login-form";
import { LoginVideo } from "./login-video";

export const metadata: Metadata = {
  title: "로그인 — 에이와",
  description: "학원에서 발급받은 계정으로 에이와에 로그인하세요.",
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  // 🔴 학원·지점 표기(로고·"인재원 · 침산")를 두지 않는다 — 원장 2026-09-22 *"로그인 페이지에는 지점과 관련된거 전부
  //    삭제하고 그냥 로그인만. 어차피 로그인하면 지점 보일텐데"*. 로그인 전엔 누가 어느 지점인지 모르니 한 지점을
  //    보여 주면 다른 지점 직원에게 남의 이름이 선다. 지점은 로그인 뒤 셸(사이드바)이 그 계정의 학원 설정으로 보인다.
  // 구성은 오늘 낮 판(ee7cc124) 그대로 — 원장 같은 날 저녁 *"이전 이 로그인이 좋고 색감만 좀 바꾸면 될거같고"*.
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;

  return (
    <div className={styles.site}>
      <a href="#login-content" className={styles.skipLink}>로그인으로 이동</a>
      <div className={styles.loginPage}>
        <aside className={styles.loginStory} aria-label="에이와 소개">
          {/* 🔴 영상이 패널 전체다 — 글은 그 위에 얹는다(원장 2026-09-23 *"영상 위에 글자 적어도 되니까 영상을 부각시켜"*).
              포스터 = 영상 첫 장면. 폰 폭(≤820px)에선 패널째 숨고 주소도 안 넣는다. */}
          <LoginVideo src="/photos/login-panel.mp4" poster="/photos/login-panel-poster.webp" />
          <div className={styles.loginStoryScrim} aria-hidden="true" />
          <div className={styles.loginStoryInner}>
            <PublicBrand />
            <div className={styles.loginStoryCopy}>
              <h2>가르치는 일에 집중하는<br />하루의 시작.</h2>
              <p>매일의 기록이 쌓이고, 함께하는 일이 이어지는 곳.<br />우리 학원의 하루를 에이와와 함께하세요.</p>
            </div>
          </div>
        </aside>

        <main id="login-content" className={styles.loginMain}>
          <div className={styles.loginTop}>
            <div className={styles.mobileBrand}><PublicBrand /></div>
            <Link href="/"><EyIcon name="arrowLeft" size={15} />에이와 소개</Link>
          </div>
          <div className={styles.loginContent}>
            <h1>로그인</h1>
            <p className={styles.loginIntro}>발급받은 계정으로 접속해 주세요.<br />로그인하면 계정 권한에 맞는 업무 공간으로 연결됩니다.</p>
            <LoginForm next={next} />
            <details className={styles.loginHelp}>
              <summary>계정이나 비밀번호 확인이 필요한가요?<EyIcon name="chevronDown" size={17} /></summary>
              <p>계정 발급과 비밀번호 재설정은 학원 원장 또는 시스템 담당자에게 요청해 주세요. 소속 학원이나 이용 권한이 맞지 않을 때도 담당자에게 확인할 수 있습니다.</p>
            </details>
          </div>
          <p className={styles.loginFootnote}>소속 학원과 계정 권한에 따라 이용 메뉴가 달라집니다.</p>
        </main>
      </div>
    </div>
  );
}
