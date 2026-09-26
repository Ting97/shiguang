/** identity 域 zod 契约（REQ-004 FR-B1.2） */
import { z } from "zod";

export const loginSchema = z
  .object({
    phone: z.string().optional(),
    email: z.string().optional(),
    password: z.string().optional(),
    smsCode: z.string().optional(),
    emailCode: z.string().optional(),
  })
  .refine((v) => Boolean(v.phone || v.email), { message: "手机号或邮箱必填" });

export const registerSchema = z.object({
  phone: z.string().optional(),
  email: z.string().optional(),
  password: z.string().min(1).optional(),
  inviteCode: z.string().optional(),
  smsCode: z.string().optional(),
  emailCode: z.string().optional(),
  nickname: z.string().optional(),
});

export const profileSchema = z
  .object({
    nickname: z.string().optional(),
    currentPassword: z.string().optional(),
    newPassword: z.string().optional(),
  })
  .refine((v) => v.nickname !== undefined || v.newPassword !== undefined, {
    message: "没有可更新的字段",
  });

export const setupSchema = z.object({
  nickname: z.string().optional(),
  phone: z.string().optional(),
  password: z.string().optional(),
  setupToken: z.string().optional(),
});

export const wechatLoginSchema = z.object({
  // wx.login 返回的 code（5 分钟有效、单次消费），微信侧实际更短，这里只拦畸形
  code: z.string().min(1).max(512),
});

export const wechatBindSchema = z.object({
  // 登录时签发的一次性绑定票据（64hex）
  bindTicket: z.string().min(16).max(256),
  phone: z.string().min(1),
  smsCode: z.string().min(4).max(8),
});
