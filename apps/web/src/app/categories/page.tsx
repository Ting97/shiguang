"use client";

import { useEffect } from "react";

/** 「分类」已迁移为「日程」模块的子页：旧书签/缓存地址跳转到 /schedule?tab=categories */
export default function CategoriesRedirectPage() {
  useEffect(() => {
    location.replace("/schedule?tab=categories");
  }, []);
  return null;
}
