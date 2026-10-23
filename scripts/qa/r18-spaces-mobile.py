# -*- coding: utf-8 -*-
"""r18 目标空间模块 GUI 深度体验（Mobile 390x844）：黑盒 GUI 测试，截图+DOM 双验证。
复用 PC 轮注册的用户（登录态），重点：底部弹层形态、触屏常显按钮、单列布局、无横向溢出。"""
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8")

BASE = "http://127.0.0.1:3100"
SHOTS = Path(__file__).resolve().parents[2] / "gui-test-screenshots" / "r18"
SHOTS.mkdir(parents=True, exist_ok=True)

RESULTS = []
CONSOLE_ERRS = []
PAGE_ERRORS = []

PHONE = "13903124901"
PASSWORD = "r18-spaces-pass"


def shot(page, name):
    page.screenshot(path=str(SHOTS / f"{name}.png"))
    return SHOTS / f"{name}.png"


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok), str(detail)[:200]))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f"  -- {str(detail)[:160]}" if not ok else ""))


def react_fill(page, target_selector, value, index=0):
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


def check_layout(page, name):
    m = page.evaluate("() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })")
    check(f"布局无横向溢出：{name}", m["sw"] <= m["cw"] + 1, f"scrollWidth={m['sw']} clientWidth={m['cw']}")


def sheet_geometry(page):
    """判断当前打开的浮层是否为底部弹层形态（移动端 <640px 规范）：贴底、全宽"""
    return page.evaluate(
        """() => {
          const cands = [...document.querySelectorAll('.fixed')].filter(e => {
            const cs = getComputedStyle(e);
            return cs.position === 'fixed' && (e.textContent.includes('编辑空间') || e.textContent.includes('归档空间'));
          });
          if (!cands.length) return null;
          const r = cands[0].getBoundingClientRect();
          const iw = window.innerWidth, ih = window.innerHeight;
          return { x: r.x, w: r.width, bottomGap: ih - r.bottom, top: r.y, iw, ih };
        }"""
    )


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(
            viewport={"width": 390, "height": 844}, locale="zh-CN", timezone_id="Asia/Shanghai",
            has_touch=True, is_mobile=True,
        )
        page = ctx.new_page()
        page.on("console", lambda m: CONSOLE_ERRS.append(f"[{m.type}] {m.text[:200]}") if m.type == "error" else None)
        page.on("pageerror", lambda e: PAGE_ERRORS.append(str(e)[:200]))

        # ---------- M1 登录 ----------
        page.goto(f"{BASE}/login")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(1200)  # React 水合完成再填表（裸 domcontentloaded 会竞态空填）
        react_fill(page, "input[placeholder*='手机号']", PHONE)
        react_fill(page, "input[type='password']", PASSWORD, 0)
        page.get_by_role("button", name="登录", exact=True).click()
        page.wait_for_timeout(1500)
        check("M1 移动端密码登录", "/login" not in page.url, page.url)
        shot(page, "m01-home")

        # ---------- M2 空间列表：单列 + 预清理（删除 PC 轮遗留同名空间） ----------
        page.get_by_role("link", name="目标").click()
        page.wait_for_timeout(1200)
        check("M2 /spaces 可达", "/spaces" in page.url)
        shot(page, "m02-spaces")
        check_layout(page, "spaces 初始")
        # 预清理：归档区若有遗留同名空间先删除（两步）
        body = page.evaluate("() => document.body.innerText")
        if "考研上岸" in body and "归档空间" in body:
            page.locator("summary", has_text="归档空间").click()
            page.wait_for_timeout(400)
            dels = page.get_by_role("button", name=re.compile("^删除$"))
            for i in range(dels.count()):
                dels.nth(i).click()
                page.wait_for_timeout(250)
                page.get_by_role("button", name=re.compile("确认删除")).first.click()
                page.wait_for_timeout(400)
            page.wait_for_timeout(3600)
        # 若进行中区已有 考研上岸（PC 轮恢复态），归档它再删
        body = page.evaluate("() => document.body.innerText")
        if "考研上岸" in body:
            card = page.locator("a", has_text="考研上岸").first
            btn = card.locator("button[title='更多操作']")
            if btn.count() > 0:
                btn.click()  # 移动端 hover:none → 按钮常显可直接点
                page.wait_for_timeout(400)
                page.get_by_role("button", name="归档空间").first.click()
                page.wait_for_timeout(900)
                page.locator("summary", has_text="归档空间").click()
                page.wait_for_timeout(400)
                dels = page.get_by_role("button", name=re.compile("^删除$"))
                if dels.count() > 0:
                    dels.first.click()
                    page.wait_for_timeout(250)
                    page.get_by_role("button", name=re.compile("确认删除")).first.click()
                    page.wait_for_timeout(3600)
        body = page.evaluate("() => document.body.innerText")
        check("M2a 预清理完成（无遗留考研上岸）", "考研上岸" not in body, body[:120])

        # ---------- M3 新建空间：移动端弹层形态 ----------
        page.get_by_role("button", name=re.compile("新建空间|创建第一个空间")).first.click()
        page.wait_for_timeout(600)
        shot(page, "m03-create-modal")
        check_layout(page, "新建弹层")
        react_fill(page, "input[placeholder*='目标名称']", "考研上岸")
        react_fill(page, "textarea", "移动端创建验证")
        page.get_by_role("button", name="创建", exact=True).click()
        page.wait_for_timeout(1000)
        body = page.evaluate("() => document.body.innerText")
        check("M3 移动端新建空间成功", "考研上岸" in body, body[:150])
        shot(page, "m04-after-create")

        # ---------- M4 卡片 ⋯ 菜单：底部弹层形态（触屏常显，直接点） ----------
        card = page.locator("a", has_text="考研上岸").first
        btn = card.locator("button[title='更多操作']")
        vis = btn.is_visible()
        check("M4a 触屏设备行操作按钮常显（hover:none 媒体查询）", vis, f"visible={vis}")
        btn.click()
        page.wait_for_timeout(500)
        shot(page, "m05-card-menu")
        geo = sheet_geometry(page)
        if geo:
            full_width = geo["w"] >= geo["iw"] * 0.9
            at_bottom = geo["bottomGap"] <= 8
            check("M4b 卡片菜单为底部弹层形态（全宽贴底）", full_width and at_bottom, json.dumps(geo) if (not full_width or not at_bottom) else "")
        else:
            check("M4b 卡片菜单为底部弹层形态", False, "未定位到菜单浮层")
        check_layout(page, "卡片菜单打开")
        # 编辑空间（移动端弹层内的表单）
        page.get_by_role("button", name="编辑空间").first.click()
        page.wait_for_timeout(500)
        shot(page, "m06-edit-modal")
        tds = page.locator("input[type='date']")
        if tds.count() >= 2:
            react_fill(page, "input[type='date']", "2027-09-30", 1)
        page.get_by_role("button", name="保存", exact=True).click()
        page.wait_for_timeout(1000)
        body = page.evaluate("() => document.body.innerText")
        check("M4c 编辑空间改目标日期生效", "09-30" in body, body[:150])
        shot(page, "m07-after-edit")

        # ---------- M5 行内重命名（触屏常显铅笔） ----------
        card = page.locator("a", has_text="考研上岸").first
        pencil = card.locator("button[title='重命名']")
        check("M5a 重命名铅笔常显", pencil.is_visible(), f"visible={pencil.is_visible()}")
        pencil.click()
        page.wait_for_timeout(400)
        page.keyboard.press("Control+a")
        page.keyboard.insert_text("考研上岸M")
        page.keyboard.press("Enter")
        page.wait_for_timeout(900)
        body = page.evaluate("() => document.body.innerText")
        check("M5b 行内重命名生效", "考研上岸M" in body, body[:150])
        shot(page, "m08-renamed")
        # 改回
        card = page.locator("a", has_text="考研上岸M").first
        card.locator("button[title='重命名']").click()
        page.wait_for_timeout(400)
        page.keyboard.press("Control+a")
        page.keyboard.insert_text("考研上岸")
        page.keyboard.press("Enter")
        page.wait_for_timeout(800)

        # ---------- M6 详情页：tabs + todo + 感悟 ----------
        card = page.locator("a", has_text="考研上岸").first
        card.click()
        page.wait_for_timeout(1200)
        check("M6 详情可达", re.search(r"/spaces/[0-9a-f-]{36}", page.url), page.url)
        shot(page, "m09-detail")
        check_layout(page, "详情初始")
        # tabs 横向可滚动态
        add_row = page.locator("input[placeholder*='添加'], input[placeholder*='待办'], input[placeholder*='TODO']").first
        if add_row.count() > 0:
            react_fill(page, "input[placeholder*='添加'], input[placeholder*='待办'], input[placeholder*='TODO']", "移动端刷题 30 分钟")
            add_row.press("Enter")
            page.wait_for_timeout(900)
            body = page.evaluate("() => document.body.innerText")
            check("M6a 添加 todo", "移动端刷题 30 分钟" in body)
        else:
            check("M6a 添加 todo", False, "未找到添加输入框")
        shot(page, "m10-todo-added")
        # 完成
        clicked = False
        for sel in ["button[title*='完成']", "button[title*='标记']"]:
            b = page.locator(sel)
            if b.count() > 0:
                b.first.click()
                clicked = True
                break
        page.wait_for_timeout(800)
        body = page.evaluate("() => document.body.innerText")
        check("M6b 完成圆圈（已完成分组出现）", clicked and ("已完成" in body), f"clicked={clicked}")
        shot(page, "m11-todo-done")
        # 感悟 tab
        page.get_by_role("button", name=re.compile("感悟")).first.click()
        page.wait_for_timeout(700)
        shot(page, "m12-reflection-tab")
        new_ref = page.get_by_role("button", name=re.compile("新增|写感悟|添加感悟|记一笔"))
        if new_ref.count() > 0:
            new_ref.first.click()
            page.wait_for_timeout(500)
            shot(page, "m13-reflection-editor")
            ta = page.locator("textarea").first
            if ta.count() > 0:
                react_fill(page, "textarea", "移动端写感悟：地铁上复盘了今天的错题本。")
                page.get_by_role("button", name=re.compile("^保存$|^发布$|保存")).first.click()
                page.wait_for_timeout(900)
                body = page.evaluate("() => document.body.innerText")
                check("M6c 移动端新增感悟", "错题本" in body, body[:150])
                shot(page, "m14-reflection-saved")
            else:
                check("M6c 移动端新增感悟", False, "编辑器未出现 textarea")
        else:
            check("M6c 移动端新增感悟入口", False, "未找到新增按钮")

        # ---------- M7 详情 header ⋯ 菜单底部弹层 ----------
        header_btn = page.locator("button[title='更多操作']").first
        header_btn.click()
        page.wait_for_timeout(500)
        shot(page, "m15-header-menu")
        geo = sheet_geometry(page)
        if geo:
            check("M7 详情菜单为底部弹层形态", geo["w"] >= geo["iw"] * 0.9 and geo["bottomGap"] <= 8, str(geo))
        else:
            check("M7 详情菜单为底部弹层形态", False, "未定位到菜单浮层")
        check_layout(page, "详情菜单打开")
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)

        # ---------- M8 归档 → 底部弹层归档 → 展开归档区 → 恢复 ----------
        page.goto(f"{BASE}/spaces")
        page.wait_for_timeout(1000)
        card = page.locator("a", has_text="考研上岸").first
        card.locator("button[title='更多操作']").click()
        page.wait_for_timeout(400)
        page.get_by_role("button", name="归档空间").first.click()
        page.wait_for_timeout(900)
        body = page.evaluate("() => document.body.innerText")
        check("M8a 归档后进折叠区", ("归档空间（1）" in body) or ("归档空间(1)" in body), body[:150])
        page.locator("summary", has_text="归档空间").click()
        page.wait_for_timeout(400)
        shot(page, "m16-archived")
        restore = page.get_by_role("button", name="恢复")
        check("M8b 恢复入口可用", restore.count() >= 1)
        restore.first.click()
        page.wait_for_timeout(900)
        body = page.evaluate("() => document.body.innerText")
        check("M8c 恢复成功", "考研上岸" in body)

        # ---------- 汇总 ----------
        print("\n===== 汇总 =====")
        fails = [r for r in RESULTS if not r[1]]
        print(f"通过 {len(RESULTS) - len(fails)}/{len(RESULTS)}")
        for name, ok, detail in fails:
            print(f"  FAIL {name}: {detail}")
        print("===== 控制台错误 =====")
        for e in CONSOLE_ERRS[:20]:
            print(" ", e)
        print("===== 页面异常 =====")
        for e in PAGE_ERRORS[:10]:
            print(" ", e)
        browser.close()


if __name__ == "__main__":
    import json
    main()
