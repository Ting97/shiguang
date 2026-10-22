import { NextResponse } from "next/server";
import { withModule } from "@/server/platform/http/route";
import { fitnessService } from "@/server/fitness";

/** GET /api/fitness/xunji-status —— 训记集成是否已配置（前端控制同步按钮显隐） */
export const GET = withModule("fitness", async (req, ctx) => {
  // 训记凭据为部署级运营者账号（sync/pull 路由已 admin 收口）：非管理员按钮直接不显示，
  // 避免点了才吃 403 的劣体验
  const { enabled } = fitnessService.xunjiEnabled();
  return NextResponse.json({ enabled: enabled && ctx.user.role === "admin" });
});
