(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const norm = (t) => String(t || "").replace(/\s+/g, " ").trim();
  const log  = (...a) => console.log("[RDR_STRONG]", ...a);

  // ===== 你要选的两个日期（默认：明天/后天）=====
  const today = new Date();
  const pickupDate  = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const dropoffDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2);

  function dispatchMouse(el, type, x, y) {
    el.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      button: 0
    }));
  }

  function dispatchPointer(el, type, x, y) {
    try {
      el.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerType: "mouse",
        clientX: x,
        clientY: y,
        button: 0,
        isPrimary: true
      }));
    } catch (e) {
      // 某些环境没 PointerEvent，忽略
    }
  }

  function strongClick(el) {
    if (!el) return false;
    el.scrollIntoView({ block: "center" });

    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;

    // 确保点到的“最上层元素”就是它或它的子元素
    const top = document.elementFromPoint(x, y);
    if (top && !(top === el || el.contains(top))) {
      // 尝试改点 top 的可点祖先（有时 span 覆盖在 button 上）
      const btn = top.closest("button");
      if (btn) el = btn;
    }

    dispatchPointer(el, "pointerdown", x, y);
    dispatchMouse(el, "mousedown", x, y);
    dispatchPointer(el, "pointerup", x, y);
    dispatchMouse(el, "mouseup", x, y);
    el.click(); // 最后再补一下 click
    return true;
  }

  function findByText(textIncludes, scope=document) {
    const want = textIncludes.toLowerCase();
    const nodes = Array.from(scope.querySelectorAll("button,a,[role='button'],div,span,label"));
    return nodes.find(el => norm(el.textContent).toLowerCase().includes(want)) || null;
  }

  function getDateBtn() {
    return document.querySelector(".DatePicker-CalendarField")
      || document.querySelector("[class*='CalendarField' i]")
      || findByText("date");
  }

  function getSelectDatesBtn() {
    return findByText("select dates") || findByText("select date");
  }

  function getPanel() {
    return document.querySelector(".rdrCalendarWrapper.rdrDateRangeWrapper")
      || document.querySelector(".rdrDateRangeWrapper")
      || document.querySelector(".rdrDateRangePickerWrapper")
      || document.querySelector(".rdrMonths");
  }

  async function waitPanel(timeoutMs=15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const p = getPanel();
      if (p) return p;
      await sleep(200);
    }
    return null;
  }
    
async function clickSearchNowOnResults() {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const norm  = (t) => String(t || "").replace(/\s+/g, " ").trim();
  const log   = (...a) => console.log("[AUTO]", ...a);

  const btn =
    document.querySelector("button.SearchModifier-SubmitBtn") ||
    document.querySelector("button.Button.Button_Search.SearchModifier-SubmitBtn") ||
    Array.from(document.querySelectorAll("button"))
      .find(b => /search now/i.test(norm(b.textContent)));

  if (!btn) {
    log("❌ Search Now button not found (button.SearchModifier-SubmitBtn)");
    return false;
  }

  // 等它变成可点（有时候刚选完日期会短暂 disabled）
  const start = Date.now();
  while (Date.now() - start < 15000) {
    const disabled =
      btn.disabled ||
      (btn.getAttribute("aria-disabled") || "").toLowerCase() === "true" ||
      /disabled|loading/i.test((btn.className || "").toString());

    if (!disabled) break;
    await sleep(200);
  }

  // 强制点击：pointer+mouse+click（三连）
  btn.scrollIntoView({ block: "center" });
  const r = btn.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;

  try {
    btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles:true, cancelable:true, pointerType:"mouse", clientX:x, clientY:y, button:0, isPrimary:true }));
    btn.dispatchEvent(new PointerEvent("pointerup",   { bubbles:true, cancelable:true, pointerType:"mouse", clientX:x, clientY:y, button:0, isPrimary:true }));
  } catch(e) {}

  btn.dispatchEvent(new MouseEvent("mousedown", { bubbles:true, cancelable:true, clientX:x, clientY:y, button:0 }));
  btn.dispatchEvent(new MouseEvent("mouseup",   { bubbles:true, cancelable:true, clientX:x, clientY:y, button:0 }));
  btn.click();

  log("✅ Clicked Search Now (button.SearchModifier-SubmitBtn)");
  return true;
}


  function getDisplayValues(panel) {
    // react-date-range 顶部通常有两个输入框显示选中的起止日期
    const inputs = Array.from(panel.querySelectorAll(".rdrDateDisplayItem input"));
    const vals = inputs.map(i => i.value);
    return { inputs, vals };
  }

  function isDisabled(btn) {
    if (!btn) return true;
    if (btn.disabled) return true;
    const aria = (btn.getAttribute("aria-disabled") || "").toLowerCase();
    if (aria === "true") return true;
    const cls = (btn.className || "").toString().toLowerCase();
    if (cls.includes("rdrdaydisabled")) return true;
    return false;
  }

  function inViewport(el) {
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    return r.width > 5 && r.height > 5 && r.bottom > 0 && r.right > 0 && r.left < vw && r.top < vh;
  }

  function distToPanelCenter(el, panel) {
    const pr = panel.getBoundingClientRect();
    const cx = pr.left + pr.width / 2;
    const cy = pr.top + pr.height / 2;

    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const dx = x - cx, dy = y - cy;
    return Math.sqrt(dx*dx + dy*dy);
  }

  function getDayButtons(panel, dayNum) {
    // ✅ 只抓 react-date-range 的 day button（避免点到别的“15”）
    const all = Array.from(panel.querySelectorAll("button.rdrDay"));
    const candidates = all.filter(b => norm(b.textContent) === String(dayNum));

    // 排序：可见优先、非 disabled、离面板中心近
    const scored = candidates.map(b => ({
      b,
      visible: inViewport(b),
      disabled: isDisabled(b),
      dist: distToPanelCenter(b, panel)
    }));

    scored.sort((a, c) => {
      if (a.visible !== c.visible) return a.visible ? -1 : 1;
      if (a.disabled !== c.disabled) return a.disabled ? 1 : -1;
      return a.dist - c.dist;
    });

    return scored.map(x => x.b);
  }

  async function clickDayWithVerification(panel, dayNum, which /*0=pickup,1=dropoff*/) {
    const before = getDisplayValues(panel).vals.join(" | ");
    const buttons = getDayButtons(panel, dayNum);

    log(`Try day=${dayNum} candidates=${buttons.length} beforeDisplay="${before}"`);

    for (let i = 0; i < Math.min(buttons.length, 12); i++) {
      const btn = buttons[i];
      if (isDisabled(btn)) continue;

      // 标记一下你肉眼能看到点的是哪个
      btn.style.outline = "3px solid yellow";
      btn.style.outlineOffset = "2px";

      strongClick(btn);
      await sleep(350);

      const p2 = getPanel() || panel; // 可能重绘
      const after = getDisplayValues(p2).vals.join(" | ");

      // ✅ 判断有没有真的生效：display input 变化
      if (after && after !== before) {
        log(`✅ click ok day=${dayNum} (idx=${i}) afterDisplay="${after}"`);
        return true;
      }
    }

    log(`❌ day=${dayNum} clicked but display did not change (maybe wrong month/overlay).`);
    return false;
  }

  // ===== 0) 尝试打开日历（如果你已经打开，也不会有害）=====
  try {
    document.dispatchEvent(new KeyboardEvent("keydown", { key:"Escape", code:"Escape", bubbles:true }));
    document.dispatchEvent(new KeyboardEvent("keyup",   { key:"Escape", code:"Escape", bubbles:true }));
  } catch(e) {}
  await sleep(200);

  const dateBtn = getDateBtn();
  if (dateBtn) {
    log("Click Date entry...");
    strongClick(dateBtn);
    await sleep(600);
    const sel = getSelectDatesBtn();
    if (sel) {
      log("Click Select dates...");
      strongClick(sel);
      await sleep(800);
    }
  }

  const panel = await waitPanel(15000);
  if (!panel) {
    log("❌ Calendar panel not found (.rdrDateRangeWrapper). You need to open calendar first.");
    return;
  }

  log("✅ Calendar panel found:", panel.className || panel.tagName);

  // ===== 1) 按顺序点两次：第一次=pickup，第二次=dropoff =====
  const d1 = pickupDate.getDate();
  const d2 = dropoffDate.getDate();

  const ok1 = await clickDayWithVerification(panel, d1, 0);
  await sleep(400);

  const panel2 = getPanel() || panel;
  const ok2 = await clickDayWithVerification(panel2, d2, 1);
  
  log("DONE:", {
    pickup: pickupDate.toDateString(),
    dropoff: dropoffDate.toDateString(),
    pickup_clicked: ok1,
    dropoff_clicked: ok2,
  });

  // 输出当前 display 值，确认是否改变
  const finalPanel = getPanel() || panel2;
  const disp = getDisplayValues(finalPanel).vals;
  log("Final display inputs:", disp);
  await sleep(500)

  clickSearchNowOnResults()
})();
