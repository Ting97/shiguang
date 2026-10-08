/**
 * 协议页（REQ-登录页协议）：用户服务协议 / 隐私政策 二合一，router.params.doc 区分。
 * 独立轻容器（= 登录页形态：不挂 PageShell 底栏，自挂主题），从登录页勾选框书名号链接进入。
 */
import { useEffect, useState } from "react";
import { View, Text } from "@tarojs/components";
import Taro from "@tarojs/taro";
import LucideIcon from "@/components/lucide-icon";
import { syncNativeBackground, useTheme } from "@/lib/theme";
import "./index.scss";

interface DocSection {
  h: string;
  ps: string[];
}

const DOCS: Record<string, { title: string; updated: string; sections: DocSection[] }> = {
  service: {
    title: "用户服务协议",
    updated: "2026-10-08",
    sections: [
      {
        h: "一、协议说明",
        ps: [
          "拾光（以下简称「本应用」）是一款个人成长经营工具，帮助你把时间、目标、人际、财务放在一处统一记录与复盘。本协议是你与本应用运营者之间就使用本应用服务所订立的约定；你勾选同意或实际使用本应用，即视为已阅读并接受本协议全部内容。",
        ],
      },
      {
        h: "二、账号",
        ps: [
          "1. 你可通过微信一键登录或手机号/邮箱+密码方式创建及登录账号；登录即创建账号，无需额外绑定手机号。",
          "2. 你应妥善保管账号与密码，并对账号下的全部操作负责。发现账号被盗用时，可在「我的 → 会话安全」中全端登出并修改密码。",
        ],
      },
      {
        h: "三、用户内容与 AI 识别",
        ps: [
          "1. 你录入的动态、日程、待办、财务、人际等数据的所有权归你；本应用仅为提供存储、识别、统计与提醒等功能而处理这些数据。",
          "2. 一句话内容由 AI 识别引擎自动拆解登记，识别结果仅供参考，你随时可以修改或删除；重要数据请在识别后复核确认。",
          "3. 你承诺不录入法律法规禁止的内容；否则运营者有权暂停或终止对你提供服务。",
        ],
      },
      {
        h: "四、服务的变更与终止",
        ps: [
          "1. 本应用可能因迭代调整部分功能，重大变更会在应用内公告。",
          "2. 你可随时停止使用本应用；如需注销账号并删除全部数据，可通过应用内管理员渠道申请。",
        ],
      },
      {
        h: "五、免责声明",
        ps: [
          "1. 因不可抗力、网络故障、系统维护等原因导致服务中断或数据延迟的，运营者在合理限度内不承担责任。",
          "2. 请定期使用「我的 → 导出数据」备份重要记录。",
        ],
      },
    ],
  },
  privacy: {
    title: "隐私政策",
    updated: "2026-10-08",
    sections: [
      {
        h: "一、我们收集的信息",
        ps: [
          "1. 账号标识：微信一键登录时的微信用户标识（openid）、你填写的手机号或邮箱、昵称。",
          "2. 你主动录入的内容：动态文字与图片、日程与待办、财务流水、联系人及往来记录、目标与感悟等。",
          "3. 基础信息：登录状态、操作日志（用于排查故障与保障账号安全）。本应用不申请位置、通讯录等与功能无关的权限。",
        ],
      },
      {
        h: "二、信息的使用",
        ps: [
          "1. 所收集信息仅用于提供本应用功能：数据存储、AI 一句话识别、统计报表、生日与到期提醒、账号安全。",
          "2. AI 识别仅传输当次你输入的文字内容用于解析，不用于模型训练。",
        ],
      },
      {
        h: "三、信息的存储与保护",
        ps: [
          "1. 数据存储于运营者自有的应用服务器（腾讯云），全程 HTTPS 加密传输；会话凭证只存单向散列，可随时吊销。",
          "2. 我们不会向任何第三方出售或提供你的个人数据，法律法规另有规定的除外。",
        ],
      },
      {
        h: "四、你的权利",
        ps: [
          "1. 你可以随时在应用内查看、修改、删除自己的全部数据；删除动态会同步删除其识别产物。",
          "2. 你可以在「我的 → 导出数据」导出 JSON / Markdown 全量数据；如需彻底注销账号并删除服务器数据，可通过应用内管理员渠道申请。",
        ],
      },
      {
        h: "五、未成年人保护",
        ps: ["本应用面向个人经营场景，不面向未满 14 周岁的未成年人提供服务。"],
      },
    ],
  },
};

export default function Agreement() {
  const { theme } = useTheme();
  const [doc, setDoc] = useState<"service" | "privacy">("service");

  useEffect(() => {
    const p = Taro.getCurrentInstance().router?.params;
    if (p?.doc === "privacy") setDoc("privacy");
    else setDoc("service");
  }, []);
  useEffect(() => {
    syncNativeBackground(theme);
    Taro.setNavigationBarTitle({ title: DOCS[doc].title }).catch(() => undefined);
  }, [doc, theme]);

  const d = DOCS[doc];
  return (
    <View className={`app-bg agreement-screen${theme === "light" ? " theme-light" : ""}`}>
      <View className="agree-col">
        {/* 返回 + 标题 */}
        <View className="agree-head">
          <View className="agree-back" hoverClass="press" onClick={() => Taro.navigateBack().catch(() => Taro.reLaunch({ url: "/pages/login/index" }))}>
            <LucideIcon name="chevron_left" size={16} color="var(--ink-dim)" />
            <Text>返回</Text>
          </View>
          <Text className="agree-title">{d.title}</Text>
          <Text className="agree-updated">更新于 {d.updated}</Text>
        </View>

        {d.sections.map((sec) => (
          <View key={sec.h} className="glass glass-p4 agree-sec">
            <Text className="agree-sec-h">{sec.h}</Text>
            {sec.ps.map((p, i) => (
              <Text key={i} className="agree-p">{p}</Text>
            ))}
          </View>
        ))}

        <Text className="agree-foot">个人经营系统 · 钱 · 时间 · 人</Text>
      </View>
    </View>
  );
}
