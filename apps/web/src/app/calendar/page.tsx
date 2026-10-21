"use client";

import { useEffect } from "react";

/** 「日历」已升级为「日程」模块：旧书签/缓存地址跳转到 /schedule（日历子页为默认 tab）。
 * 透传 ?date= 等参数：旧书签 /calendar?date=2026-10-21 保留直达某天的能力（schedule 页支持 ?date） */
export default function CalendarRedirectPage() {
  useEffect(() => {
    location.replace(`/schedule${window.location.search}`);
  }, []);
  return null;
}
