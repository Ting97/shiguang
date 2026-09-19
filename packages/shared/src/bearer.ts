/**
 * Bearer 会话 token 解析（纯函数、零 Node 依赖——middleware 的 Edge 运行时也能引用）
 */

/**
 * 解析 Authorization 头中的 Bearer 会话 token（原生端认证通道）。
 * 仅接受 `Bearer <64位hex>`（generateSessionToken 的形态），其余返回 null。
 * scheme 按 RFC 大小写不敏感。
 */
export function extractBearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+([0-9a-fA-F]{64})$/i.exec(header.trim());
  return m ? m[1].toLowerCase() : null;
}
