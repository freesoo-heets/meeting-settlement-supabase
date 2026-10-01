"use client";

import { useEffect } from "react";

/**
 * 게임 창이 열려 있는 동안 (특히 휴대폰)
 *  · 뒤 페이지 스크롤을 막는다 (그릴 때·끌 때 화면이 따라 움직이지 않게)
 *  · 키보드가 올라오면 '보이는 영역' 높이를 --vvh / --vvtop 으로 알려준다
 *    → CSS 가 게임 창을 그 높이에 맞춰 줄여서 키보드가 화면을 가리지 않는다
 */
export function useGameViewport() {
  useEffect(() => {
    const body = document.body;
    const root = document.documentElement;
    const prevOverflow = body.style.overflow;
    const prevOverscroll = body.style.overscrollBehavior;
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";

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
      body.style.overflow = prevOverflow;
      body.style.overscrollBehavior = prevOverscroll;
      vv?.removeEventListener("resize", apply);
      vv?.removeEventListener("scroll", apply);
      window.removeEventListener("resize", apply);
    };
  }, []);
}
