"use client";

import { useEffect } from "react";

/**
 * 게임 창이 열려 있는 동안 (특히 휴대폰 · 카카오톡 브라우저)
 *  · 페이지를 화면에 고정해 뒤가 스크롤되지 않게 한다
 *    (카톡 브라우저는 overflow:hidden 만으로는 안 막히고, 스크롤되면 도구막대가 숨었다 나타나며 화면이 들썩인다)
 *  · data-lock-scroll 이 붙은 곳(그림판·알까기 판)에서 시작한 터치는 페이지 전체에서 이동을 막는다
 *  · 키보드가 올라오면 '보이는 영역' 높이를 --vvh / --vvtop 으로 알려준다
 */
// ★ 페이지 고정은 '몇 개가 걸었는지' 세어서, 첫 번째가 걸 때 원래 모습을 기억하고 마지막이 풀 때만 되돌린다.
//   게임 창(GameHub) 안에 게임(오목 · 홀덤 …)이 들어 있어 둘 다 이 훅을 쓰는데,
//   게임 안에서 × 로 창을 통째로 닫으면 React 가 바깥(게임 창) 정리를 먼저 하고 안쪽(게임) 정리를 나중에 한다.
//   예전에는 각자 '자기가 걸 때 모습' 을 기억해 되돌렸으므로, 마지막에 게임이 '고정된 모습' 으로 되돌려
//   게임을 하고 나면 페이지가 스크롤되지 않았다 (2026-11-12)
let lockCount = 0;
let lockSaved: {
  scrollY: number;
  overflow: string;
  position: string;
  top: string;
  width: string;
  overscroll: string;
  rootOverscroll: string;
} | null = null;

function lockPage() {
  lockCount += 1;
  if (lockCount > 1) return;
  const body = document.body;
  const root = document.documentElement;
  const scrollY = window.scrollY;
  lockSaved = {
    scrollY,
    overflow: body.style.overflow,
    position: body.style.position,
    top: body.style.top,
    width: body.style.width,
    overscroll: body.style.overscrollBehavior,
    rootOverscroll: root.style.overscrollBehavior,
  };
  body.style.overflow = "hidden";
  body.style.position = "fixed";
  body.style.top = `-${scrollY}px`;
  body.style.width = "100%";
  body.style.overscrollBehavior = "none";
  root.style.overscrollBehavior = "none";
}

function unlockPage() {
  if (lockCount <= 0) return;
  lockCount -= 1;
  if (lockCount > 0 || !lockSaved) return;
  const body = document.body;
  const root = document.documentElement;
  const saved = lockSaved;
  lockSaved = null;
  body.style.overflow = saved.overflow;
  body.style.position = saved.position;
  body.style.top = saved.top;
  body.style.width = saved.width;
  body.style.overscrollBehavior = saved.overscroll;
  root.style.overscrollBehavior = saved.rootOverscroll;
  window.scrollTo(0, saved.scrollY);
}

export function useGameViewport() {
  useEffect(() => {
    const root = document.documentElement;
    lockPage();

    // 그림판·알까기 판에서 시작한 손가락 움직임은 어디로 가든 화면을 움직이지 않게
    let locked = false;
    const onStart = (event: TouchEvent) => {
      const target = event.target as Element | null;
      locked = !!target?.closest?.("[data-lock-scroll='true']");
      if (locked) event.preventDefault();
    };
    const onMove = (event: TouchEvent) => {
      if (locked) event.preventDefault();
    };
    const onEnd = () => {
      locked = false;
    };
    document.addEventListener("touchstart", onStart, { passive: false });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onEnd);

    const vv = window.visualViewport;
    const apply = () => {
      const height = vv ? vv.height : window.innerHeight;
      const top = vv ? vv.offsetTop : 0;
      root.style.setProperty("--vvh", `${Math.round(height)}px`);
      root.style.setProperty("--vvtop", `${Math.round(top)}px`);
    };
    apply();
    vv?.addEventListener("resize", apply);
    vv?.addEventListener("scroll", apply);
    window.addEventListener("resize", apply);

    return () => {
      unlockPage();
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
      vv?.removeEventListener("resize", apply);
      vv?.removeEventListener("scroll", apply);
      window.removeEventListener("resize", apply);
    };
  }, []);
}

/** 카카오톡 안의 브라우저인지 */
export function isKakaoInApp() {
  return typeof navigator !== "undefined" && /KAKAOTALK/i.test(navigator.userAgent);
}

/** 카톡 브라우저에서 지금 페이지를 기본 브라우저(크롬·사파리)로 연다 — 카톡이 지원하는 주소 형식 */
export function openInExternalBrowser() {
  window.location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(window.location.href)}`;
}
