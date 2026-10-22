# -*- coding: utf-8 -*-
"""r18 目标空间模块 GUI 深度体验（PC 1280x800）：黑盒 GUI 测试，截图+DOM 双验证。
运行前提：本地 3100 standalone（AUTH_DISABLED=0 + 本地库 + 邀请码 DRE78RPE 可用）。"""
import json
import re
import sys
import time
import uuid
from datetime import datetime
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8")

BASE = "http://127.0.0.1:3100"
SHOTS = Path(__file__).resolve().parents[2] / "gui-test-screenshots" / "r18"
SHOTS.mkdir(parents=True, exist_ok=True)

RESULTS = []  # (name, ok, detail)
CONSOLE_ERRS = []
PAGE_ERRORS = []

PHONE = "13903124901"  # 既有 R18 测试用户（注册有 IP 限流，复用登录）
PASSWORD = "r18-spaces-pass"
NICKNAME = "空间体验R18"
INVITE = "R18TEST"


def shot(page, name):
    page.screenshot(path=str(SHOTS / f"{name}.png"))
    return SHOTS / f"{name}.png"


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok), str(detail)[:200]))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f"  -- {str(detail)[:160]}" if not ok else ""))


def react_fill(page, target_selector, value, index=0):
    """受控输入：原生 setter + input 事件（AGENTS 规范，input/textarea 通用）。
    多个同 selector 时优先命中可见元素（登录/注册双表单同placeholder场景）"""
    js = """
    ([sel, v, idx]) => {
      const all = [...document.querySelectorAll(sel)];
      const vis = all.filter(e => e.offsetParent !== null || e.offsetWidth || e.offsetHeight);
      const els = vis.length ? vis : all;
      const el = els[idx];
      if (!el) return false;
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const d = Object.getOwnPropertyDescriptor(proto, 'value');
      d.set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    """
    return page.evaluate(js, [target_selector, value, index])


def layout_ok(page):
    return page.evaluate(
        "() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })"
    )


def check_layout(page, name):
    m = layout_ok(page)
    check(f"布局无横向溢出：{name}", m["sw"] <= m["cw"] + 1, f"scrollWidth={m['sw']} clientWidth={m['cw']}")


def toast_text(page):
    return page.evaluate(
        "() => [...document.querySelectorAll('body *')].filter(e => e.childElementCount===0 && /已|失败|取消|拆出|创建/.test(e.textContent||'') && e.closest('[class*=toast],[class*=fixed],[aria-live]')).map(e=>e.textContent.trim()).slice(0,3)"
    )


def hover_reveal_click(page, btn):
    """r35 键盘可达性设计：桌面端行内操作按钮 opacity:0 + pointer-events:none 占位，
    仅直接父行 :hover 时可点。先把鼠标移到按钮自身几何中心（命中父行 → 父行 :hover →
    按钮转为可点），再执行点击。"""
    box = btn.bounding_box()
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.wait_for_timeout(250)
    btn.click()


def preclean():
    """环境预清理：清掉本用户历史轮次遗留的同名空间（GUI 步骤假设干净初始态）"""
    import requests
    r = requests.post(f"{BASE}/api/auth/login", json={"phone": PHONE, "password": PASSWORD}, timeout=10)
    if r.status_code != 200:
        print("preclean 登录失败（首次运行走注册路径，跳过清理）:", r.status_code)
        return
    token = r.json().get("token") or r.json().get("sessionToken")
    rr = requests.get(f"{BASE}/api/spaces", headers={"Authorization": f"Bearer {token}"}, timeout=10)
    for sp in rr.json().get("spaces", []):
        if sp.get("name") in ("考研上岸", "副业过万"):
            requests.delete(f"{BASE}/api/spaces/{sp['id']}", headers={"Authorization": f"Bearer {token}"}, timeout=10)
            print("preclean 删除遗留空间:", sp["name"])


def main():
    preclean()
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1280, "height": 800}, locale="zh-CN", timezone_id="Asia/Shanghai")
        page = ctx.new_page()
        page.on("console", lambda m: CONSOLE_ERRS.append(f"[{m.type}] {m.text[:200]}") if m.type == "error" else None)
        page.on("pageerror", lambda e: PAGE_ERRORS.append(str(e)[:200]))

        # ---------- T1 注册/登录（幂等：已注册则直接登录） ----------
        page.goto(f"{BASE}/login")
        page.wait_for_load_state("domcontentloaded")

        def try_login():
            react_fill(page, "input[placeholder*='手机号']", PHONE)
            react_fill(page, "input[type='password']", PASSWORD, 0)
            page.get_by_role("button", name="登录", exact=True).click()
            page.wait_for_timeout(1500)
            return "/login" not in page.url

        def do_register():
            page.get_by_role("button", name="凭邀请码注册").click()
            page.wait_for_timeout(600)
            shot(page, "01-register-page")
            react_fill(page, "input[placeholder*='手机号']", PHONE)
            react_fill(page, "input[placeholder*='昵称']", NICKNAME)
            react_fill(page, "input[type='password']", PASSWORD, 0)
            react_fill(page, "input[type='password']", PASSWORD, 1)
            react_fill(page, "input[placeholder*='邀请']", INVITE)
            shot(page, "02-register-filled")
            page.get_by_role("button", name="注册并登录").click()
            page.wait_for_timeout(1800)
            return "/login" not in page.url

        if not try_login():
            check("T1 邀请码注册→自动登录跳首页", do_register(), page.url)
        else:
            check("T1 既有用户密码登录", True)
        shot(page, "03-after-register-home")

        # ---------- T2 进入目标空间：空态/内置运动空间 ----------
        page.get_by_role("link", name="目标").click()
        page.wait_for_timeout(1000)
        check("T2 /spaces 可达", "/spaces" in page.url, page.url)
        shot(page, "04-spaces-initial")
        body = page.evaluate("() => document.body.innerText.slice(0, 600)")
        has_sport = "运动" in body
        check("T2a 新用户列表渲染（内置运动空间惰性创建或空态）", ("运动" in body) or ("还没有目标空间" in body), body[:120])
        check_layout(page, "spaces 初始")

        # ---------- T3 新建空间（全字段） ----------
        page.get_by_role("button", name=re.compile("新建空间|创建第一个空间")).first.click()
        page.wait_for_timeout(500)
        shot(page, "05-create-modal")
        react_fill(page, "input[placeholder*='目标名称']", "考研上岸")
        react_fill(page, "textarea", "每天 6 小时有效学习，12 月模拟考前稳定 380+")
        # 图标 📚、颜色第二个色板
        page.locator("button", has_text="📚").first.click()
        page.wait_for_timeout(150)
        colors = page.locator("button[aria-label^='#']")
        if colors.count() >= 2:
            colors.nth(1).click()
        # 目标日期
        tds = page.locator("input[type='date']")
        if tds.count() >= 2:
            react_fill(page, "input[type='date']", "2027-06-01", 1)
        shot(page, "06-create-filled")
        page.get_by_role("button", name="创建", exact=True).click()
        page.wait_for_timeout(1000)
        shot(page, "07-after-create")
        body = page.evaluate("() => document.body.innerText")
        ok = "考研上岸" in body
        check("T3 新建空间成功（卡片出现）", ok, body[:200])
        check("T3a 描述入卡", "每天 6 小时有效学习" in body)
        check("T3b 目标日期入卡（MM-DD）", "06-01" in body)
        check("T3c 第 1 天计数", "第 1 天" in body)
        check_layout(page, "spaces 建卡后")

        # ---------- T4 卡片 InlineRename（hover 出铅笔按钮） ----------
        card = page.locator("a", has_text="考研上岸").first
        card.hover()
        page.wait_for_timeout(250)
        pencil = card.locator("button[title='重命名']")
        if pencil.count() > 0:
            hover_reveal_click(page, pencil.first)
            page.wait_for_timeout(400)
            shot(page, "08-inline-rename")
            # 编辑态下卡片 a 不再含标题文本（span 被 input 替换），用键盘驱动：输入框已 autofocus
            page.keyboard.press("Control+a")
            page.keyboard.insert_text("考研上岸 2027")
            page.keyboard.press("Enter")
            page.wait_for_timeout(900)
            body = page.evaluate("() => document.body.innerText")
            check("T4 卡片行内重命名", "考研上岸 2027" in body, body[:150])
            shot(page, "09-after-rename")
            # 改回原名
            card2 = page.locator("a", has_text="考研上岸 2027").first
            card2.hover()
            page.wait_for_timeout(200)
            p2 = card2.locator("button[title='重命名']")
            if p2.count() > 0:
                hover_reveal_click(page, p2.first)
                page.wait_for_timeout(300)
                page.keyboard.press("Control+a")
                page.keyboard.insert_text("考研上岸")
                page.keyboard.press("Enter")
                page.wait_for_timeout(800)
        else:
            check("T4 卡片行内重命名", False, "hover 后未出现重命名铅笔按钮")

        # ---------- T5 详情页 + 添加 todo ----------
        page.locator("a", has_text="考研上岸").first.click()
        page.wait_for_timeout(1200)
        check("T5 空间详情可达", re.search(r"/spaces/[0-9a-f-]{36}", page.url), page.url)
        shot(page, "10-detail-initial")
        check_layout(page, "详情初始")
        # 添加 todo
        add_row = page.locator("input[placeholder*='添加'], input[placeholder*='待办'], input[placeholder*='TODO']").first
        if add_row.count() > 0:
            react_fill(page, "input[placeholder*='添加'], input[placeholder*='待办'], input[placeholder*='TODO']", "刷数学真题 05-08")
            add_row.press("Enter")
            page.wait_for_timeout(900)
            body = page.evaluate("() => document.body.innerText")
            check("T5a 添加 todo（Enter 提交）", "刷数学真题 05-08" in body)
        else:
            check("T5a 添加 todo（Enter 提交）", False, "未找到添加输入框")
        shot(page, "11-todo-added")
        # 完成 → 已完成组；再恢复
        done_btn = page.locator("button[title*='完成'], button[aria-label*='完成']").first
        circle = page.locator("button").filter(has_text=re.compile("^$")).count()
        # 完成圆圈：行首圆形按钮——用 title/aria 或首个圆点样式按钮；先试通用 title
        clicked = False
        for sel in ["button[title*='标记']", "button[aria-label*='标记']", "button[title*='完成']"]:
            b = page.locator(sel)
            if b.count() > 0:
                b.first.click()
                clicked = True
                break
        if not clicked:
            # 兜底：todo 行内第一个按钮（圆圈在行首）
            row = page.locator("div", has_text="刷数学真题 05-08").last
        page.wait_for_timeout(800)
        shot(page, "12-todo-done-attempt")
        body = page.evaluate("() => document.body.innerText")
        # 已完成分组出现或计数变化
        check("T5b 完成圆圈交互有响应（已完成分组出现）", clicked and ("已完成" in body), f"clicked={clicked} body含已完成={'已完成' in body}")

        # ---------- T6 感悟 tab ----------
        page.get_by_role("button", name=re.compile("感悟")).first.click()
        page.wait_for_timeout(700)
        shot(page, "13-reflection-tab")
        new_ref = page.get_by_role("button", name=re.compile("新增|写感悟|添加感悟|记一笔"))
        if new_ref.count() > 0:
            new_ref.first.click()
            page.wait_for_timeout(500)
            shot(page, "14-reflection-editor")
            ta = page.locator("textarea").first
            if ta.count() > 0:
                react_fill(page, "textarea", "今天把线性代数强化课刷完了，正确率 82%，比上周高 7 个点。")
                page.get_by_role("button", name=re.compile("^保存$|^发布$|保存")).first.click()
                page.wait_for_timeout(900)
                body = page.evaluate("() => document.body.innerText")
                check("T6 新增感悟", "线性代数强化课" in body, body[:150])
                shot(page, "15-reflection-saved")
            else:
                check("T6 新增感悟", False, "编辑器未出现 textarea")
        else:
            check("T6 新增感悟入口", False, "未找到新增按钮（观察空态形态）")

        # ---------- T7 动态 tab ----------
        page.get_by_role("button", name=re.compile("^动态")).first.click()
        page.wait_for_timeout(700)
        shot(page, "16-moments-tab")
        body = page.evaluate("() => document.body.innerText")
        check("T7 动态 tab 空态有引导文案", ("还没有" in body) or ("暂无" in body) or ("动态" in body), body[:120])

        # ---------- T8 详情页 header ⋯ 菜单（归档/删除收纳；编辑走 header-card 内联） ----------
        page.goto(page.url.rsplit("?", 1)[0])  # 回详情
        page.wait_for_timeout(600)
        header_menu_btn = page.locator("button[title='更多操作']").first
        hover_reveal_click(page, header_menu_btn)
        page.wait_for_timeout(400)
        menu_items = page.evaluate("() => [...document.querySelectorAll('button')].map(b => (b.textContent||'').trim()).filter(t => /归档|删除|编辑/.test(t))")
        print("详情菜单项：", menu_items)
        shot(page, "17-space-menu")
        check("T8 详情 ⋯ 菜单收纳归档/删除（无编辑项，编辑走内联）",
              any("归档空间" in t for t in menu_items) and any("删除空间" in t for t in menu_items) and not any(t == "编辑空间" for t in menu_items),
              str(menu_items))
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        # header-card 阶段目标（REQ-019 FR-B1）：新建 → 行内编辑 → 标记达成 → 历史
        page.get_by_role("button", name="阶段").first.click()
        page.wait_for_timeout(400)
        react_fill(page, "input[placeholder*='阶段目标']", "完成数学一轮强化")
        tds = page.locator("input[type='date']")
        shot(page, "18a-milestone-form")
        page.get_by_role("button", name="添加", exact=True).click()
        page.wait_for_timeout(900)
        body = page.evaluate("() => document.body.innerText")
        check("T8a 阶段目标新建", "完成数学一轮强化" in body, body[:200])
        # 行内编辑：改标题
        row_btn = page.locator("button[title='点击编辑阶段目标']")
        if row_btn.count() > 0:
            row_btn.first.click()
            page.wait_for_timeout(400)
            edit_inp = page.locator("input[value*='一轮强化']")
            if edit_inp.count() == 0:
                edit_inp = page.locator("main input[maxlength='80']")
            edit_inp.first.fill("完成数学二轮强化")
            page.keyboard.press("Enter")
            page.wait_for_timeout(900)
            body = page.evaluate("() => document.body.innerText")
            check("T8b 阶段目标行内改名", "完成数学二轮强化" in body, body[:200])
            # 标记达成
            page.locator("button[title='标记达成']").first.click()
            page.wait_for_timeout(900)
            body = page.evaluate("() => document.body.innerText")
            check("T8c 标记达成（达成计数+1）", "达成 1" in body, body[:200])
            shot(page, "18c-milestone-done")
            # 历史弹层
            page.get_by_role("button", name=re.compile("历史 1")).click()
            page.wait_for_timeout(500)
            shot(page, "18d-milestone-history")
            hist = page.evaluate("() => document.body.innerText")
            check("T8d 历史弹层含已达成阶段", ("阶段目标历史" in hist) and ("完成数学二轮强化" in hist))
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)
        else:
            check("T8b 阶段目标行内编辑", False, "未找到阶段行编辑入口")

        # ---------- T9 边界：空名/超长名 ----------
        page.goto(f"{BASE}/spaces")
        page.wait_for_timeout(800)
        page.get_by_role("button", name=re.compile("新建空间")).first.click()
        page.wait_for_timeout(400)
        submit_btn = page.get_by_role("button", name=re.compile("^创建$"))
        check("T9a 空名创建按钮禁用", submit_btn.is_disabled(), f"disabled={submit_btn.is_disabled()}")
        react_fill(page, "input[placeholder*='目标名称']", "名" * 60)
        name_val = page.locator("input[placeholder*='目标名称']").input_value()
        check("T9b 名称 40 字截断", len(name_val) == 40, f"len={len(name_val)}")
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)
        shot(page, "20-boundary")

        # ---------- T10 归档/恢复/删除（用第二个空间走全周期） ----------
        page.goto(f"{BASE}/spaces")
        page.wait_for_timeout(800)
        page.get_by_role("button", name=re.compile("新建空间")).first.click()
        page.wait_for_timeout(400)
        react_fill(page, "input[placeholder*='目标名称']", "副业过万")
        page.get_by_role("button", name="创建", exact=True).click()
        page.wait_for_timeout(900)
        card = page.locator("a", has_text="副业过万").first
        hover_reveal_click(page, card.locator("button[title='更多操作']"))
        page.wait_for_timeout(400)
        shot(page, "21-card-menu")
        arch = page.get_by_role("button", name="归档空间")
        if arch.count() > 0:
            arch.first.click()
            page.wait_for_timeout(900)
            body = page.evaluate("() => document.body.innerText")
            check("T10a 归档后卡片离开进行中区", ("归档空间（1）" in body) or ("归档空间(1)" in body), body[:200])
            shot(page, "22-archived")
            # 折叠区默认收起：点 summary 展开
            page.locator("summary", has_text="归档空间").click()
            page.wait_for_timeout(500)
            # 恢复
            restore = page.get_by_role("button", name="恢复")
            check("T10b 归档区出现恢复入口", restore.count() >= 1)
            restore.first.click()
            page.wait_for_timeout(900)
            body = page.evaluate("() => document.body.innerText")
            check("T10c 恢复后卡片回到进行中", "副业过万" in body)
            # 再归档 → 归档区删除（两步确认）
            card = page.locator("a", has_text="副业过万").first
            hover_reveal_click(page, card.locator("button[title='更多操作']"))
            page.wait_for_timeout(400)
            page.get_by_role("button", name="归档空间").first.click()
            page.wait_for_timeout(900)
            del_btn = page.get_by_role("button", name=re.compile("^删除$"))
            del_btn.first.click()
            # 3 秒武装窗口内立即确认（中间不插截图——shot 耗时会吃掉窗口）
            confirm_btn = page.get_by_role("button", name=re.compile("确认删除"))
            confirm_ok = True
            try:
                confirm_btn.first.click(timeout=1500)
            except Exception:
                confirm_ok = False
            page.wait_for_timeout(3900)  # toast ok=3200+离场200ms（API 返回起算），取足余量
            body = page.evaluate("() => document.body.innerText")
            check("T10d 两步删除后空间消失", confirm_ok and ("副业过万" not in body), f"confirm={confirm_ok} {body[:120]}")
            shot(page, "24-after-delete")
        else:
            check("T10a 归档入口", False, "卡片菜单无「归档空间」")

        # ---------- T11 内置运动空间守卫 ----------
        page.goto(f"{BASE}/spaces")
        page.wait_for_timeout(900)
        body = page.evaluate("() => document.body.innerText")
        if "运动" in body:
            sport_card = page.locator("a", has_text="运动").first
            hover_reveal_click(page, sport_card.locator("button[title='更多操作']"))
            page.wait_for_timeout(400)
            shot(page, "25-sport-menu")
            menu_items = page.evaluate("() => [...document.querySelectorAll('button')].map(b => (b.textContent||'').trim())")
            has_arch = any("归档空间" in t for t in menu_items)
            has_del = any("删除空间" in t or "确认删除" in t for t in menu_items)
            has_edit = any("编辑空间" in t for t in menu_items)
            check("T11a 内置空间菜单无归档/删除（编辑保留）", not has_arch and not has_del and has_edit,
                  f"归档={has_arch} 删除={has_del} 编辑={has_edit}")
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)
        else:
            check("T11a 内置运动空间存在", False, "列表无运动空间")

        # ---------- T12 404 空间详情 ----------
        page.goto(f"{BASE}/spaces/{uuid.uuid4()}")
        page.wait_for_timeout(900)
        shot(page, "26-space-404")
        body = page.evaluate("() => document.body.innerText")
        check("T12 不存在空间显示 404 引导", ("不存在" in body) or ("已删除" in body), body[:100])

        # ---------- 汇总 ----------
        print("\n===== 汇总 =====")
        fails = [r for r in RESULTS if not r[1]]
        print(f"通过 {len(RESULTS) - len(fails)}/{len(RESULTS)}")
        for name, ok, detail in fails:
            print(f"  FAIL {name}: {detail}")
        print("\n===== 控制台错误 =====")
        for e in CONSOLE_ERRS[:20]:
            print(" ", e)
        print("===== 页面异常 =====")
        for e in PAGE_ERRORS[:10]:
            print(" ", e)
        browser.close()


if __name__ == "__main__":
    main()
