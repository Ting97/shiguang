/**
 * 使用手册（REQ-使用手册）：面向用户的功能介绍与使用方式，蓝本 docs/11-使用手册.md
 * 浓缩为结构化章节，覆盖小程序端入口差异（底部 6 tab / 微信一键登录 / 语音长按）。
 * 独立轻容器（= 协议页形态：app-bg + 返回，不挂底部栏）。
 */
import { useEffect, useState } from "react";
import { View, Text, Image } from "@tarojs/components";
import Taro from "@tarojs/taro";
import LucideIcon from "@/components/lucide-icon";
import { syncNativeBackground, useTheme } from "@/lib/theme";
import { API_BASE } from "@/lib/request";
import "./index.scss";

interface Section {
  icon: string;
  h: string;
  rows: string[];
  /** 章节配图（服务端静态截图，Image 组件不走域名白名单） */
  img?: string;
}

const SECTIONS: Section[] = [
  {
    icon: "sparkles",
    h: "拾光是什么",
    rows: [
      "AI 个人经营系统：钱 · 时间 · 人。核心玩法就一条——随口说一句话，AI 自动识别其中的日程、待办、收支、心情、饮食，分别记进对应模块；你在各模块里查看、修正、复盘。",
      "小程序端底部 6 个标签：动态 / 目标 / 日程 / 人际 / 财务 / 我的，日常操作都在这几页。",
    ],
  },
  {
    icon: "mic",
    h: "怎么记录一句话",
    img: "/manual/mini-feed.png",
    rows: [
      "动态页右下悬浮钮点开输入框，随口写一句（如「刚跑完步40分钟，心情不错」「明天下午三点看牙」「打车花了32块」），点发布。",
      "语音输入：长按输入框下方的话筒按钮说话，松开自动转成文字（最长 30 秒，到时自动停止）。音频不保存，转完即弃。",
      "发布后动态立刻上墙，AI 在后台做五域识别：🕒 日程 → 时间轴；📋 待办 → 待办清单；💰 收支 → 财务待确认流水；😊 心情 → 心情标签；🍽 饮食 → 饮食记录。识别置信度低的会标「待确认」，你点确认才生效。",
      "识别错了不用忍：动态卡上可以逐项修改/删除，删除后各清单（含今日行动）会自动刷新。",
    ],
  },
  {
    icon: "list_todo",
    h: "今日行动与待办",
    rows: [
      "今日行动卡：动态页里当天的行动清单，点卡片可收起/展开；输入框回车直接添加行动。",
      "点行首圆圈完成行动，点行弹出编辑/删除菜单；「今日已完成」可恢复。",
      "完整待办管理（拆解子行动、每日重复、到期时间）在 日程 → todo 页。",
    ],
  },
  {
    icon: "calendar_days",
    h: "日程与日历",
    img: "/manual/mini-schedule.png",
    rows: [
      "动态页底部是今日日程时间轴；完整日历在 日程 页：日 / 周 / 月 / 年四种视图，周视图默认一周安排一屏可见。",
      "所有视图都能新增 / 编辑 / 删除日程，保存时自动做冲突检测。",
    ],
  },
  {
    icon: "target",
    h: "目标空间",
    img: "/manual/mini-spaces.png",
    rows: [
      "目标 页为大目标建专属空间（考研上岸 / 副业过万…），把 TODO·行动、感悟和动态聚在一起，卡片展示 todo 进度、动态数与感悟数。",
      "空间详情里可以写感悟、看进度；相关动态自动归属。",
    ],
  },
  {
    icon: "users",
    h: "人际",
    img: "/manual/mini-contacts.png",
    rows: [
      "人际 页有 列表 / 图谱 双视图：图谱以你为中心，联系人按重要程度分布在轨道上，可拖动摆位。",
      "联系人档案支持生日（阳历/农历）、纪念日、分组、备注；生日自动换算提醒（显示「N 天后生日」）。",
      "详情页汇集 TA 的往来时间线与关联人情账。",
    ],
  },
  {
    icon: "wallet",
    h: "财务",
    img: "/manual/mini-finance.png",
    rows: [
      "财务 页：本月收支/储蓄率概览、月度支出预算与预警、分类占比、账户管理。",
      "动态里说的钱先以「待确认流水」存在，确认入账后才算数——防止 AI 误识别污染账目；也可直接「记一笔」手动记账。",
    ],
  },
  {
    icon: "user",
    h: "账户与设置",
    img: "/manual/mini-profile.png",
    rows: [
      "登录：微信一键登录，或手机号/邮箱 + 密码；微信绑定的账号可在「我的」补绑手机号、设置密码后登录网页版。",
      "「我的」页：改昵称、改密码、切换深色/浅色主题、绑定微信、导出数据（JSON / Markdown）、全端登出。",
      "网页版与小程序数据同源，两端随时同步。",
    ],
  },
  {
    icon: "star",
    h: "小贴士",
    rows: [
      "1. 想到就说：「今天」「刚」「明天待会儿」这类时间词是 AI 判断日程/待办的关键。",
      "2. 钱先草稿后入账：动态里说钱不会直接进账本。",
      "3. 待办不用填时间：手动新增只写标题即可。",
      "4. 下拉动态页可刷新；搜索框支持按原文/日程/todo/金额/联系人检索。",
    ],
  },
];

export default function Manual() {
  const { theme } = useTheme();
  useEffect(() => {
    syncNativeBackground(theme);
  }, [theme]);

  return (
    <View className={`app-bg manual-screen${theme === "light" ? " theme-light" : ""}`}>
      <View className="manual-col">
        <View className="manual-head">
          <View
            className="manual-back"
            hoverClass="press"
            onClick={() => Taro.navigateBack().catch(() => Taro.reLaunch({ url: "/pages/feed/index" }))}
          >
            <LucideIcon name="chevron_left" size={16} color="var(--ink-dim)" />
            <Text>返回</Text>
          </View>
          <Text className="manual-title">拾光 · 使用手册</Text>
          <Text className="manual-sub">随口说一句话，AI 帮你记进四本账</Text>
        </View>

        {SECTIONS.map((sec) => (
          <View key={sec.h} className="glass glass-p4 manual-sec">
            <View className="manual-sec-h ico-row">
              <LucideIcon name={sec.icon as never} size={14} color="var(--accent)" />
              <Text className="manual-sec-h-text">{sec.h}</Text>
            </View>
            {sec.rows.map((r, i) => (
              <Text key={i} className="manual-row">{r}</Text>
            ))}
            {sec.img && (
              <Image
                src={API_BASE + sec.img}
                mode="widthFix"
                lazyLoad
                className="manual-shot"
              />
            )}
          </View>
        ))}

        <View className="manual-foot-wrap">
          <View className="chip manual-foot-chip">
            <LucideIcon name="sparkles" size={12} color="var(--ai)" />
            <Text>拾光 · 使用手册</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
