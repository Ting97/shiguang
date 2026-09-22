# identity · 身份与访问模块

> 路径：`apps/api/src/server/identity/` · 路由：`/api/auth/*` · 表：profiles / sessions / sms_codes / email_codes / login_attempts

## 一、业务介绍

身份与访问是全系统唯一的入口守护层，解决四个业务问题：

1. **注册受控**：产品以邀请制运营——新用户必须持有效邀请码注册，一码一人（用后作废），支持手机号与邮箱双身份。
2. **登录灵活**：每个账号可用「密码」或「验证码」两种方式登录；验证码通道（短信/邮箱）在服务端未配置时自动降级为「邀请码即凭证」，保证私有化部署零外部依赖可用。
3. **会话可信**：登录后签发 30 天会话；服务端只存 token 的 sha256（拖库不泄露凭证），支持滑动续期与全端吊销。
4. **防暴力破解**：登录接口是最大的攻击面，双层防护（IP 维度内存滑动窗口 + 身份维度 DB 持久锁定）保证账号不被字典攻击撞开。

## 二、功能与产品使用联动

| 用户可感知功能 | 使用方式 | 与其他模块的联动 |
|---|---|---|
| 注册 | 登录页「凭邀请码注册」：昵称 + 手机/邮箱 + 密码 + 邀请码（通道已配置时加验证码） | 注册成功自动播种 time 域九大活动分类（开箱即用）；邀请码状态由 platform 域管理 |
| 登录 | 密码或验证码；连续失败触发锁定（423），文案统一模糊不暴露账号是否存在 | 登录防护台账 login_attempts（本域 034 表）；响应中的 token 由前端自动入库 |
| 会话 | Cookie（Web 同域）+ Bearer token（Expo/壳）双通道；token 明文不落库 | 全部 API 域共用 getCurrentUser 深层校验；middleware 浅层门卫做页面跳转 |
| 个人设置（/profile） | 改昵称、改密码（从未设过密码可免填当前密码）；「全端登出」一键吊销所有设备 | 会话失效后 useSession 统一 401 跳登录（唯一跳转点） |
| 模块可见性 | /api/auth/me 返回 `modules`（debt/trade_review） | 驱动 finance 域二级 tab 条件渲染（listUserModules，实时查库撤销即生效） |
| 初始化 | 首次部署访问 /setup 创建管理员；SETUP_TOKEN 一次性令牌防护 | 继承 platform 的 DEV_USER_ID，存量数据零迁移 |

## 三、技术实现

### 数据模型
- `profiles`：用户主表（phone/email/password_hash/role/plan…），双身份唯一约束
- `sessions`：`token_hash`（sha256）+ user_id + expires_at + user_agent；滑动续期（剩余 <15 天续满 30 天）
- `login_attempts`（034）：identity + ip + success 台账，`(identity, created_at desc)` 索引支撑锁定统计
- `sms_codes` / `email_codes`：验证码 + purpose（login/bind）+ 消费标记

### 关键机制
- **登录双层防护**（`server/platform/security/login-guard.ts`）：IP 内存滑动窗口（15 分钟 20 次失败→封 15 分钟，单机假设）→ 身份 DB 层（30 分钟 20 次失败→423 锁定）。成功登录删除该身份全部失败记录（改对密码立刻能进）。`assertLoginAllowed` 抛 `LoginLockedError` → 路由转 423。
- **模糊文案**：账号不存在与密码错误返回同一句「手机号或密码不正确」，未命中账号同样计一次失败——不暴露账号存在性。
- **CSRF 协同**：Cookie 会话的写请求在 middleware 层强制 Origin/Sec-Fetch-Site 同源；登录/注册本身来自同源登录页，天然通过。
- **SETUP_TOKEN**（FR-C2.3）：`app_config.setup_token_used` 留痕，令牌被使用一次（无论成败）即永久失效。

### 代码结构
```
server/identity/
  schemas.ts   # login/register/profile/setup 的 zod 契约
  repo.ts      # profiles 全部 SQL（按身份查/改昵称/改密码/播种管理员…）
  service.ts   # login/logout/logoutAll/me/updateProfile/register/setup/sendSms/sendEmail
  auth.ts      # 会话签发/校验（getCurrentUser/createSession/destroySession）
  auth-crypto.ts  # 密码哈希校验、token 生成/哈希
  sms.ts / email.ts  # 验证码通道（60s 节流、日 10 条）
index.ts       # 对外面：export * from service/schemas
```
路由（`app/api/auth/*`）全部为 withAuth/withSchema 适配器，≤15 行。
