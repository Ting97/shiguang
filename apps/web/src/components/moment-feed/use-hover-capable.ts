"use client";

import { useEffect, useState } from "react";

/** 当前环境是否支持 hover（桌面精确指针）。触摸设备返回 false——识别行图标不显示，点行走菜单。
 * SSR/首帧按支持 hover 处理（图标本就 hover 才显示，首帧不闪），effect 内修正避免水合不一致。 */
export function useHoverCapable(): boolean {
  const [ok, setOk] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setOk(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return ok;
}
