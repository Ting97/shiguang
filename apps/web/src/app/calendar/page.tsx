"use client";

import { useEffect } from "react";

/** 「日历」已升级为「日程」模块：旧书签/缓存地址跳转到 /schedule（日历子页为默认 tab） */
export default function CalendarRedirectPage() {
  useEffect(() => {
    location.replace("/schedule");
  }, []);
  return null;
}
