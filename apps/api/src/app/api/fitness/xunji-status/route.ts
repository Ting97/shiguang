import { NextResponse } from "next/server";
import { withModule } from "@/server/platform/http/route";
import { fitnessService } from "@/server/fitness";

/** GET /api/fitness/xunji-status —— 训记集成是否已配置（前端控制同步按钮显隐） */
export const GET = withModule("fitness", async () => {
  return NextResponse.json(fitnessService.xunjiEnabled());
});
