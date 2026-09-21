"use client";

import { useEffect } from "react";

/** 「邀请」已收进个人设置页（管理员区块）：旧地址跳转到 /profile */
export default function InvitesRedirectPage() {
  useEffect(() => {
    location.replace("/profile");
  }, []);
  return null;
}
