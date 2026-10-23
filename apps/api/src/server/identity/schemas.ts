/** identity 域 zod 契约（REQ-004 FR-B1.2） */
import { z } from "zod";

// 邮箱长度上限 254（RFC 5321 前向/域名合计上限）：无上限的超长串直插 email_codes.email
// 并参与 hashtext advisory lock，是未认证滥用面（二十轮）。格式校验仍在 service isValidEmail。
const emailField = z.string().max(254).optional();

export const loginSchema = z
  .object({
    phone: z.string().optional(),
    email: emailField,
    // 上限 128（对齐 updateProfile）：多 MB 密码串直进 scryptSync 是未认证 CPU/内存放大面
    password: z.string().max(128).optional(),
    smsCode: z.string().optional(),
    emailCode: z.string().optional(),
  })
  .refine((v) => Boolean(v.phone || v.email), { message: "手机号或邮箱必填" });

export const registerSchema = z.object({
  phone: z.string().optional(),
  email: emailField,
  password: z.string().min(1).max(128).optional(),
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
  // 用户在授权弹窗里同意的资料（可选）：昵称用于自动建号；拒绝授权则用默认昵称
  profile: z
    .object({
      nickname: z.string().trim().min(1).max(30).optional(),
    })
    .optional(),
});
