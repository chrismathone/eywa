import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { EyIcon } from "@/components/icons/aywa-icons";
import { PublicBrand } from "@/components/public-site/public-brand";
import styles from "@/components/public-site/public-site.module.css";
import { brandLabels, getPublicBranding } from "@/features/owner/server/public-branding";
import { resolveBrandingSrc } from "@/lib/storage/media-storage";
import { LoginForm } from "./login-form";

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
  const [params, branding] = await Promise.all([searchParams, getPublicBranding()]);
  const { academyLine, academyName } = brandLabels(branding);
  // Preserve deployment branding. Without a designated academy, show only AYWA.
  const logoSrc = branding
    ? await resolveBrandingSrc(branding.settings.profile.logoUrl, branding.tenantId)
    : null;
  const next = typeof params.next === "string" ? params.next : undefined;

  return (
    <div className={styles.site}>
      <a href="#login-content" className={styles.skipLink}>로그인으로 이동</a>
      <div className={styles.loginPage}>
        <aside className={styles.loginStory} aria-label="AYWA 소개">
          <PublicBrand />
          <div className={styles.loginStoryCopy}>
            <h2>가르치는 일에 집중하는<br />하루의 시작.</h2>
            <p>매일의 기록이 쌓이고, 함께하는 일이 이어지는 곳.<br />우리 학원의 하루를 AYWA와 함께하세요.</p>
          </div>
          <div className={styles.loginPhoto}>
            <Image src="/photos/login-panel.webp" alt="" fill sizes="(max-width: 820px) 0px, 45vw" loading="eager" />
          </div>
        </aside>

        <main id="login-content" className={styles.loginMain}>
          <div className={styles.loginTop}>
            <div className={styles.mobileBrand}><PublicBrand /></div>
            <Link href="/"><EyIcon name="arrowLeft" size={15} />AYWA 소개</Link>
          </div>
          <div className={styles.loginContent}>
            <div className={styles.academyIdentity}>
              {logoSrc ? (
                // eslint-disable-next-line @next/next/no-img-element -- tenant logo uses a per-request signed URL
                <img src={logoSrc} alt="" />
              ) : <EyIcon name="building" size={18} />}
              <span>{academyName ? academyLine : "AYWA 학원 업무 공간"}</span>
            </div>
            <h1>로그인</h1>
            <p className={styles.loginIntro}>학원에서 발급받은 계정으로 접속해 주세요.<br />로그인하면 소속 학원의 업무 공간으로 연결됩니다.</p>
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
