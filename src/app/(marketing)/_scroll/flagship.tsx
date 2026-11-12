import Image from "next/image";
import Link from "next/link";
import { DashMock } from "./dash-mock";
import { FlagshipMotion } from "./flagship-motion";

const products = [
  {
    name: "에이와", label: "학원 운영", image: null, width: 1440, height: 900,
    description: "출결과 시간표를 관리하고, 상담 기록과 수납 현황을 확인합니다.",
    tags: ["출석 · 시간표", "상담 기록", "수납 관리"], href: "#menus", site: "www.aywa.co.kr",
  },
  {
    name: "부원장AI", label: "콘텐츠 제작", image: "/landing/flagship/deputy-home-demo.webp", width: 1380, height: 1140,
    description: "블로그 글과 발표 자료, 홍보 영상과 이미지를 만들고 리서치를 돕습니다.",
    tags: ["블로그 · PPT", "영상 · 이미지", "리서치"], href: "https://부원장.kr", site: "부원장.kr",
  },
  {
    name: "인재원SRS", label: "학생 학습", image: "/landing/flagship/srs-learn-demo.webp", width: 1516, height: 1037,
    description: "어휘를 직접 입력해 학습하고 복습합니다. 학습 기록도 볼 수 있습니다.",
    tags: ["어휘 학습", "복습", "학습 기록"], href: "https://injaewon.vercel.app/", site: "injaewon.vercel.app",
  },
] as const;

/** 실제 학원 정보가 없는 랜딩 전용 화면. 에이와는 이미지 대신 최신 운영실 모양의 HTML 모형(`DashMock`). */
function ProductScreen({ image, name, width, height, eager = false }: { image: string | null; name: string; width: number; height: number; eager?: boolean }) {
  const alt = `${name} 화면 구성 예시, 표시된 데이터는 가상입니다`;
  return <div className="flag-screen">
    <div className="flag-screen-head"><b>{name}</b><span>예시 화면 · 가상 데이터</span></div>
    {image
      ? <Image src={image} alt={alt} width={width} height={height} loading={eager ? "eager" : "lazy"} sizes="(min-width: 1200px) 48vw, 90vw" />
      : <div className="dmk-wrap" role="img" aria-label={alt}><DashMock compact={eager} /></div>}
  </div>;
}

/**
 * 제품 이름 워드마크(원장 11-10 *"타이포그라피처럼 멋지게 … 로고 같은 디자인"*) — 이미지 대신 읽히는 글자 + CSS.
 * 셋 다 아주 굵은 한글 · 좁은 자간이 공통이고, 구별 장치는 하나씩만(Codex 협의: 제품마다 장식을 다 붙이면 배지 모음처럼 보인다):
 * 에이와 = 라임 네모 · 부원장AI = 'AI'만 반전 · 인재원SRS = 'SRS'만 가는 굵기.
 */
function Wordmark({ index }: { index: number }) {
  if (index === 0) return <h2 className="flag-wm wm-aywa">에이와<i aria-hidden="true" /></h2>;
  if (index === 1) return <h2 className="flag-wm wm-deputy">부원장<span>AI</span></h2>;
  return <h2 className="flag-wm wm-srs">인재원<span>SRS</span></h2>;
}

export function FlagshipHero() {
  return <section className="flag-hero" aria-labelledby="flag-title">
    <Image className="flag-hero-art" src="/landing/flagship/flagship-product-yellow.webp" alt="" fill fetchPriority="high" loading="eager" sizes="100vw" />
    <div className="flag-hero-shade" />
    <div className="flag-hero-content">
      <p className="flag-overline">원장을 위한 세 가지 제품</p>
      <h1 id="flag-title">운영의<br /><span>판을 바꾸다.</span></h1>
      <p className="flag-lead">학원 운영은 <b className="em-key">에이와</b>, 홍보 콘텐츠는 <b className="em-key">부원장AI</b>,<br />학생 어휘 학습은 <b className="em-key">인재원SRS</b>에서.</p>
      <div className="flag-hero-actions"><a href="#showroom" className="flag-button">제품 살펴보기</a><Link href="/login" className="flag-login">에이와 로그인</Link></div>
    </div>
    <div className="flag-hero-preview"><ProductScreen image={products[0].image} name="에이와" width={products[0].width} height={products[0].height} eager /></div>
    <span className="flag-art-note">AI 생성 콘셉트 이미지</span>
  </section>;
}

export function FlagshipShowroom() {
  return <>
    <div className="flag-marquee" aria-hidden="true"><span>에이와</span><i>/</i><span>학원 운영</span><i>/</i><span>부원장AI</span><i>/</i><span>콘텐츠 제작</span><i>/</i><span>인재원SRS</span><i>/</i><span>어휘 학습</span></div>
    <section className="flag-story"><p>학원에서 <strong className="em-rule">매일 쓰는 화면</strong>을<br />예시로 보여 드립니다.</p><span>화면 속 학생 이름과 숫자는 모두 가상 예시입니다.</span></section>
    <section id="showroom" className="flag-showroom" aria-label="제품 쇼룸">
      <div className="flag-showroom-sticky"><div className="flag-track">
        {products.map((product, index) => <article className={`flag-slide flag-slide-${index}`} key={product.name}>
          <div className="flag-slide-top"><span>제품 살펴보기</span><span>0{index + 1} / 03</span></div>
          <div className="flag-slide-main"><div className="flag-product-copy">
            <p>{product.label}</p><Wordmark index={index} /><p>{product.description}</p>
            <div className="flag-tags">{product.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
            <a href={product.href} {...(index > 0 ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{index === 0 ? "에이와 기능 보기" : "공식 사이트 보기"} ↗</a>
          </div><ProductScreen image={product.image} name={product.name} width={product.width} height={product.height} /></div>
          <div className="flag-slide-bottom"><span>{product.site}</span><span>{product.label}</span></div>
        </article>)}
      </div><div className="flag-progress"><i /></div></div>
    </section>
    <FlagshipMotion />
  </>;
}
