import type { Metadata } from "next";
import Link from "next/link";
import { EyIcon } from "@/components/icons/aywa-icons";
import { landingDisplay } from "@/components/public-site/fonts";
import { PublicBrand } from "@/components/public-site/public-brand";
import styles from "@/components/public-site/public-site.module.css";
import { LoginForm } from "./login-form";
import { LoginVideo } from "./login-video";

export const metadata: Metadata = {
  title: "로그인 — AYWA",
  description: "학원에서 발급받은 계정으로 AYWA에 로그인하세요.",
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
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;

  return (
    <div className={`${styles.site} ${landingDisplay.variable}`}>
      <a href="#login-content" className={styles.skipLink}>로그인으로 이동</a>
      <div className={styles.loginPage}>
        <aside className={styles.loginStory} aria-label="AYWA 소개">
          <PublicBrand />
          <div className={styles.loginStoryCopy}>
            <h2>가르치는 일에 집중하는<br />하루의 시작.</h2>
            <p>매일의 기록이 쌓이고, 함께하는 일이 이어지는 곳.<br />우리 학원의 하루를 AYWA와 함께하세요.</p>
          </div>
          <div className={styles.loginPhoto}>
            <div className={styles.loginPhotoInner}>
              {/* 사진 대신 무음 영상(원장 2026-09-22). 포스터 = 영상 첫 장면. 폰 폭(≤820px)에선 패널째 숨는다. */}
              <LoginVideo src="/photos/login-panel.mp4" poster="/photos/login-panel-poster.webp" />
            </div>
          </div>
        </aside>

        <main id="login-content" className={styles.loginMain}>
          <div className={styles.loginTop}>
            <div className={styles.mobileBrand}><PublicBrand /></div>
            <Link href="/"><EyIcon name="arrowLeft" size={15} />AYWA 소개</Link>
          </div>
          <div className={styles.loginContent}>
            <div className={styles.loginWinBar} aria-hidden="true"><span /><span /><span />AYWA</div>
            <div className={styles.loginWinBody}>
              <h1>로그인</h1>
              <p className={styles.loginIntro}>학원에서 발급받은 계정으로 접속해 주세요.<br />로그인하면 소속 학원의 업무 공간으로 연결됩니다.</p>
              <LoginForm next={next} />
              <details className={styles.loginHelp}>
                <summary>계정이나 비밀번호 확인이 필요한가요?<EyIcon name="chevronDown" size={17} /></summary>
                <p>계정 발급과 비밀번호 재설정은 학원 원장 또는 시스템 담당자에게 요청해 주세요. 소속 학원이나 이용 권한이 맞지 않을 때도 담당자에게 확인할 수 있습니다.</p>
              </details>
            </div>
          </div>
          <p className={styles.loginFootnote}>소속 학원과 계정 권한에 따라 이용 메뉴가 달라집니다.</p>
        </main>
      </div>
    </div>
  );
}
