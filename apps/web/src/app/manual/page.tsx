"use client";

import {
  CalendarDays,
  ListTodo,
  Mic,
  Sparkles,
  Star,
  Target,
  Users,
  User,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/**
 * 使用手册（REQ-使用手册）：面向用户的功能介绍与使用方式，蓝本 docs/11-使用手册.md，
 * 浓缩为结构化章节并覆盖双端入口差异。纯静态内容，无接口调用。
 */
interface Section {
  icon: LucideIcon;
  h: string;
  rows: string[];
  /** 章节配图（/manual/ 下静态截图，给用户直观指引） */
  img?: string;
}

const SECTIONS: Section[] = [
  {
    icon: Sparkles,
    h: "拾光是什么",
    rows: [
      "AI 个人经营系统：钱 · 时间 · 人。核心玩法就一条——随口说一句话，AI 自动识别其中的日程、待办、收支、心情、饮食，分别记进对应模块；你在各模块里查看、修正、复盘。",
      "网页端顶部导航：动态 / 目标 / 日程 / 人际 / 财务，点右上角头像进个人设置；小程序端为底部 6 标签，两端数据同源实时同步。",
    ],
  },
  {
    icon: Mic,
    h: "怎么记录一句话",
    img: "/manual/web-feed.png",
    rows: [
      "首页顶部输入框随口写一句（如「刚跑完步40分钟，心情不错」「明天下午三点看牙」「打车花了32块」），点发布或按 Enter（Shift+Enter 换行）。",
      "语音输入：按住输入框左下的话筒按钮说话，松开自动转成文字（最长 2 分钟）。音频不保存，转完即弃。",
      "发布后动态立刻上墙，AI 在后台做五域识别：🕒 日程 → 时间轴；📋 待办 → 待办清单；💰 收支 → 财务待确认流水；😊 心情 → 心情标签；🍽 饮食 → 饮食记录。识别置信度低的会标「待确认」，你点确认才生效。",
      "识别错了不用忍：动态卡上可逐项修改/删除，删除后各清单（含今日行动）会自动刷新。",
    ],
  },
  {
    icon: ListTodo,
    h: "今日行动与待办",
    rows: [
      "今日行动卡：首页里当天的行动清单，点卡片标题可收起/展开；输入框回车直接添加行动。",
      "点行首圆圈完成行动；行内菜单可编辑/删除；「今日已完成」区可恢复。",
      "完整待办管理（拆解子行动、每日重复、到期时间）在 日程 → todo 页。",
    ],
  },
  {
    icon: CalendarDays,
    h: "日程与日历",
    img: "/manual/web-schedule.png",
    rows: [
      "首页底部是今日日程时间轴；完整日历在 日程 页：日 / 周 / 月 / 年四种视图，周视图默认一周安排一屏可见。",
      "所有视图都能新增 / 编辑 / 删除日程，保存时自动做冲突检测。",
    ],
  },
  {
    icon: Target,
    h: "目标空间",
    img: "/manual/web-spaces.png",
    rows: [
      "目标 页为大目标建专属空间（考研上岸 / 副业过万…），把 TODO·行动、感悟和动态聚在一起，卡片展示 todo 进度、动态数与感悟数。",
      "空间详情里可以写感悟、看进度；相关动态自动归属。",
    ],
  },
  {
    icon: Users,
    h: "人际",
    img: "/manual/web-contacts.png",
    rows: [
      "人际 页有 列表 / 图谱 双视图：图谱以你为中心，联系人按重要程度（5 亲密 ~ 1 简单）分布在轨道上，可用鼠标/手指拖动摆位。",
      "联系人档案支持生日（阳历/农历）、纪念日、分组、备注；生日自动换算提醒（显示「N 天后生日」）。",
      "详情页汇集 TA 的往来时间线与关联人情账（送出为负、收到为正）。",
    ],
  },
  {
    icon: Wallet,
    h: "财务",
    img: "/manual/web-finance.png",
    rows: [
      "财务 页：本月收支/储蓄率概览、月度支出预算与预警、分类占比、账户管理。",
      "动态里说的钱先以「待确认流水」存在，确认入账后才算数——防止 AI 误识别污染账目；也可直接「记一笔」手动记账。",
    ],
  },
  {
    icon: User,
    h: "账户与设置",
    img: "/manual/web-profile.png",
    rows: [
      "登录：手机号/邮箱 + 密码；小程序端还支持微信一键登录，绑定的账号可补绑手机号、设置密码后登录网页版。",
      "个人设置：改昵称、改密码、主题切换（深色/浅色/跟随系统）、导出数据（JSON / Markdown）、全端登出。",
    ],
  },
  {
    icon: Star,
    h: "小贴士",
    rows: [
      "1. 想到就说：「今天」「刚」「明天待会儿」这类时间词是 AI 判断日程/待办的关键。",
      "2. 钱先草稿后入账：动态里说钱不会直接进账本。",
      "3. 待办不用填时间：手动新增只写标题即可。",
      "4. 搜索框支持按动态原文/日程/todo/金额/联系人检索。",
    ],
  },
];

export default function ManualPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-4 pb-16 pt-6">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-gradient">拾光 · 使用手册</h1>
        <p className="mt-2 text-xs text-ink-faint">随口说一句话，AI 帮你记进四本账</p>
      </div>

      {SECTIONS.map((sec) => (
        <section key={sec.h} className="glass mb-4 rounded-2xl p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
            <sec.icon size={15} className="text-accent" aria-hidden />
            {sec.h}
          </h2>
          {sec.rows.map((r, i) => (
            <p key={i} className="mb-2 text-xs leading-relaxed text-ink-dim last:mb-0">
              {r}
            </p>
          ))}
          {sec.img && (
            <img src={sec.img} alt={sec.h + " 界面截图"} loading="lazy" className="mt-3 w-full rounded-xl border border-line" />
          )}
        </section>
      ))}

      <footer className="mt-8 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-violet-500/15 px-2 py-0.5 text-[10px] text-ai">
          拾光 · 使用手册
        </span>
      </footer>
    </main>
  );
}
