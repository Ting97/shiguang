"use client";

import { useEffect } from "react";

/** 「邀请」管理已迁入 /admin 后台（营销管理）：旧地址跳转 */
export default function InvitesRedirectPage() {
  useEffect(() => {
    location.replace("/admin");
  }, []);
  return null;
}
