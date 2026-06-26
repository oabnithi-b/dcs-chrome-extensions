// =============================================================================
// popup.js — UI orchestration
// config.js + eligibility.js are loaded before this file via <script> tags.
// =============================================================================

let currentTool   = 'partial'; // which tool tab is active
let currentResult = null;     // last successful evaluate() result (for RL save)
let currentTabId  = null;     // active Chrome tab ID (for sending messages)
let verifiedEmail = null;     // Google-authenticated agent email (set after checkAuth)
let verifiedRole  = null;     // role returned by Apps Script: 'owner' | 'admin' | 'agent'

document.addEventListener('DOMContentLoaded', async () => {
  // ── Detect iframe vs popup mode ──────────────────────────────────────────
  const inIframe = (window.self !== window.top);
  if (inIframe) {
    document.body.classList.add('in-iframe');
  }

  // ── If opened as toolbar popup, close the overlay on the page ───────────
  if (!inIframe) {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'CLOSE_OVERLAY' }, () => {
          void chrome.runtime.lastError; // suppress "no receiver" error if overlay not injected
        });
      }
    });
  }

  // ── Open Overlay (D Tool panel on the page) ─────────────────────────────
  const btnOpenOverlay = document.getElementById('btn-open-overlay');
  if (btnOpenOverlay) {
    btnOpenOverlay.addEventListener('click', async () => {
      const tabId = currentTabId ?? await new Promise(resolve => {
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
          resolve(tabs[0]?.id ?? null);
        });
      });
      if (tabId) {
        chrome.tabs.sendMessage(tabId, { type: 'OPEN_OVERLAY' });
      }
      window.close();
    });
  }

  // Tool tab switching
  document.querySelectorAll('.tool-tab[data-tool]').forEach(tab => {
    tab.addEventListener('click', () => switchTool(tab.dataset.tool));
  });

  // Logout button
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      btnLogout.disabled    = true;
      btnLogout.textContent = '⏳...';
      const loginUrl = (typeof LOGIN_WEB_APP_URL !== 'undefined') ? LOGIN_WEB_APP_URL : '';
      try {
        await sendToBackground({ type: 'LOGOUT', loginUrl });
      } catch (_) {}
      // รีเซ็ต state — แสดงปุ่ม login ให้กดเอง ไม่ login อัตโนมัติ
      verifiedEmail = null;
      verifiedRole  = null;
      btnLogout.disabled    = false;
      btnLogout.textContent = '🚪 ออกจากระบบ';
      btnLogout.style.display = 'none';
      document.getElementById('tab-admin').style.display = 'none';
      showLoginPrompt(loginUrl);
    });
  }

  // Error state retry
  document.getElementById('btn-retry').addEventListener('click', runAnalysis);

  // Result state refresh (re-extract from same tab)
  document.getElementById('btn-refresh').addEventListener('click', runAnalysis);

  // Interest calculator: live update on any input change inside the panel
  document.getElementById('panel-interest').addEventListener('input', e => {
    const card = e.target.closest('.int-card');
    if (card) updateInterestCard(card);
  });
  document.getElementById('panel-interest').addEventListener('change', e => {
    const card = e.target.closest('.int-card');
    if (card) updateInterestCard(card);
  });

  // ── Google Auth check ─────────────────────────────────────────────────────
  showState('auth');
  const loginUrl = (typeof LOGIN_WEB_APP_URL !== 'undefined') ? LOGIN_WEB_APP_URL : '';

  async function applyAuth(email, role) {
    verifiedEmail = email;
    verifiedRole  = role || 'agent';
    applyWatermark(verifiedEmail);
    applyAdminTab(verifiedRole);
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) btnLogout.style.display = '';
    // warmup scripts ทันทีเมื่อ auth สำเร็จ (ก่อน user กดปุ่ม)
    warmup(typeof REQUEST_DISCOUNT_WEB_APP_URL !== 'undefined' ? REQUEST_DISCOUNT_WEB_APP_URL : '');
    warmup(typeof WRONG_PTP_WEB_APP_URL !== 'undefined' ? WRONG_PTP_WEB_APP_URL : '');
    warmup(typeof HASHTAG_WEB_APP_URL   !== 'undefined' ? HASHTAG_WEB_APP_URL   : '');
    warmup(typeof INBOUND_WEB_APP_URL   !== 'undefined' ? INBOUND_WEB_APP_URL   : '');
    await runAnalysis();
  }

  // ── Fast path ตรง: อ่าน storage ใน popup โดยตรง ไม่ผ่าน background ──────────
  // service worker อาจถูก kill อยู่ — การอ่าน storage ตรงเร็วกว่า (~50ms vs ~2s)
  try {
    const stored = await chrome.storage.local.get('dc_session');
    const sess   = stored.dc_session || {};
    if (sess.email && sess.role) {
      // session ยังใช้ได้ → ข้ามการยืนยันตัวตน ไปแสดงผลเลย
      await applyAuth(sess.email, sess.role);
      return; // ออกจาก DOMContentLoaded
    }
  } catch (_) {}
  // ────────────────────────────────────────────────────────────────────────────

  // session หมดอายุ / ยังไม่เคย login → ผ่าน background (เพื่อ Google OAuth)
  async function doAuth(interactive) {
    const authResult = await sendToBackground({ type: 'CHECK_AUTH', loginUrl, interactive });
    await applyAuth(authResult.email, authResult.role);
  }

  try {
    await doAuth(false); // silent ก่อน
  } catch (_) {
    try {
      await doAuth(true); // interactive ถ้า silent ไม่ผ่าน
    } catch (err) {
      showLoginPrompt(loginUrl);
    }
  }
});

// ---------------------------------------------------------------------------
// Login prompt — แสดงเมื่อไม่มี token cache (ไม่แสดง Google popup อัตโนมัติ)
// ---------------------------------------------------------------------------
function showLoginPrompt(loginUrl) {
  showState('auth');
  const authScreen = document.getElementById('state-auth');
  if (!authScreen) return;
  authScreen.innerHTML = `
    <div style="padding:28px 20px;text-align:center;">
      <div style="font-size:36px;margin-bottom:12px;">🔐</div>
      <div style="font-size:1.077rem;font-weight:700;color:#1a237e;margin-bottom:8px;">DC Collection Tool</div>
      <div style="font-size:0.846rem;color:#9e9e9e;margin-bottom:20px;line-height:1.6;">
        กรุณาเข้าสู่ระบบเพื่อเริ่มใช้งาน
      </div>
      <button id="btn-do-login" style="
        background:#1a237e;color:#fff;border:none;border-radius:24px;
        padding:10px 28px;font-size:0.923rem;font-weight:700;cursor:pointer;
        display:inline-flex;align-items:center;gap:8px;
        box-shadow:0 3px 10px rgba(26,35,126,0.35);transition:background 0.15s;">
        <img src="https://www.google.com/favicon.ico" width="16" height="16" style="border-radius:2px;">
        เข้าสู่ระบบด้วย Google
      </button>
      <div id="login-error" style="display:none;margin-top:14px;font-size:0.846rem;color:#b71c1c;"></div>
    </div>`;

  document.getElementById('btn-do-login').addEventListener('click', async () => {
    const btn = document.getElementById('btn-do-login');
    const errEl = document.getElementById('login-error');
    btn.disabled = true;
    btn.textContent = '⏳ กำลังเข้าสู่ระบบ...';
    errEl.style.display = 'none';
    try {
      const authResult = await sendToBackground({ type: 'CHECK_AUTH', loginUrl, interactive: true });
      verifiedEmail = authResult.email;
      verifiedRole  = authResult.role || 'agent';
      applyWatermark(verifiedEmail);
      applyAdminTab(verifiedRole);
      const btnLogout = document.getElementById('btn-logout');
      if (btnLogout) btnLogout.style.display = '';
      await runAnalysis();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = '🔄 ลองอีกครั้ง';
      console.warn('[DC Tool] login error:', err.message);
      const isAccessDenied = /not found|whitelist|access|denied|ไม่พบ/i.test(err.message);
      const friendlyMsg = 'ไม่พบรายชื่อผู้ใช้หรืออีเมลนี้<br>กรุณาติดต่อหัวหน้างานหรือหัวหน้าทีมของคุณ';
      errEl.innerHTML = isAccessDenied
        ? '❌ ' + friendlyMsg
        : '❌ ' + friendlyMsg +
          '<br><span style="font-size:0.769rem;color:#999;word-break:break-all;">[' + err.message + ']</span>';
      errEl.style.display = 'block';
    }
  });
}

// ---------------------------------------------------------------------------
// Tool switching — lazy render: วาด panel เฉพาะตอนที่ user click tab นั้น
// ---------------------------------------------------------------------------
const _renderedPanels = new Set();

function switchTool(toolId) {
  currentTool = toolId;
  document.querySelectorAll('.tool-tab[data-tool]').forEach(t => {
    t.classList.toggle('active', t.dataset.tool === toolId);
  });
  document.querySelectorAll('.tool-panel').forEach(p => {
    p.classList.toggle('active', p.id === 'panel-' + toolId);
  });
  // ซ่อน customer-bar เมื่ออยู่ที่ tab admin
  const bar = document.querySelector('.customer-bar');
  if (bar) bar.style.display = (toolId === 'admin') ? 'none' : '';

  // Lazy render — วาดเฉพาะ panel ที่ยังไม่เคยวาด (ถ้ามีข้อมูลแล้ว)
  if (currentResult && !_renderedPanels.has(toolId)) {
    _renderPanel(toolId, currentResult);
    _renderedPanels.add(toolId);
  }
}

function _renderPanel(toolId, result) {
  const groups = result.allActiveGroups || [];
  switch (toolId) {
    case 'partial':   renderPartialPanel(result);          break;
    case 'discount':  renderDiscountPanel(groups);          break;
    case 'rdiscount': renderRequestDiscountPanel(result);   break;
    case 'exclude':   renderExcludePanel(groups);           break;
    case 'rl':        renderRLPanel(groups);                 break;
    case 'interest':  renderInterestPanel(groups);          break;
    case 'phone':     renderPhonePanel(result);              break;
    case 'sms':       renderSmsPanel(result);                break;
    case 'waive':     renderWaivePanel(result);              break;
    case 'refund':    renderRefundPanel(result);             break;
    case 'wrongptp':  renderWrongPTPPanel(result);           break;
    case 'hashtag':   renderHashtagPanel(result);            break;
    case 'inbound':   renderInboundPanel(result);            break;
  }
}

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------
async function runAnalysis() {
  const tab = await getActiveTab();
  currentTabId = tab?.id ?? null;

  if (!isCaseDetailPage(tab?.url)) {
    showState('wrong');
    return;
  }

  showState('loading');

  let rawData;
  try {
    rawData = await sendToContent(tab.id, { type: 'EXTRACT_DATA' });
  } catch (err) {
    const noScript = err.message.includes('Receiving end') ||
                     err.message.includes('Could not establish');
    showError(noScript
      ? 'กรุณา Refresh หน้าเว็บ DC System แล้วเปิด popup ใหม่\n(Extension โหลดหลังจากเปิดหน้านี้แล้ว)'
      : 'ดึงข้อมูลไม่สำเร็จ: ' + err.message);
    return;
  }

  if (!rawData) {
    showError('Content script ไม่ตอบสนอง');
    return;
  }

  // Handle "user is not on Bill Info tab" gracefully
  if (rawData.error === 'BILL_INFO_TAB_NOT_ACTIVE') {
    showError(
      'กรุณาไปที่แท็บ "Bill Info" / "ข้อมูลบิล" ก่อน\n' +
      'แล้วกดปุ่ม 🔄 ลองใหม่'
    );
    return;
  }

  if (rawData.error) {
    showError('Content script ตอบกลับผิดพลาด: ' + rawData.error);
    return;
  }

  let result;
  try {
    result = evaluate(rawData.billRows, {
      PRODUCT_CONFIG,
      PARTIAL_ZONE_TABLE,
      PARTIAL_MIN_AMOUNT,
      PARTIAL_RED_ZONE_MIN_AMOUNT,
      DPD_ZONE_THRESHOLDS,
      PCL_PARTIAL_CONFIG,
    });
  } catch (err) {
    showError('คำนวณสิทธิ์ไม่สำเร็จ: ' + err.message);
    return;
  }

  result.caseId       = rawData.userInfo.caseId;
  result.creditUserId = rawData.userInfo.creditUserId;
  result.name         = rawData.userInfo.name;
  result.shopeeUserId = rawData.userInfo.shopeeUserId;
  result.agentEmail   = rawData.userInfo.agentEmail;
  result.fromCache    = !!rawData.fromCache;

  renderResult(result);
}

// ---------------------------------------------------------------------------
// Master render — อัปเดต customer bar แล้ว render เฉพาะ panel ที่ active
// ---------------------------------------------------------------------------
function renderResult(result) {
  // Show/hide inbound-call cache banner
  const cacheBanner = document.getElementById('cache-banner');
  if (cacheBanner) cacheBanner.style.display = result.fromCache ? '' : 'none';

  setText('r-name',    result.name         || '—');
  setText('r-userId',  result.creditUserId || '—');
  setText('r-shopeeId',result.shopeeUserId || '—');
  setText('r-agent',   result.agentEmail   || '—');

  currentResult = result; // store for RL save + lazy render

  // reset lazy-render cache เมื่อข้อมูลใหม่เข้ามา
  _renderedPanels.clear();

  // render ทุก panel ทันที
  renderPartialPanel(result);
  renderDiscountPanel(result.allActiveGroups || []);
  renderRequestDiscountPanel(result);
  renderExcludePanel(result.allActiveGroups || []);
  renderRLPanel(result.allActiveGroups || []);
  renderInterestPanel(result.allActiveGroups || []);
  renderPhonePanel(result);
  renderSmsPanel(result);
  renderWaivePanel(result);
  renderRefundPanel(result);
  renderWrongPTPPanel(result);
  renderHashtagPanel(result);
  renderInboundPanel(result);

  // mark ทุก panel ว่า render แล้ว
  ['partial','discount','rdiscount','exclude','rl','interest','phone','sms','waive','refund','wrongptp','hashtag','inbound']
    .forEach(t => _renderedPanels.add(t));

  showState('result');
  switchTool(currentTool);
}

// ---------------------------------------------------------------------------
// Panel: Partial Payment
// ---------------------------------------------------------------------------
function renderPartialPanel(result) {
  const eligibleList = document.getElementById('eligible-list');
  const eligHeader   = document.getElementById('eligible-header');

  if (result.eligibleProducts.length === 0) {
    eligHeader.style.color = '#9e9e9e';
    eligibleList.innerHTML =
      '<div class="no-data">ไม่มีผลิตภัณฑ์ที่มีสิทธิ์</div>';
  } else {
    eligHeader.style.color = '';
    eligibleList.innerHTML =
      result.eligibleProducts.map(p => buildEligibleCard(p)).join('');
  }

  if (result.ineligibleProducts.length > 0) {
    document.getElementById('ineligible-section').style.display = 'block';
    document.getElementById('ineligible-list').innerHTML =
      result.ineligibleProducts.map(p => buildIneligibleCard(p)).join('');
  } else {
    document.getElementById('ineligible-section').style.display = 'none';
  }
}

function buildEligibleCard(p) {
  const oa = p.offeredAmounts;

  const zones = [
    { key: 'green',  label: 'Green',  pct: oa.greenPct,  amt: oa.green  },
    { key: 'yellow', label: 'Yellow', pct: oa.yellowPct, amt: oa.yellow },
    { key: 'red',    label: 'Red',    pct: oa.redPct,    amt: oa.red    },
  ];

  const tableRows = zones.map(z => {
    const assigned    = z.key === p.zone;
    const assignedCls = assigned ? ' is-assigned' : '';

    const nameCell = `
      <div class="zone-name-cell">
        <span class="zone-dot ${z.key}"></span>
        <span class="zone-label ${z.key}">${z.label}</span>
        ${assigned ? '<span class="dpd-badge">DPD zone</span>' : ''}
      </div>`;

    const pctCell = z.pct !== null
      ? `<span class="pct-text">${z.pct}%</span>`
      : `<span class="pct-unavail">—</span>`;

    const amtCell = z.amt !== null
      ? `<span class="amt-text ${z.key}">${fmtInt(z.amt)}</span><span class="amt-unit">THB</span>`
      : `<span class="amt-unavail">ไม่มีสิทธิ์</span>`;

    return `
      <tr class="zone-${z.key}${assignedCls}">
        <td>${nameCell}</td>
        <td class="col-pct">${pctCell}</td>
        <td class="col-amt">${amtCell}</td>
      </tr>`;
  }).join('');

  return `
    <div class="product-card">
      <div class="card-top">
        <div class="product-name-row">✅ ${esc(p.productLabel)}</div>
        <div class="product-meta">
          ${p.billCount} บิล &nbsp;·&nbsp; DPD สูงสุด ${p.maxDaysPastDue} วัน
          &nbsp;·&nbsp; บิลเก่าสุด ${esc(p.earliestDueDate)}
        </div>
      </div>
      <div class="card-total">
        <span class="total-label">ยอดค้างรวม:</span>
        <span class="total-value">${fmt(p.totalDue)}</span>
        <span class="total-unit">THB</span>
      </div>
      <table class="zone-table">
        <thead>
          <tr>
            <th>Zone</th>
            <th class="col-pct">%</th>
            <th class="col-amt">ยอดที่เสนอได้ (ปัดขึ้น)</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
      <div class="dpd-note">
        📊 DPD สูงสุด ${p.maxDaysPastDue} วัน → ${zoneLabel(p.zone)} (${zoneRange(p.zone)})
      </div>
      ${p.pclRecommendation ? `
      <div class="pcl-rec-box">
        <div class="pcl-rec-label">🎯 แนะนำนำเสนอก่อน — ${p.recommendedOfferPct}% ของยอดค้าง (เพื่อใช้ต่อรอง)</div>
        <div class="pcl-rec-amount">
          <span class="pcl-rec-value">${fmtInt(p.recommendedOffer)}</span>
          <span class="pcl-rec-unit">THB</span>
        </div>
        <div class="pcl-rec-sub">ถ้าลูกค้าไม่ไหว ค่อยลดลงมาที่แผนนัดชำระ / ขั้นต่ำ ${fmtInt(p.pclMinAmount)} THB</div>
      </div>` : ''}
    </div>`;
}

function buildIneligibleCard(p) {
  const totalLine = p.totalDue
    ? `<div class="ineligible-total">ยอดค้าง: ${fmt(p.totalDue)} THB</div>`
    : '';
  return `
    <div class="ineligible-card">
      <span class="ineligible-icon">❌</span>
      <div class="ineligible-body">
        <div class="ineligible-name">${esc(p.productLabel)}</div>
        <div class="ineligible-reason">${esc(p.reason)}</div>
        ${totalLine}
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Panel: Discount (M-based tiers)
// M = ceil(DPD / 30)  แสดงเฉพาะ tier ที่ลูกค้าถึงแล้ว (minM ≤ M)
// ---------------------------------------------------------------------------
function renderDiscountPanel(groups) {
  const el = document.getElementById('discount-content');

  // แสดงเฉพาะสินเชื่อที่อยู่ใน DISCOUNT_ELIGIBLE_PRODUCTS
  const eligibleGroups = groups.filter(g =>
    DISCOUNT_ELIGIBLE_PRODUCTS.includes(g.productType)
  );

  if (!eligibleGroups.length) {
    el.innerHTML = '<div class="no-data">ไม่มีสินเชื่อที่รองรับส่วนลด</div>';
    return;
  }

  el.innerHTML = eligibleGroups.map(g => buildDiscountCard(g)).join('');
}

function buildDiscountCard(group) {
  const dpd   = group.maxDaysPastDue;
  const M     = Math.ceil(dpd / 30);
  const SCL_TYPES = ['SCL', 'SCL Nano', 'SCL P-loan'];
  const tiers = SCL_TYPES.includes(group.productType) ? DISCOUNT_TIERS_SCL : DISCOUNT_TIERS_SPL_PCL;

  // Tier ที่ลูกค้าถึงแล้ว (minM ≤ M) = แสดงทั้งหมดตั้งแต่ต้นจนถึง tier ปัจจุบัน
  const applicableTiers = tiers.filter(t => t.minM <= M);

  // Tier ที่ M ตกอยู่ในช่วง [minM, maxM] = tier ปัจจุบัน
  const currentTier = tiers.find(t => t.minM <= M && M <= t.maxM);

  const header = `
    <div class="disc-card">
      <div class="disc-header">
        💸 ${esc(group.productLabel)}
        <div class="disc-meta">${group.billCount} บิล &nbsp;·&nbsp; DPD สูงสุด ${dpd} วัน &nbsp;·&nbsp; <strong>M${M}</strong></div>
      </div>
      <div class="disc-total-row">
        <span class="disc-total-label">ยอดค้างรวม:</span>
        <span class="disc-total-value">${fmt(group.totalDue)}</span>
        <span class="disc-total-unit">THB</span>
      </div>`;

  if (!applicableTiers.length) {
    // M < 7 — ยังไม่ถึงเกณฑ์ส่วนลด
    return header + `
      <div class="disc-waive-notice">
        ℹ️ M${M} (DPD ${dpd} วัน) ยังไม่ถึงเกณฑ์ (ต้องถึง M7 ขึ้นไป)<br>
        <strong>ยังไม่มีสิทธิ์ส่วนลด</strong>
      </div>
    </div>`;
  }

  const tableRows = applicableTiers.map(tier => {
    const isCurrent  = tier === currentTier;
    const rangeLabel = tier.maxM === Infinity
      ? `M${tier.minM}+`
      : `M${tier.minM}–M${tier.maxM}`;
    const r = calculateDiscount(group.totalDue, [tier.maxPct])[0];
    return `
      <tr${isCurrent ? ' class="disc-current-tier"' : ''}>
        <td>
          ${rangeLabel}
          ${isCurrent ? '<span class="disc-m-badge">ปัจจุบัน</span>' : ''}
        </td>
        <td><span class="disc-pct">${tier.maxPct}%</span></td>
        <td><span class="disc-amt">${fmt(r.discountAmt)}</span><span class="disc-unit">THB</span></td>
        <td><span class="disc-actual">${fmtInt(r.actualAmt)}</span><span class="disc-unit">THB</span></td>
      </tr>`;
  }).join('');

  return header + `
      <table class="disc-table disc-m-table">
        <thead>
          <tr>
            <th class="col-m">ช่วง M</th>
            <th>% สูงสุด</th>
            <th>ส่วนลดที่ได้รับ</th>
            <th>ยอดชำระจริง</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>`;
}

// ---------------------------------------------------------------------------
// Panel: Exclude
// ---------------------------------------------------------------------------
function warmup(url) {
  if (url && !url.includes('YOUR_')) sendToBackground({ type: 'WARMUP', url }).catch(() => {});
}

function renderExcludePanel(groups) {
  warmup(typeof EXCLUDE_WEB_APP_URL !== 'undefined' ? EXCLUDE_WEB_APP_URL : '');
  const el = document.getElementById('exclude-content');

  if (!groups.length) {
    el.innerHTML = '<div class="no-data">ไม่มีข้อมูลบิล</div>';
    return;
  }

  el.innerHTML = `
    <div class="excl-card">

      <!-- 1. ประเภทการ Exclude -->
      <div class="excl-field">
        <div class="excl-label">1. ประเภทการ Exclude</div>
        <div class="excl-radio-group">
          <label><input type="radio" name="excl-type" value="ดึงออกชั่วคราว"> ดึงออกชั่วคราว</label>
          <label><input type="radio" name="excl-type" value="ดึงออกถาวร"> ดึงออกถาวร (ลูกค้าตาย, ลูกค้าติดคุก, ล้มละลาย)</label>
        </div>
      </div>

      <!-- 2. สาเหตุ -->
      <div class="excl-field">
        <div class="excl-label">2. สาเหตุของการ Exclude</div>
        <select id="excl-reason" class="excl-select">
          <option value="">— เลือกสาเหตุ —</option>
          <optgroup label="กลุ่ม 1">
            <option>กดปิดผิด หรือบันทึกข้อมูลไม่ได้</option>
            <option>หน้าจอไม่ขึ้นให้บันทึก / หน้าจอค้าง</option>
            <option>บันทึกไม่ได้เนื่องจากมีสายซ้อน</option>
            <option>ได้เจรจากับลูกค้าแต่บันทึกผิดเป็น Hang up, Call back</option>
            <option>Ec ส่งสายให้ลค.เจรจาแต่ไม่ได้นัดชำระ</option>
            <option>ลูกค้า OA</option>
            <option>ลูกค้าป่วยหนัก / ICU</option>
          </optgroup>
          <optgroup label="กลุ่ม 2">
            <option>บันทึก Next Call Date ผิด</option>
            <option>Customer service รับเรื่อง, ส่งเรื่อง</option>
            <option>ลูกค้าเสียชีวิต / ลูกค้าติดคุก / อยู่ต่างประเทศ</option>
            <option>เคสสุ่มเสียง Complain</option>
            <option>ลูกค้าล้มละลาย</option>
          </optgroup>
          <optgroup label="กลุ่ม 3">
            <option>เพื่อปรับปรุงโครงสร้างหนี้</option>
            <option value="__other__">อื่นๆ (ระบุเพิ่มเติม)</option>
          </optgroup>
        </select>
      </div>
      <div class="excl-field" id="excl-reason-other-wrap" style="display:none">
        <div class="excl-label">✏️ ระบุสาเหตุเพิ่มเติม</div>
        <input type="text" id="excl-reason-other" class="excl-input" placeholder="กรอกสาเหตุ...">
      </div>

      <!-- 3. สถานะนัดชำระ -->
      <div class="excl-field">
        <div class="excl-label">3. สถานะนัดชำระ</div>
        <div class="excl-radio-inline">
          <label><input type="radio" name="excl-appoint" value="YES"> YES</label>
          <label><input type="radio" name="excl-appoint" value="NO"> NO</label>
        </div>
      </div>

      <!-- 3b. ยอดนัดชำระ — แสดงเฉพาะเมื่อเลือก YES -->
      <div class="excl-field" id="excl-ptp-amount-field" style="display:none;">
        <div class="excl-label">ยอดนัดชำระ (บาท)</div>
        <input type="number" id="excl-ptp-amount" class="excl-text-input"
               placeholder="0.00" min="0" step="0.01"
               style="width:100%;padding:6px 8px;border:1px solid #ccc;border-radius:6px;font-size:0.85rem;">
      </div>

      <!-- 4. Delinquent -->
      <div class="excl-field">
        <div class="excl-label">4. Delinquent</div>
        <div class="excl-radio-inline">
          <label><input type="radio" name="excl-delinquent" value="M1"> M1</label>
          <label><input type="radio" name="excl-delinquent" value="M2-M4"> M2-M4</label>
          <label><input type="radio" name="excl-delinquent" value="M5++"> M5++</label>
          <label><input type="radio" name="excl-delinquent" value="Seller"> Seller</label>
        </div>
      </div>

      <!-- 5. Next Calling Date -->
      <div class="excl-field">
        <div class="excl-label">5. Next Calling Date</div>
        <input type="date" id="excl-next-date" class="excl-date">
      </div>

    </div>

    <div id="excl-error" class="excl-error-msg"></div>
    <button id="excl-submit-btn" class="excl-submit-btn">🚫 กดเพื่อ Exclude</button>`;

  document.getElementById('excl-submit-btn').addEventListener('click', () => {
    saveExcludeRecord(groups);
  });

  // Show/hide ยอดนัดชำระ field based on YES/NO selection
  document.getElementById('excl-reason').addEventListener('change', function() {
    const wrap = document.getElementById('excl-reason-other-wrap');
    wrap.style.display = this.value === '__other__' ? '' : 'none';
    if (this.value !== '__other__') document.getElementById('excl-reason-other').value = '';
  });

  document.querySelectorAll('input[name="excl-appoint"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const isYes = document.querySelector('input[name="excl-appoint"]:checked')?.value === 'YES';
      document.getElementById('excl-ptp-amount-field').style.display = isYes ? '' : 'none';
      if (!isYes) document.getElementById('excl-ptp-amount').value = '';
    });
  });
}

async function saveExcludeRecord(groups) {
  const btn      = document.getElementById('excl-submit-btn');
  const errorEl  = document.getElementById('excl-error');
  errorEl.style.display = 'none';

  // Read form values
  const excludeType     = document.querySelector('input[name="excl-type"]:checked')?.value || '';
  const reasonRaw       = document.getElementById('excl-reason').value;
  const reasonOther     = document.getElementById('excl-reason-other').value.trim();
  const reason          = reasonRaw === '__other__' ? ('อื่นๆ: ' + reasonOther) : reasonRaw;
  const appointStatus   = document.querySelector('input[name="excl-appoint"]:checked')?.value || '';
  const ptpAmount       = appointStatus === 'YES' ? (document.getElementById('excl-ptp-amount').value || '') : '';
  const delinquent      = document.querySelector('input[name="excl-delinquent"]:checked')?.value || '';
  const nextCallingDate = document.getElementById('excl-next-date').value;

  // รวม Product Label ทุกตัวด้วย ,
  const productLabel  = groups.map(g => g.productLabel).join(', ');
  const maxDaysPastDue = Math.max(...groups.map(g => g.maxDaysPastDue));

  // Validate
  const missing = [];
  if (!excludeType)                              missing.push('ประเภทการ Exclude');
  if (!reasonRaw)                                missing.push('สาเหตุ');
  if (reasonRaw === '__other__' && !reasonOther) missing.push('ระบุสาเหตุเพิ่มเติม');
  if (!appointStatus) missing.push('สถานะนัดชำระ');
  if (!delinquent)    missing.push('Delinquent');
  // Next Calling Date เป็น optional — ไม่บังคับ

  if (missing.length) {
    errorEl.textContent = 'กรุณากรอก: ' + missing.join(', ');
    errorEl.style.display = 'block';
    return;
  }

  // แสดงผลทันที — ไม่รอ Apps Script (optimistic UI)
  btn.disabled    = true;
  btn.textContent = '✅ บันทึกแล้ว';
  btn.classList.remove('saving');
  btn.classList.add('saved');

  const payload = {
    type:           'EXCLUDE',
    timestamp:      new Date().toISOString(),
    agentEmail:     currentResult?.agentEmail   || '',
    creditUserId:   currentResult?.creditUserId || '',
    name:           currentResult?.name         || '',
    caseId:         currentResult?.caseId       || '',
    productLabel,    // ทุก product คั่นด้วย ,
    maxDaysPastDue,  // DPD สูงสุดในเคส
    excludeType,
    reason,
    appointStatus,
    ptpAmount,
    delinquent,
    nextCallingDate,
  };

  // ส่งข้อมูลตรงจาก popup — ถ้า error แสดงเตือนเบาๆ ด้านล่าง
  sheetsFetch(EXCLUDE_WEB_APP_URL, payload)
    .catch(err => {
      errorEl.textContent = '⚠️ บันทึกอาจไม่สำเร็จ: ' + err.message + ' (กรุณากด refresh แล้วลองใหม่)';
      errorEl.style.display = 'block';
      btn.textContent = '🚫 กดเพื่อ Exclude';
      btn.classList.remove('saved');
      btn.disabled = false;
    });
}

// ---------------------------------------------------------------------------
// Panel: Restructure Loan (RL)
// ---------------------------------------------------------------------------
function renderRLPanel(groups) {
  const el = document.getElementById('rl-content');

  if (!groups.length) {
    el.innerHTML = '<div class="no-data">ไม่มีข้อมูลบิล</div>';
    return;
  }

  el.innerHTML = groups.map(g => buildRLCard(g)).join('');

  // Event delegation — handle "กดเพื่อบันทึก" for all products
  el.querySelectorAll('.rl-save-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const productType = btn.dataset.product;
      const group = groups.find(g => g.productType === productType);
      if (group) await saveRLRecord(group, btn);
    });
  });
}

function buildRLCard(group) {
  const dpd       = group.maxDaysPastDue;
  const isOverDPD = dpd > RL_DPD_THRESHOLD;

  // SPL CCC / SPLX CCC — ลูกค้าต้องกรอกเว็บฟอร์มเอง เสมอ ไม่ว่า DPD จะเท่าไร
  const forceWebForm = RL_ALWAYS_WEB_FORM_PRODUCTS.includes(group.productType);

  const dpdBadge = `<span class="rl-dpd-badge ${isOverDPD ? 'over' : 'under'}">DPD ${dpd} วัน</span>`;

  if (isOverDPD && !forceWebForm) {
    // DPD > 61 — พนักงานกรอกแบบฟอร์มให้ลูกค้า + บันทึกลง Sheets
    const formLink = RL_STAFF_FORM_URL
      ? `<a class="rl-form-btn staff" href="${RL_STAFF_FORM_URL}" target="_blank">📋 เปิดแบบฟอร์มพนักงาน</a>`
      : '';

    return `
      <div class="rl-card rl-staff">
        <div class="rl-card-header">
          📋 ${esc(group.productLabel)} ${dpdBadge}
          <div class="rl-card-meta">${group.billCount} บิล &nbsp;·&nbsp; DPD สูงสุด ${dpd} วัน</div>
        </div>
        <div class="rl-notice">
          <strong>หากลูกค้าร้องขอ Restructure — ให้พนักงานกรอกแบบฟอร์ม</strong>
          DPD เกิน ${RL_DPD_THRESHOLD} วัน ลูกค้าไม่สามารถยื่นเองผ่านเว็บได้
          พนักงานต้องดำเนินการแทนและบันทึกข้อมูลเคส
        </div>
        <div class="rl-action-row">
          ${formLink}
          <button class="rl-save-btn" data-product="${esc(group.productType)}">
            📋 กดเพื่อกรอกแบบฟอร์ม
          </button>
        </div>
      </div>`;
  } else {
    // DPD ≤ 61 หรือ forceWebForm — แนะนำลูกค้ากรอกเว็บฟอร์มเอง
    const btnHtml = RL_WEB_FORM_URL
      ? `<a class="rl-form-btn web" href="${RL_WEB_FORM_URL}" target="_blank">🌐 เปิดเว็บฟอร์มลูกค้า</a>`
      : `<button class="rl-form-btn web" disabled>🌐 เว็บฟอร์มลูกค้า (ยังไม่ได้ตั้งค่า URL)</button>`;

    return `
      <div class="rl-card rl-web">
        <div class="rl-card-header">
          🌐 ${esc(group.productLabel)} ${dpdBadge}
          <div class="rl-card-meta">${group.billCount} บิล &nbsp;·&nbsp; DPD สูงสุด ${dpd} วัน</div>
        </div>
        <div class="rl-notice">
          <strong>แนะนำให้ลูกค้ากรอกเว็บฟอร์มด้วยตนเอง</strong>
          ${forceWebForm && isOverDPD
            ? 'ลูกค้าสามารถยื่นขอ Restructure ผ่านเว็บฟอร์มได้เลย'
            : `DPD ไม่เกิน ${RL_DPD_THRESHOLD} วัน ลูกค้าสามารถยื่นขอ Restructure ผ่านเว็บฟอร์มได้เลย`}
        </div>
        <div class="rl-action-row">${btnHtml}</div>
      </div>`;
  }
}

// ---------------------------------------------------------------------------
// RL: บันทึกข้อมูลเคสลง Google Sheets (DR Extension tab)
// ดึง: Credit User ID, Shopee User ID, Name, Agent email, Product, DPD
// ---------------------------------------------------------------------------
async function saveRLRecord(group, btn) {
  if (!currentResult || !currentTabId) {
    btn.textContent = '❌ ไม่มีข้อมูล';
    return;
  }

  // Button loading state
  btn.disabled    = true;
  btn.textContent = '⏳ กำลังบันทึก...';
  btn.classList.add('saving');

  // หาบิลเก่าสุด แล้วตัดเอาเฉพาะ DD (วันที่) เช่น "2025-03-05" → "05"
  const earliestDueDate = (group.bills || [])
    .map(b => b.dueDate)
    .filter(d => d)
    .sort()[0] || '';
  const dueDay = earliestDueDate ? earliestDueDate.split('-')[2] || '' : '';

  const payload = {
    type:         'RL',
    timestamp:    new Date().toISOString(),
    agentEmail:   currentResult.agentEmail   || '',
    creditUserId: currentResult.creditUserId || '',
    name:         currentResult.name         || '',
    shopeeUserId: currentResult.shopeeUserId || '',
    productLabel: group.productLabel,
    dueDay,
  };

  try {
    const res = await sheetsFetch(WEB_APP_URL, payload);
    // rowsWritten === 0 means Apps Script returned ok but wrote nothing —
    // most likely cause: old deployment without RL routing. Show error so
    // the user knows to redeploy rather than silently showing "saved".
    if (res && typeof res.rowsWritten === 'number' && res.rowsWritten === 0) {
      throw new Error('Apps Script ไม่ได้บันทึกข้อมูล (rowsWritten=0)\nกรุณา Redeploy Apps Script ใหม่');
    }
    btn.textContent = '✅ บันทึกแล้ว';
    btn.classList.remove('saving');
    btn.classList.add('saved');
  } catch (err) {
    btn.disabled    = false;
    btn.textContent = '❌ ล้มเหลว — กดลองใหม่';
    btn.classList.remove('saving');
    btn.classList.add('error');
    btn.title = err.message;
  }
}

// ---------------------------------------------------------------------------
// Panel: Interest calculator
// ---------------------------------------------------------------------------
function renderInterestPanel(groups) {
  const el = document.getElementById('interest-content');

  // Only show products that have interest rate config
  const calcGroups = groups.filter(g => INTEREST_RATES[g.productType]);

  if (!calcGroups.length) {
    el.innerHTML = '<div class="int-empty">ไม่มีผลิตภัณฑ์ที่รองรับการคำนวณดอกเบี้ย<br>(รองรับ: SPL, SPLX, BCL, SCL)</div>';
    return;
  }

  el.innerHTML = calcGroups.map(g => buildInterestCard(g)).join('');
}

function buildInterestCard(group) {
  const variants = INTEREST_RATES[group.productType];
  const opts = variants.map((v, i) =>
    `<option value="${v.annualPct}" ${i === 0 ? 'selected' : ''}>${esc(v.label)}</option>`
  ).join('');

  return `
    <div class="int-card" data-product="${esc(group.productType)}">
      <div class="int-header">
        📊 ${esc(group.productLabel)}
        <div class="int-meta">${group.billCount} บิล &nbsp;·&nbsp; DPD สูงสุด ${group.maxDaysPastDue} วัน</div>
      </div>
      <div class="int-form">
        <div class="int-form-row">
          <label>อัตราดอกเบี้ย</label>
          <select class="rate-sel">${opts}</select>
        </div>
        <div class="int-form-row">
          <label>เงินต้น (THB)</label>
          <input type="number" class="principal-inp" placeholder="ระบุเงินต้นจากค่างวด" step="0.01" min="0">
        </div>
        <div class="int-form-row">
          <label>จำนวนวัน</label>
          <input type="number" class="days-inp" value="${group.maxDaysPastDue}" min="0">
        </div>
      </div>
      <div class="int-result">
        <span class="int-hint">ระบุเงินต้นเพื่อคำนวณ</span>
      </div>
    </div>`;
}

function updateInterestCard(card) {
  const principal = parseFloat(card.querySelector('.principal-inp')?.value || '0');
  const days      = parseInt(card.querySelector('.days-inp')?.value        || '0', 10);
  const annualPct = parseFloat(card.querySelector('.rate-sel')?.value      || '0');
  const resultEl  = card.querySelector('.int-result');
  if (!resultEl) return;

  if (!principal || principal <= 0) {
    resultEl.innerHTML = '<span class="int-hint">ระบุเงินต้นเพื่อคำนวณ</span>';
    return;
  }

  const { dailyAmt, totalAmt } = calculateInterest(principal, days, annualPct);

  resultEl.innerHTML = `
    <div class="ir-row">
      <span class="ir-label">ดอกเบี้ยต่อวัน:</span>
      <span class="ir-val">${fmt(dailyAmt)}</span>
      <span class="ir-unit">THB/วัน</span>
    </div>
    <div class="ir-row">
      <span class="ir-label">รวมดอกเบี้ยล่าช้า (${days} วัน):</span>
      <span class="ir-val total">${fmt(totalAmt)}</span>
      <span class="ir-unit">THB</span>
    </div>`;
}

// ---------------------------------------------------------------------------
// Panel: ดึงเบอร์ (Phone)
// ---------------------------------------------------------------------------
function renderPhonePanel(result) {
  const el = document.getElementById('phone-content');

  el.innerHTML = `
    <div class="excl-card">
      <div class="excl-field">
        <div class="excl-label">สถานะเบอร์</div>
        <div class="excl-radio-inline">
          <label><input type="radio" name="phone-status" value="Primary"> Primary</label>
          <label><input type="radio" name="phone-status" value="EC"> EC</label>
          <label><input type="radio" name="phone-status" value="อื่นๆ"> อื่นๆ</label>
        </div>
      </div>
      <div class="excl-field">
        <div class="excl-label">เบอร์โทร</div>
        <input type="tel" id="phone-number"
               placeholder="0XX-XXX-XXXX"
               style="width:100%;padding:6px 8px;border:1px solid #ccc;border-radius:6px;font-size:0.85rem;">
      </div>
    </div>
    <div id="phone-error" class="excl-error-msg"></div>
    <button id="phone-submit-btn" class="excl-submit-btn" style="background:#00695c;">📞 กดเพื่อบันทึกเบอร์</button>`;

  document.getElementById('phone-submit-btn').addEventListener('click', savePhoneRecord);
}

async function savePhoneRecord() {
  const btn     = document.getElementById('phone-submit-btn');
  const errorEl = document.getElementById('phone-error');
  errorEl.style.display = 'none';

  const phoneStatus = document.querySelector('input[name="phone-status"]:checked')?.value || '';
  const phoneNumber = (document.getElementById('phone-number').value || '').trim();

  const missing = [];
  if (!phoneStatus) missing.push('สถานะเบอร์');
  if (!phoneNumber) missing.push('เบอร์โทร');

  if (missing.length) {
    errorEl.textContent = 'กรุณากรอก: ' + missing.join(', ');
    errorEl.style.display = 'block';
    return;
  }

  btn.disabled    = true;
  btn.textContent = '⏳ กำลังบันทึก...';
  btn.classList.add('saving');

  const payload = {
    type:         'PHONE',
    timestamp:    new Date().toISOString(),
    agentEmail:   currentResult?.agentEmail   || '',
    creditUserId: currentResult?.creditUserId || '',
    name:         currentResult?.name         || '',
    phoneStatus,
    phoneNumber,
  };

  try {
    const res = await sheetsFetch(PHONE_WEB_APP_URL, payload);
    if (res && typeof res.rowsWritten === 'number' && res.rowsWritten === 0) {
      throw new Error('Apps Script ไม่ได้บันทึกข้อมูล (rowsWritten=0)\nกรุณา Redeploy Apps Script ใหม่');
    }
    btn.textContent = '✅ บันทึกแล้ว';
    btn.classList.remove('saving');
    btn.classList.add('saved');
    btn.style.background = '#2e7d32';
  } catch (err) {
    btn.disabled    = false;
    btn.textContent = '📞 กดเพื่อบันทึกเบอร์';
    btn.classList.remove('saving');
    btn.style.background = '#00695c';
    errorEl.textContent = '❌ บันทึกไม่สำเร็จ: ' + err.message;
    errorEl.style.display = 'block';
  }
}

// ---------------------------------------------------------------------------
// Panel: SMS Trigger
// ---------------------------------------------------------------------------
function renderSmsPanel(result) {
  warmup(typeof SMS_WEB_APP_URL !== 'undefined' ? SMS_WEB_APP_URL : '');
  const el = document.getElementById('sms-content');
  const groups = result.allActiveGroups || [];

  // Build product options — store productLabel → totalDue mapping via data-total
  const productOptions = groups.length
    ? groups.map(g => {
        const label = g.productLabel || g.productType;
        const total = g.totalDue != null ? g.totalDue : '';
        return `<option value="${esc(label)}" data-total="${total}">${esc(label)}</option>`;
      }).join('')
    : '';

  // Today's date as default for appointment
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  el.innerHTML = `
    <div class="sms-field">
      <div class="sms-label">🏷️ เลือก Product</div>
      <select id="sms-product" class="sms-select">
        <option value="" data-total="">— เลือก Product —</option>
        ${productOptions}
      </select>
    </div>
    <div class="sms-field">
      <div class="sms-label">🏦 ธนาคาร</div>
      <select id="sms-bank" class="sms-select">
        <option value="">— เลือกธนาคาร —</option>
        <option value="ธนาคารกรุงเทพ">1 ธนาคารกรุงเทพ</option>
        <option value="ธนาคารกสิกรไทย">2 ธนาคารกสิกรไทย</option>
        <option value="ธนาคารกรุงไทย">3 ธนาคารกรุงไทย</option>
        <option value="ธนาคารไทยพาณิชย์">4 ธนาคารไทยพาณิชย์</option>
      </select>
    </div>
    <div class="sms-field">
      <div class="sms-label">💳 ประเภทการชำระ</div>
      <div style="display:flex;gap:8px;margin-bottom:6px;">
        <label style="display:flex;align-items:center;gap:4px;font-size:0.85rem;cursor:pointer;">
          <input type="radio" name="sms-payment-type" value="Partial"> Partial
        </label>
        <label style="display:flex;align-items:center;gap:4px;font-size:0.85rem;cursor:pointer;">
          <input type="radio" name="sms-payment-type" value="Full amount"> Full amount
        </label>
      </div>
      <div style="position:relative;">
        <input type="number" id="sms-amount" class="sms-input" placeholder="ยอดชำระ (THB)" min="0" step="0.01">
        <span id="sms-amount-hint" style="display:none;font-size:0.77rem;color:#1565c0;margin-top:2px;display:block;"></span>
      </div>
    </div>
    <div class="sms-field">
      <div class="sms-label">📅 วันที่นัดชำระ</div>
      <input type="date" id="sms-appt-date" class="sms-input" value="${todayStr}">
    </div>
    <div class="sms-field">
      <div class="sms-label">📱 เบอร์โทร</div>
      <input type="tel" id="sms-phone" class="sms-input" placeholder="0XX-XXX-XXXX">
    </div>
    <div id="sms-error" class="excl-error-msg"></div>
    <button id="sms-submit-btn" class="sms-submit-btn">💬 ส่ง SMS Trigger</button>`;

  // ── Auto-fill amount when Full amount is selected or product changes ──────
  function tryAutoFillAmount() {
    const sel         = document.getElementById('sms-product');
    const payType     = document.querySelector('input[name="sms-payment-type"]:checked')?.value;
    const amountInput = document.getElementById('sms-amount');
    const hint        = document.getElementById('sms-amount-hint');
    if (payType === 'Full amount' && sel.value) {
      const opt   = sel.options[sel.selectedIndex];
      const total = opt.dataset.total;
      if (total !== '') {
        amountInput.value = total;
        hint.textContent  = `✔ ดึงยอดค้างรวม ${Number(total).toLocaleString()} THB จาก ${sel.value}`;
        hint.style.display = 'block';
        return;
      }
    }
    hint.style.display = 'none';
    // Clear auto-filled value if switching away from Full amount
    if (payType !== 'Full amount') amountInput.value = '';
  }

  document.getElementById('sms-product').addEventListener('change', tryAutoFillAmount);
  document.querySelectorAll('input[name="sms-payment-type"]').forEach(r =>
    r.addEventListener('change', tryAutoFillAmount)
  );

  document.getElementById('sms-submit-btn').addEventListener('click', saveSmsRecord);
}

async function saveSmsRecord() {
  const btn     = document.getElementById('sms-submit-btn');
  const errorEl = document.getElementById('sms-error');
  errorEl.style.display = 'none';

  const product     = document.getElementById('sms-product').value.trim();
  const bank        = document.getElementById('sms-bank').value;
  const paymentType = document.querySelector('input[name="sms-payment-type"]:checked')?.value || '';
  const amount      = document.getElementById('sms-amount').value.trim();
  const apptDate    = document.getElementById('sms-appt-date').value;
  const phone       = document.getElementById('sms-phone').value.trim();

  const missing = [];
  if (!product)     missing.push('Product');
  if (!bank)        missing.push('ธนาคาร');
  if (!paymentType) missing.push('ประเภทการชำระ');
  if (!amount)      missing.push('ยอดชำระ');
  if (!apptDate)    missing.push('วันที่นัดชำระ');
  if (!phone)       missing.push('เบอร์โทร');

  if (missing.length) {
    errorEl.textContent = 'กรุณากรอก: ' + missing.join(', ');
    errorEl.style.display = 'block';
    return;
  }

  if (!SMS_WEB_APP_URL) {
    errorEl.textContent = '❌ ยังไม่ได้ตั้งค่า SMS_WEB_APP_URL ใน config.js';
    errorEl.style.display = 'block';
    return;
  }

  btn.disabled    = true;
  btn.textContent = '⏳ กำลังส่ง...';

  const payload = {
    type:         'SMS',
    timestamp:    new Date().toISOString(),
    agentEmail:   currentResult?.agentEmail   || '',
    creditUserId: currentResult?.creditUserId || '',
    name:         currentResult?.name         || '',
    product,
    bank,
    paymentType,
    amount,
    apptDate,
    phone,
  };

  try {
    const res = await sheetsFetch(SMS_WEB_APP_URL, payload);
    if (res && typeof res.rowsWritten === 'number' && res.rowsWritten === 0) {
      throw new Error('Apps Script ไม่ได้บันทึกข้อมูล (rowsWritten=0)\nกรุณา Redeploy Apps Script ใหม่');
    }
    btn.textContent = '✅ ส่งแล้ว';
    btn.classList.add('saved');
  } catch (err) {
    btn.disabled    = false;
    btn.textContent = '💬 ส่ง SMS Trigger';
    btn.classList.remove('saved');
    errorEl.textContent = '❌ บันทึกไม่สำเร็จ: ' + err.message;
    errorEl.style.display = 'block';
  }
}

// ---------------------------------------------------------------------------
// Draft auto-save system
// Key: draft_{caseId}_{panelId}  → scoped per case, resets when case changes
// ---------------------------------------------------------------------------
function _draftKey(panelId) {
  return 'draft_' + (currentResult?.caseId || 'x') + '_' + panelId;
}

// บันทึกค่าทุก input/select/textarea ใน container
function _saveDraft(panelId, containerId) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;
  const data = {};
  wrap.querySelectorAll('input,select,textarea').forEach(el => {
    if (el.id) data[el.id] = el.value;
  });
  chrome.storage.local.set({ [_draftKey(panelId)]: data });
}

// โหลด draft จาก storage
function _loadDraft(panelId) {
  return new Promise(resolve => {
    chrome.storage.local.get(_draftKey(panelId), r =>
      resolve(r[_draftKey(panelId)] || null)
    );
  });
}

// ลบ draft (เรียกหลัง submit สำเร็จ)
function _clearDraft(panelId) {
  chrome.storage.local.remove(_draftKey(panelId));
}

// คืนค่า draft ลง DOM แล้ว trigger change บน select เพื่ออัปเดต conditional fields
function _applyDraft(data) {
  if (!data) return;
  Object.entries(data).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  });
  // trigger change บน select ให้ conditional visibility ทำงาน
  Object.keys(data).forEach(id => {
    const el = document.getElementById(id);
    if (el && el.tagName === 'SELECT') {
      el.dispatchEvent(new Event('change'));
    }
  });
}

// ผูก event delegation บน container → auto-save ทุก field change
function _wireDraft(panelId, containerId) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;
  const save = () => _saveDraft(panelId, containerId);
  wrap.addEventListener('input',  save);
  wrap.addEventListener('change', save);
}

// ---------------------------------------------------------------------------
// Panel: Request Discount
// ---------------------------------------------------------------------------
function renderRequestDiscountPanel(result) {
  warmup(typeof REQUEST_DISCOUNT_WEB_APP_URL !== 'undefined' ? REQUEST_DISCOUNT_WEB_APP_URL : '');
  const el     = document.getElementById('rdiscount-content');
  const groups = result.allActiveGroups || [];

  const today    = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  const productOptions = groups.length
    ? groups.map(g => {
        const label    = g.productLabel || g.productType;
        const dpd      = g.maxDaysPastDue != null ? g.maxDaysPastDue : 0;
        const M        = dpd > 0 ? Math.ceil(dpd / 30) : 0;
        const totalDue = g.totalDue || 0;
        const dueFull  = (g.bills || []).map(b => b.dueDate).filter(d => d).sort().reverse()[0] || '';
        return `<option value="${esc(label)}" data-type="${esc(g.productType)}" data-dpd="${dpd}" data-m="${M}" data-total="${totalDue}" data-due="${esc(dueFull)}">${esc(label)}</option>`;
      }).join('')
    : '';

  el.innerHTML = `
    <div class="sms-field">
      <div class="sms-label">📋 จำนวนงวด</div>
      <select id="rd-installments" class="sms-select">
        <option value="1" selected>1 งวด</option>
        <option value="2">2 งวด</option>
        <option value="3">3 งวด</option>
      </select>
    </div>

    <div class="sms-field">
      <div class="sms-label">🏷️ Product</div>
      <select id="rd-product" class="sms-select">
        <option value="" data-type="" data-dpd="0" data-m="0" data-total="0" data-due="">— เลือก Product —</option>
        ${productOptions}
      </select>
    </div>

    <div id="rd-product-info" style="display:none;margin-bottom:6px;">
      <div style="background:#e8eaf6;border-radius:6px;padding:8px 12px;font-size:0.85rem;line-height:2;">
        <div>💰 ยอดค้างรวม: <strong id="rd-total-display" style="color:#1a237e;font-size:1rem;">—</strong> <span style="color:#666;">THB</span></div>
        <div>📊 จำนวน M ค้างชำระ: <strong id="rd-m-display" style="color:#5c6bc0;">—</strong>&nbsp;&nbsp;|&nbsp;&nbsp;DPD: <strong id="rd-dpd-display" style="color:#5c6bc0;">—</strong> วัน</div>
        <div>🔖 ส่วนลดสูงสุด (ตามเกณฑ์): <strong id="rd-maxpct-display" style="color:#2e7d32;">—</strong></div>
      </div>
    </div>

    <div class="sms-field">
      <div class="sms-label">💵 ยอดที่นัดชำระ (THB)</div>
      <input type="number" id="rd-promised" class="sms-input" placeholder="ระบุยอดนัดชำระ" min="0" step="0.01">
    </div>

    <div id="rd-rate-wrap" style="display:none;margin:2px 0 10px 0;">
      <div style="background:#f5f5f5;border-radius:6px;padding:10px 14px;">
        <div style="text-align:center;margin-bottom:6px;">
          <span style="color:#555;font-size:0.85rem;">Discount Rate: </span>
          <strong id="rd-rate-value" style="font-size:1.15rem;">—</strong>
        </div>
        <div id="rd-per-install-wrap" style="display:none;background:#fff;border-radius:5px;padding:6px 10px;margin-bottom:6px;text-align:center;border:1px solid #e0e0e0;">
          <span style="color:#555;font-size:0.82rem;">💳 ยอดชำระต่องวด: </span>
          <strong id="rd-per-install-value" style="color:#1a237e;font-size:1rem;">—</strong>
          <span style="color:#666;font-size:0.82rem;"> THB/งวด</span>
        </div>
        <div id="rd-rate-status" style="font-size:0.82rem;text-align:center;"></div>
      </div>
    </div>

    <div class="sms-field">
      <div class="sms-label" id="rd-appt-label">📅 วันที่นัดชำระ</div>
      <input type="date" id="rd-appt-date" class="sms-input" value="${todayStr}">
    </div>

    <!-- ยอดชำระงวดแรก (แสดงเฉพาะเมื่อเลือก 2-3 งวด) -->
    <div class="sms-field" id="rd-inst1-wrap" style="display:none;">
      <div class="sms-label">💵 ยอดชำระงวดแรก (THB) <span style="color:#b71c1c;">*</span></div>
      <input type="number" id="rd-inst1-amount" class="sms-input" placeholder="ระบุยอดชำระงวดแรก" min="0" step="0.01">
    </div>

    <!-- ตารางสรุปงวด (แสดงเฉพาะเมื่อเลือก 2-3 งวด) -->
    <div id="rd-installment-table" style="display:none;margin-bottom:10px;">
      <div style="background:#e8eaf6;border-radius:8px;padding:10px 12px;">
        <div style="font-weight:bold;color:#1a237e;font-size:0.85rem;margin-bottom:8px;">📋 สรุปยอดชำระแต่ละงวด</div>

        <!-- งวดที่ 2 -->
        <div id="rd-inst2-section" style="border-top:1px solid #c5cae9;padding-top:8px;margin-top:4px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <strong style="color:#3949ab;font-size:0.85rem;">งวดที่ 2</strong>
            <span style="color:#1a237e;font-size:0.9rem;">💰 <strong id="rd-inst2-amount">—</strong> THB</span>
          </div>
          <div class="sms-field" style="margin:0;">
            <div class="sms-label" style="font-size:0.8rem;">📅 วันที่นัดชำระ งวดที่ 2</div>
            <input type="date" id="rd-inst2-date" class="sms-input">
          </div>
        </div>

        <!-- งวดที่ 3 (แสดงเฉพาะ 3 งวด) -->
        <div id="rd-inst3-section" style="display:none;border-top:1px solid #c5cae9;padding-top:8px;margin-top:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <strong style="color:#3949ab;font-size:0.85rem;">งวดที่ 3</strong>
            <span style="color:#1a237e;font-size:0.9rem;">💰 <strong id="rd-inst3-amount">—</strong> THB</span>
          </div>
          <div class="sms-field" style="margin:0;">
            <div class="sms-label" style="font-size:0.8rem;">📅 วันที่นัดชำระ งวดที่ 3</div>
            <input type="date" id="rd-inst3-date" class="sms-input">
          </div>
        </div>
      </div>
    </div>

    <div class="sms-field">
      <div class="sms-label">🏢 สินเชื่อ SME พ่วง</div>
      <select id="rd-sme" class="sms-select">
        <option value="ไม่มี" selected>ไม่มี</option>
        <option value="มี SME พ่วง">มี SME พ่วง</option>
      </select>
    </div>

    <div class="sms-field">
      <div class="sms-label">📝 Remark <span style="color:#9e9e9e;font-size:0.8rem;">(ไม่บังคับ)</span></div>
      <textarea id="rd-remark" class="sms-input" rows="2" placeholder="หมายเหตุเพิ่มเติม..." style="resize:vertical;min-height:50px;"></textarea>
    </div>

    <div id="rd-error" class="excl-error-msg"></div>
    <button id="rd-submit-btn" class="sms-submit-btn" style="background:#e65100;">📋 ส่ง Request Discount</button>`;

  // helper: refresh maxPct display ใน product-info
  function _rdRefreshMaxPct() {
    const productSel = document.getElementById('rd-product');
    if (!productSel?.value) return;
    const opt    = productSel.options[productSel.selectedIndex];
    const M      = parseInt(opt.dataset.m)   || 0;
    const pType  = opt.dataset.type || productSel.value;
    const inst   = parseInt(document.getElementById('rd-installments')?.value) || 1;
    const maxPct = _rdMaxPct(pType, M, inst);
    document.getElementById('rd-maxpct-display').textContent =
      maxPct != null ? maxPct + '%' : 'ไม่มีเกณฑ์ (M < 7)';
    document.getElementById('rd-maxpct-display').style.color =
      maxPct != null ? '#2e7d32' : '#9e9e9e';
  }

  // event: เลือก product
  document.getElementById('rd-product').addEventListener('change', function () {
    const opt      = this.options[this.selectedIndex];
    const totalDue = parseFloat(opt.dataset.total) || 0;
    const dpd      = parseInt(opt.dataset.dpd)     || 0;
    const M        = parseInt(opt.dataset.m)        || 0;
    const pType    = opt.dataset.type || this.value;
    const inst     = parseInt(document.getElementById('rd-installments')?.value) || 1;

    if (this.value) {
      document.getElementById('rd-product-info').style.display = '';
      document.getElementById('rd-total-display').textContent  = fmt(totalDue);
      document.getElementById('rd-m-display').textContent      = M  ? 'M' + M  : '—';
      document.getElementById('rd-dpd-display').textContent    = dpd ? dpd     : '—';
      const maxPct = _rdMaxPct(pType, M, inst);
      document.getElementById('rd-maxpct-display').textContent =
        maxPct != null ? maxPct + '%' : 'ไม่มีเกณฑ์ (M < 7)';
      document.getElementById('rd-maxpct-display').style.color =
        maxPct != null ? '#2e7d32' : '#9e9e9e';
    } else {
      document.getElementById('rd-product-info').style.display = 'none';
      document.getElementById('rd-rate-wrap').style.display    = 'none';
    }
    _rdUpdateRate();
  });

  // event: เปลี่ยนจำนวนงวด → คำนวณใหม่ + refresh maxPct + reset dates
  document.getElementById('rd-installments').addEventListener('change', function () {
    _rdRefreshMaxPct();
    _rdUpdateRate();
    _rdUpdateInstallments(true);
  });

  // event: กรอก ยอดนัดชำระ
  document.getElementById('rd-promised').addEventListener('input', function () {
    _rdUpdateRate();
    _rdUpdateInstallments(false);
  });

  // event: เปลี่ยนวันที่นัดชำระงวด 1 → reset default dates งวด 2-3
  document.getElementById('rd-appt-date').addEventListener('change', function () {
    _rdUpdateInstallments(true);
  });

  // event: กรอกยอดชำระงวดแรก → คำนวณยอดงวดที่เหลือ
  document.getElementById('rd-inst1-amount').addEventListener('input', function () {
    _rdUpdateInstallments(false);
  });

  document.getElementById('rd-submit-btn').addEventListener('click', saveRequestDiscountRecord);

  // draft: wire auto-save แล้ว restore
  _wireDraft('rd', 'rdiscount-content');
  _loadDraft('rd').then(_applyDraft);
}

// helper: คำนวณ discount rate แล้ว update UI
function _rdUpdateRate() {
  const productSel  = document.getElementById('rd-product');
  const opt         = productSel ? productSel.options[productSel.selectedIndex] : null;
  const totalDue    = parseFloat(opt?.dataset?.total)  || 0;
  const M           = parseInt(opt?.dataset?.m)         || 0;
  const pType       = opt?.dataset?.type || productSel?.value || '';
  const promised    = parseFloat(document.getElementById('rd-promised')?.value) || 0;
  const inst        = parseInt(document.getElementById('rd-installments')?.value) || 1;
  const wrap        = document.getElementById('rd-rate-wrap');
  const rateEl      = document.getElementById('rd-rate-value');
  const statusEl    = document.getElementById('rd-rate-status');
  const perInstWrap = document.getElementById('rd-per-install-wrap');
  const perInstEl   = document.getElementById('rd-per-install-value');

  if (!pType || totalDue <= 0 || promised <= 0) {
    if (wrap) wrap.style.display = 'none';
    return;
  }

  wrap.style.display = '';
  const rate   = ((totalDue - promised) / totalDue) * 100;
  const maxPct = _rdMaxPct(pType, M, inst);

  rateEl.textContent = rate.toFixed(2) + '%';

  // ยอดชำระต่องวด
  if (inst > 1 && promised > 0) {
    perInstWrap.style.display = '';
    perInstEl.textContent = fmt(promised / inst);
  } else {
    perInstWrap.style.display = 'none';
  }

  if (maxPct == null) {
    rateEl.style.color    = '#757575';
    statusEl.textContent  = '(ไม่มีเกณฑ์เปรียบเทียบ — M < 7)';
    statusEl.style.color  = '#757575';
  } else if (rate > maxPct) {
    rateEl.style.color    = '#b71c1c';
    statusEl.innerHTML    = `⚠️ <strong>เกินเงื่อนไข</strong> — ส่วนลดสูงสุดที่ได้รับคือ ${maxPct}%`;
    statusEl.style.color  = '#b71c1c';
  } else {
    rateEl.style.color    = '#2e7d32';
    statusEl.innerHTML    = `✅ อยู่ในเงื่อนไข — ส่วนลดสูงสุด ${maxPct}%`;
    statusEl.style.color  = '#2e7d32';
  }
}

// helper: หา maxPct จาก discount tiers
// inst = จำนวนงวด (1 = ใช้เกณฑ์เดิม, 2-3 = ใช้เกณฑ์ผ่อนชำระ)
function _rdMaxPct(productType, M, inst) {
  if (M < 7) return null; // ต่ำกว่า M7 ไม่มีเกณฑ์

  // เกณฑ์สำหรับ 2-3 งวด (ทุก product type)
  if (inst >= 2) {
    const TIERS_MULTI = [
      { minM:  7, maxM: 12, maxPct: 35 },
      { minM: 13, maxM: 18, maxPct: 45 },
      { minM: 19, maxM: 24, maxPct: 50 },
      { minM: 25, maxM: 36, maxPct: 50 },
      { minM: 37, maxM: 9999, maxPct: 55 },
    ];
    const tier = TIERS_MULTI.find(t => t.minM <= M && M <= t.maxM);
    return tier ? tier.maxPct : null;
  }

  // เกณฑ์สำหรับ 1 งวด — ใช้ config DISCOUNT_TIERS_SPL_PCL / DISCOUNT_TIERS_SCL
  if (typeof DISCOUNT_TIERS_SPL_PCL === 'undefined') return null;
  const SCL_TYPES = ['SCL', 'SCL Nano', 'SCL P-loan'];
  const tiers = SCL_TYPES.includes(productType) ? DISCOUNT_TIERS_SCL : DISCOUNT_TIERS_SPL_PCL;
  const tier  = (tiers || []).find(t => t.minM <= M && M <= t.maxM);
  return tier ? tier.maxPct : null;
}

// helper: เพิ่มเดือน (returns yyyy-mm-dd)
function addOneMonth(dateStr, months) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

// helper: อัปเดต UI รายละเอียดงวด 2-3
// resetDates=true → reset default dates จาก appt-date (เรียกเมื่อ installments หรือ appt-date เปลี่ยน)
// resetDates=false → อัปเดตแค่ยอด (เรียกเมื่อ inst1-amount หรือ promised เปลี่ยน)
function _rdUpdateInstallments(resetDates) {
  const inst     = parseInt(document.getElementById('rd-installments')?.value) || 1;
  const promised = parseFloat(document.getElementById('rd-promised')?.value)   || 0;
  const inst1    = parseFloat(document.getElementById('rd-inst1-amount')?.value) || 0;
  const apptDate = document.getElementById('rd-appt-date')?.value || '';

  const inst1Wrap = document.getElementById('rd-inst1-wrap');
  const instTable = document.getElementById('rd-installment-table');
  const inst3Sec  = document.getElementById('rd-inst3-section');
  const apptLabel = document.getElementById('rd-appt-label');

  if (inst < 2) {
    if (inst1Wrap) inst1Wrap.style.display = 'none';
    if (instTable) instTable.style.display = 'none';
    if (apptLabel) apptLabel.textContent   = '📅 วันที่นัดชำระ';
    return;
  }

  if (inst1Wrap) inst1Wrap.style.display = '';
  if (instTable) instTable.style.display = '';
  if (apptLabel) apptLabel.textContent   = '📅 วันที่นัดชำระ งวดที่ 1';

  const remaining = Math.max(0, promised - inst1);

  if (inst === 2) {
    if (inst3Sec) inst3Sec.style.display = 'none';
    const el2 = document.getElementById('rd-inst2-amount');
    if (el2) el2.textContent = remaining > 0 ? fmt(remaining) : '—';
  } else { // inst === 3
    if (inst3Sec) inst3Sec.style.display = '';
    const half = remaining / 2;
    const el2  = document.getElementById('rd-inst2-amount');
    const el3  = document.getElementById('rd-inst3-amount');
    if (el2) el2.textContent = remaining > 0 ? fmt(half) : '—';
    if (el3) el3.textContent = remaining > 0 ? fmt(half) : '—';
  }

  if (resetDates) {
    const d2 = document.getElementById('rd-inst2-date');
    const d3 = document.getElementById('rd-inst3-date');
    if (d2) d2.value = addOneMonth(apptDate, 1);
    if (d3) d3.value = addOneMonth(apptDate, 2);
  }
}

async function saveRequestDiscountRecord() {
  const btn     = document.getElementById('rd-submit-btn');
  const errorEl = document.getElementById('rd-error');
  errorEl.style.display = 'none';

  const productSel  = document.getElementById('rd-product');
  const product     = productSel.value.trim();
  const opt         = productSel.options[productSel.selectedIndex];
  const totalDue    = parseFloat(opt?.dataset?.total)  || 0;
  const M           = parseInt(opt?.dataset?.m)         || 0;
  const pType       = opt?.dataset?.type || product;
  const dueDateFull = opt?.dataset?.due  || '';
  const promised    = parseFloat(document.getElementById('rd-promised').value) || 0;
  const installments = document.getElementById('rd-installments').value;
  const instCount   = parseInt(installments) || 1;
  const apptDate    = document.getElementById('rd-appt-date').value;
  const sme         = document.getElementById('rd-sme')?.value || 'ไม่มี';
  const remark      = document.getElementById('rd-remark')?.value.trim() || '';

  // installment breakdown
  const inst1Amt  = instCount >= 2 ? (parseFloat(document.getElementById('rd-inst1-amount')?.value) || 0) : promised;
  const remaining = Math.max(0, promised - inst1Amt);
  const inst2Amt  = instCount >= 2 ? (instCount === 3 ? remaining / 2 : remaining) : 0;
  const inst3Amt  = instCount === 3 ? remaining / 2 : 0;
  const inst2Date = instCount >= 2 ? (document.getElementById('rd-inst2-date')?.value || '') : '';
  const inst3Date = instCount === 3 ? (document.getElementById('rd-inst3-date')?.value || '') : '';

  const missing = [];
  if (!product)                         missing.push('Product');
  if (!promised)                        missing.push('ยอดที่นัดชำระ');
  if (!apptDate)                        missing.push('วันที่นัดชำระ');
  if (instCount >= 2 && !inst1Amt)      missing.push('ยอดชำระงวดแรก');
  if (missing.length) {
    errorEl.textContent = 'กรุณากรอก: ' + missing.join(', ');
    errorEl.style.display = 'block';
    return;
  }

  if (typeof REQUEST_DISCOUNT_WEB_APP_URL === 'undefined' || REQUEST_DISCOUNT_WEB_APP_URL.includes('YOUR_')) {
    errorEl.textContent = '❌ ยังไม่ได้ตั้งค่า REQUEST_DISCOUNT_WEB_APP_URL ใน config.js';
    errorEl.style.display = 'block';
    return;
  }

  // decimal สำหรับ Google Sheets % format: 0.40 = 40%
  const discountRate = totalDue > 0
    ? parseFloat(((totalDue - promised) / totalDue).toFixed(4))
    : 0;

  // Due Date: ตัดเหลือแค่วันที่ (DD)
  const dueDateDD = dueDateFull ? dueDateFull.slice(-2).replace(/^0/, '') : '';

  btn.disabled    = true;
  btn.textContent = '⏳ กำลังส่ง...';

  const payload = {
    type:           'REQUEST_DISCOUNT',
    timestamp:      new Date().toISOString(),
    agentEmail:     currentResult?.agentEmail   || '',
    creditUserId:   currentResult?.creditUserId || '',
    name:           currentResult?.name         || '',
    dueDate:        dueDateDD,
    caseId:         currentResult?.caseId       || '',
    product,
    totalDue,
    promisedAmount: promised,
    discountRate,
    installments,
    inst1Amount: inst1Amt,
    inst1Date:   apptDate,
    inst2Amount: instCount >= 2 ? inst2Amt : '',
    inst2Date:   inst2Date,
    inst3Amount: instCount === 3 ? inst3Amt : '',
    inst3Date:   inst3Date,
    sme,
    remark,
  };

  try {
    const res = await sheetsFetch(REQUEST_DISCOUNT_WEB_APP_URL, payload);
    if (res && typeof res.rowsWritten === 'number' && res.rowsWritten === 0) {
      throw new Error('Apps Script ไม่ได้บันทึกข้อมูล (rowsWritten=0)\nกรุณา Redeploy Apps Script ใหม่');
    }
    btn.textContent       = '✅ ส่งแล้ว';
    btn.style.background  = '#2e7d32';
    btn.classList.add('saved');
    _clearDraft('rd');
  } catch (err) {
    btn.disabled          = false;
    btn.textContent       = '📋 ส่ง Request Discount';
    btn.style.background  = '#e65100';
    btn.classList.remove('saved');
    errorEl.textContent   = '❌ บันทึกไม่สำเร็จ: ' + err.message;
    errorEl.style.display = 'block';
  }
}

// ---------------------------------------------------------------------------
// Panel: Waive Request
// ---------------------------------------------------------------------------
function renderWaivePanel(result) {
  warmup(typeof WAIVE_WEB_APP_URL !== 'undefined' ? WAIVE_WEB_APP_URL : '');
  const el     = document.getElementById('waive-content');
  const groups = result.allActiveGroups || [];

  // Build product options — store dpd + latestDueDate per group
  const productOptions = groups.length
    ? groups.map(g => {
        const label   = g.productLabel || g.productType;
        const dpd     = g.maxDaysPastDue != null ? g.maxDaysPastDue : '';
        const dueFull = (g.bills || []).map(b => b.dueDate).filter(d => d).sort().reverse()[0] || '';
        const dueDate = dueFull ? (dueFull.split('-')[2] || dueFull) : ''; // เก็บแค่ DD
        return `<option value="${esc(label)}" data-dpd="${dpd}" data-due="${esc(dueDate)}">${esc(label)}</option>`;
      }).join('')
    : '';

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  el.innerHTML = `
    <div class="sms-field">
      <div class="sms-label">🏷️ Product</div>
      <select id="waive-product" class="sms-select">
        <option value="" data-dpd="" data-due="">— เลือก Product —</option>
        ${productOptions}
      </select>
    </div>
    <div class="sms-field" id="waive-info-row" style="display:none">
      <div style="background:#f3e5f5;border-radius:6px;padding:6px 10px;font-size:0.85rem;color:#4a148c;line-height:1.7;">
        <span>📊 Max DPD: <strong id="waive-dpd-val">—</strong> วัน</span>
        &nbsp;&nbsp;
        <span>📅 Due Date: <strong id="waive-due-val">—</strong></span>
      </div>
    </div>
    <div class="sms-field">
      <div class="sms-label">📅 วันที่นัดชำระ / วันที่ Waive</div>
      <input type="date" id="waive-appt-date" class="sms-input" value="${todayStr}">
    </div>
    <div class="sms-field">
      <div class="sms-label">💰 ยอดที่ต้องการ Waive (THB)</div>
      <input type="number" id="waive-amount" class="sms-input" placeholder="ระบุยอด" min="0" step="0.01">
    </div>
    <div class="sms-field">
      <div class="sms-label">📋 เหตุผลที่ร้องขอ</div>
      <select id="waive-reason" class="sms-select">
        <option value="">— เลือกเหตุผล —</option>
        <optgroup label="System error">
          <option>System error มีปัญหาการใช้แอพชำระเงิน</option>
          <option>System error ระบบ ShopeePay มีปัญหา</option>
          <option>System error Credit System มีปัญหา</option>
          <option>System error Auto repayment ไม่ตัดเงิน</option>
          <option>System error ไม่ได้รับการแจ้งเตือน</option>
        </optgroup>
        <optgroup label="User error">
          <option>User error ไม่ทราบวิธีชำระเงิน</option>
          <option>User error ไม่ทราบช่องทางการชำระเงิน</option>
          <option>User error ไม่ทราบวันครบรอบบิล</option>
          <option>User error ชำระมาแล้ว แต่ชำระผิดช่องทาง (ชำระให้ Shopee, เติมเงินให้ Wallet)</option>
          <option>User error ไม่ชี้แจงเหตุผลและยืนยันจะไม่ชำระ</option>
          <option>User error มีปัญหาด้านการเงินและร้องขอความช่วยเหลือ</option>
        </optgroup>
        <optgroup label="อื่นๆ">
          <option>ลูกค้าร้องขอเนื่องจากมีผลกระทบจากโควิด</option>
          <option>Discount programs</option>
          <option>Waive 100%</option>
          <option value="__other__">อื่นๆ (ระบุเพิ่มเติม)</option>
        </optgroup>
      </select>
    </div>
    <div class="sms-field" id="waive-reason-other-wrap" style="display:none">
      <div class="sms-label">✏️ ระบุเหตุผลเพิ่มเติม</div>
      <input type="text" id="waive-reason-other" class="sms-input" placeholder="กรอกเหตุผล...">
    </div>
    <div id="waive-error" class="excl-error-msg"></div>
    <button id="waive-submit-btn" class="sms-submit-btn" style="background:#880e4f;">💳 ส่ง Waive Request</button>`;

  // แสดง/ซ่อน text input "อื่นๆ" เมื่อเลือกเหตุผล
  document.getElementById('waive-reason').addEventListener('change', function() {
    const wrap = document.getElementById('waive-reason-other-wrap');
    wrap.style.display = this.value === '__other__' ? '' : 'none';
    if (this.value !== '__other__') document.getElementById('waive-reason-other').value = '';
  });

  // แสดง DPD + Due Date เมื่อเลือก product
  document.getElementById('waive-product').addEventListener('change', function() {
    const opt  = this.options[this.selectedIndex];
    const dpd  = opt.dataset.dpd;
    const due  = opt.dataset.due;
    const row  = document.getElementById('waive-info-row');
    if (this.value && (dpd !== '' || due)) {
      document.getElementById('waive-dpd-val').textContent = dpd !== '' ? dpd : '—';
      document.getElementById('waive-due-val').textContent = due || '—';
      row.style.display = '';
    } else {
      row.style.display = 'none';
    }
  });

  document.getElementById('waive-submit-btn').addEventListener('click', saveWaiveRecord);
}

async function saveWaiveRecord() {
  const btn     = document.getElementById('waive-submit-btn');
  const errorEl = document.getElementById('waive-error');
  errorEl.style.display = 'none';

  const productSel   = document.getElementById('waive-product');
  const product      = productSel.value.trim();
  const selectedOpt  = productSel.options[productSel.selectedIndex];
  const maxDpd       = selectedOpt ? (selectedOpt.dataset.dpd || '') : '';
  const dueDate      = selectedOpt ? (selectedOpt.dataset.due || '') : '';
  const apptDate     = document.getElementById('waive-appt-date').value;
  const waiveAmount  = document.getElementById('waive-amount').value.trim();
  const reasonRaw    = document.getElementById('waive-reason').value;
  const reasonOther  = document.getElementById('waive-reason-other').value.trim();
  const reason       = reasonRaw === '__other__' ? ('อื่นๆ: ' + reasonOther) : reasonRaw;
  const caseIdInbound= '';

  const missing = [];
  if (!product)     missing.push('Product');
  if (!apptDate)    missing.push('วันที่นัดชำระ');
  if (!waiveAmount) missing.push('ยอดที่ต้องการ Waive');
  if (!reasonRaw)   missing.push('เหตุผลที่ร้องขอ');
  if (reasonRaw === '__other__' && !reasonOther) missing.push('ระบุเหตุผลเพิ่มเติม');

  if (missing.length) {
    errorEl.textContent = 'กรุณากรอก: ' + missing.join(', ');
    errorEl.style.display = 'block';
    return;
  }

  if (typeof WAIVE_WEB_APP_URL === 'undefined' || WAIVE_WEB_APP_URL.includes('YOUR_')) {
    errorEl.textContent = '❌ ยังไม่ได้ตั้งค่า WAIVE_WEB_APP_URL ใน config.js';
    errorEl.style.display = 'block';
    return;
  }

  btn.disabled    = true;
  btn.textContent = '⏳ กำลังส่ง...';

  const payload = {
    type:          'WAIVE',
    timestamp:     new Date().toISOString(),
    agentEmail:    currentResult?.agentEmail    || '',
    creditUserId:  currentResult?.creditUserId  || '',
    caseIdAuto:    currentResult?.caseId        || '',
    name:          currentResult?.name          || '',
    product,
    maxDpd,
    dueDate,
    apptDate,
    waiveAmount,
    reason,
    caseIdInbound,
  };

  try {
    const res = await sheetsFetch(WAIVE_WEB_APP_URL, payload);
    if (res && typeof res.rowsWritten === 'number' && res.rowsWritten === 0) {
      throw new Error('Apps Script ไม่ได้บันทึกข้อมูล (rowsWritten=0)\nกรุณา Redeploy Apps Script ใหม่');
    }
    btn.textContent = '✅ ส่งแล้ว';
    btn.style.background = '#2e7d32';
    btn.classList.add('saved');
  } catch (err) {
    btn.disabled    = false;
    btn.textContent = '💳 ส่ง Waive Request';
    btn.style.background = '#880e4f';
    btn.classList.remove('saved');
    errorEl.textContent = '❌ บันทึกไม่สำเร็จ: ' + err.message;
    errorEl.style.display = 'block';
  }
}

// ---------------------------------------------------------------------------
// Panel: Refund Request
// ---------------------------------------------------------------------------
function renderRefundPanel(result) {
  warmup(typeof REFUND_WEB_APP_URL !== 'undefined' ? REFUND_WEB_APP_URL : '');
  const el     = document.getElementById('refund-content');
  const groups = result.allActiveGroups || [];

  const productOptions = groups.length
    ? groups.map(g => {
        const label   = g.productLabel || g.productType;
        const dpd     = g.maxDaysPastDue != null ? g.maxDaysPastDue : '';
        const dueFull = (g.bills || []).map(b => b.dueDate).filter(d => d).sort().reverse()[0] || '';
        const dueDD   = dueFull ? (dueFull.split('-')[2] || dueFull) : '';
        return `<option value="${esc(label)}" data-due="${esc(dueDD)}">${esc(label)}</option>`;
      }).join('')
    : '';

  el.innerHTML = `
    <div class="sms-field">
      <div class="sms-label">🏷️ Product</div>
      <select id="refund-product" class="sms-select">
        <option value="" data-due="">— เลือก Product —</option>
        ${productOptions}
      </select>
    </div>
    <div class="sms-field" id="refund-due-row" style="display:none">
      <div style="background:#e0f2f1;border-radius:6px;padding:6px 10px;font-size:0.85rem;color:#004d40;line-height:1.7;">
        📅 Due Date: <strong id="refund-due-val">—</strong>
      </div>
    </div>
    <div class="sms-field">
      <div class="sms-label">📋 รายการที่ขอคืน</div>
      <select id="refund-item" class="sms-select">
        <option value="">— เลือกรายการ —</option>
        <option>ดอกเบี้ยล่าช้า</option>
        <option>ค่าติดตามทวงถาม</option>
        <option>ดอกเบี้ยล่าช้าและค่าติดตามทวงถาม</option>
        <option>ลูกค้าขอส่วนลดแต่ชำระเข้ามายอดเต็ม (Discount)</option>
      </select>
    </div>
    <div class="sms-field">
      <div class="sms-label">📋 เหตุผลที่ร้องขอ</div>
      <select id="refund-reason" class="sms-select">
        <option value="">— เลือกเหตุผล —</option>
        <optgroup label="App error">
          <option>[App error] มีปัญหาการใช้แอพชำระเงิน (อยู่ระหว่างแก้ไข)</option>
        </optgroup>
        <optgroup label="User error">
          <option>[User error] ไม่ทราบกำหนดชำระ</option>
          <option>[User error] ไม่ทราบวิธีชำระ</option>
          <option>[User error] ไม่ได้รับการแจ้งเตือน</option>
          <option>[User error] ไม่มีช่องทางการชำระเงิน</option>
          <option>[User error] ชำระมาแล้ว แต่ชำระผิดช่องทาง (ชำระให้ Shopee, ชำระให้ ShopeePay)</option>
          <option>[User error] มีปัญหาด้านการเงินขอความช่วยเหลือและยืนยันจะไม่ชำระ</option>
        </optgroup>
        <optgroup label="System error">
          <option>[System error] ชำระแล้วตามกำหนดแต่ระบบไม่ตัดยอด</option>
        </optgroup>
        <optgroup label="อื่นๆ">
          <option value="__other__">อื่นๆ (ระบุเพิ่มเติม)</option>
        </optgroup>
      </select>
    </div>
    <div class="sms-field" id="refund-reason-other-wrap" style="display:none">
      <div class="sms-label">✏️ ระบุเหตุผลเพิ่มเติม</div>
      <input type="text" id="refund-reason-other" class="sms-input" placeholder="กรอกเหตุผล...">
    </div>
    <div id="refund-error" class="excl-error-msg"></div>
    <button id="refund-submit-btn" class="sms-submit-btn" style="background:#00695c;">💰 ส่ง Refund Request</button>`;

  document.getElementById('refund-product').addEventListener('change', function() {
    const opt  = this.options[this.selectedIndex];
    const due  = opt.dataset.due;
    const row  = document.getElementById('refund-due-row');
    if (this.value && due) {
      document.getElementById('refund-due-val').textContent = due;
      row.style.display = '';
    } else {
      row.style.display = 'none';
    }
  });

  document.getElementById('refund-reason').addEventListener('change', function() {
    const wrap = document.getElementById('refund-reason-other-wrap');
    wrap.style.display = this.value === '__other__' ? '' : 'none';
    if (this.value !== '__other__') document.getElementById('refund-reason-other').value = '';
  });

  document.getElementById('refund-submit-btn').addEventListener('click', saveRefundRecord);
}

async function saveRefundRecord() {
  const btn     = document.getElementById('refund-submit-btn');
  const errorEl = document.getElementById('refund-error');
  errorEl.style.display = 'none';

  const productSel  = document.getElementById('refund-product');
  const product     = productSel.value.trim();
  const selectedOpt = productSel.options[productSel.selectedIndex];
  const dueDate     = selectedOpt ? (selectedOpt.dataset.due || '') : '';
  const refundItem  = document.getElementById('refund-item').value;
  const reasonRaw   = document.getElementById('refund-reason').value;
  const reasonOther = document.getElementById('refund-reason-other').value.trim();
  const reason      = reasonRaw === '__other__' ? ('อื่นๆ: ' + reasonOther) : reasonRaw;

  const missing = [];
  if (!product)    missing.push('Product');
  if (!refundItem) missing.push('รายการที่ขอคืน');
  if (!reasonRaw)  missing.push('เหตุผลที่ร้องขอ');
  if (reasonRaw === '__other__' && !reasonOther) missing.push('ระบุเหตุผลเพิ่มเติม');

  if (missing.length) {
    errorEl.textContent = 'กรุณากรอก: ' + missing.join(', ');
    errorEl.style.display = 'block';
    return;
  }

  if (typeof REFUND_WEB_APP_URL === 'undefined' || REFUND_WEB_APP_URL.includes('YOUR_')) {
    errorEl.textContent = '❌ ยังไม่ได้ตั้งค่า REFUND_WEB_APP_URL ใน config.js';
    errorEl.style.display = 'block';
    return;
  }

  btn.disabled    = true;
  btn.textContent = '✅ ส่งแล้ว';
  btn.style.background = '#2e7d32';
  btn.classList.add('saved');

  const payload = {
    type:          'REFUND',
    timestamp:     new Date().toISOString(),
    agentEmail:    currentResult?.agentEmail    || '',
    creditUserId:  currentResult?.creditUserId  || '',
    name:          currentResult?.name          || '',
    shopeeUserId:  currentResult?.shopeeUserId  || '',
    product,
    dueDate,
    refundItem,
    reason,
  };

  sheetsFetch(REFUND_WEB_APP_URL, payload)
    .catch(err => {
      errorEl.textContent = '⚠️ บันทึกอาจไม่สำเร็จ: ' + err.message + ' (กรุณาลองใหม่)';
      errorEl.style.display = 'block';
      btn.textContent = '💰 ส่ง Refund Request';
      btn.style.background = '#00695c';
      btn.classList.remove('saved');
      btn.disabled = false;
    });
}

// ---------------------------------------------------------------------------
// Panel: Wrong PTP / Risk Complaint
// ---------------------------------------------------------------------------
function renderWrongPTPPanel(result) {
  warmup(typeof WRONG_PTP_WEB_APP_URL !== 'undefined' ? WRONG_PTP_WEB_APP_URL : '');
  const el     = document.getElementById('wrongptp-content');
  const groups = result.allActiveGroups || [];

  // Product options — same structure as Waive (dpd, M, totalDue, dueDate DD)
  const productOptions = groups.length
    ? groups.map(g => {
        const label    = g.productLabel || g.productType;
        const dpd      = g.maxDaysPastDue != null ? g.maxDaysPastDue : 0;
        const M        = dpd > 0 ? Math.ceil(dpd / 30) : 0;
        const totalDue = g.totalDue || 0;
        const dueFull  = (g.bills || []).map(b => b.dueDate).filter(d => d).sort().reverse()[0] || '';
        const dueDD    = dueFull ? dueFull.slice(-2).replace(/^0/, '') : '';
        return `<option value="${esc(label)}" data-dpd="${dpd}" data-m="${M}" data-total="${totalDue}" data-due="${esc(dueDD)}">${esc(label)}</option>`;
      }).join('')
    : '';

  const today    = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  el.innerHTML = `
    <div class="sms-field">
      <div class="sms-label">📋 Topic</div>
      <select id="wp-topic" class="sms-select">
        <option value="">— เลือก Topic —</option>
        <option value="รายงานเคสที่มีความเสี่ยงว่าลูกค้าจะร้องเรียน">รายงานเคสที่มีความเสี่ยงว่าลูกค้าจะร้องเรียน</option>
        <option value="กรอก PTP ผิด (เกินวันนัดชำระ)">กรอก PTP ผิด (เกินวันนัดชำระ)</option>
      </select>
    </div>

    <div class="sms-field">
      <div class="sms-label">📞 วันที่โทร</div>
      <input type="date" id="wp-call-date" class="sms-input" value="${todayStr}">
    </div>

    <!-- fields ที่แสดงเฉพาะ topic = กรอก PTP ผิด -->
    <div id="wp-ptp-fields" style="display:none;">
      <div class="sms-field">
        <div class="sms-label">🏷️ Product</div>
        <select id="wp-product" class="sms-select">
          <option value="" data-dpd="0" data-m="0" data-total="0" data-due="">— เลือก Product —</option>
          ${productOptions}
        </select>
      </div>

      <div id="wp-product-info" style="display:none;margin-bottom:6px;">
        <div style="background:#ffebee;border-radius:6px;padding:8px 12px;font-size:0.85rem;color:#b71c1c;line-height:2;">
          <div>💰 ยอดค้างรวม: <strong id="wp-total-display">—</strong> THB</div>
          <div>📊 M ค้างชำระ: <strong id="wp-m-display">—</strong>&nbsp;&nbsp;|&nbsp;&nbsp;DPD: <strong id="wp-dpd-display">—</strong> วัน</div>
        </div>
      </div>

      <div class="sms-field">
        <div class="sms-label">💵 ยอดที่นัดชำระ (THB) <span style="color:#9e9e9e;font-size:0.8rem;">(ไม่บังคับ)</span></div>
        <input type="number" id="wp-promised" class="sms-input" placeholder="ระบุยอดนัดชำระ" min="0" step="0.01">
      </div>

      <div class="sms-field">
        <div class="sms-label">✅ วันที่นัดชำระที่ถูก <span style="color:#9e9e9e;font-size:0.8rem;">(ไม่บังคับ)</span></div>
        <input type="date" id="wp-correct-date" class="sms-input">
      </div>

      <div class="sms-field">
        <div class="sms-label">❌ วันที่นัดชำระที่ผิด <span style="color:#9e9e9e;font-size:0.8rem;">(ไม่บังคับ)</span></div>
        <input type="date" id="wp-wrong-date" class="sms-input">
      </div>

      <div class="sms-field">
        <div class="sms-label">🏢 มีสินเชื่อพ่วงอื่นด้วยหรือไม่</div>
        <select id="wp-linked" class="sms-select">
          <option value="ไม่มี" selected>ไม่มี</option>
          <option value="SPLX">SPLX</option>
          <option value="TL">TL</option>
        </select>
      </div>
    </div>

    <div class="sms-field">
      <div class="sms-label">📝 สาเหตุ <span style="color:#9e9e9e;font-size:0.8rem;">(ไม่บังคับ)</span></div>
      <textarea id="wp-reason" class="sms-input" rows="2" placeholder="กรอกสาเหตุ..." style="resize:vertical;min-height:50px;"></textarea>
    </div>

    <div id="wp-error" class="excl-error-msg"></div>
    <button id="wp-submit-btn" class="sms-submit-btn" style="background:#b71c1c;">⚠️ ส่ง Wrong PTP</button>`;

  // แสดง/ซ่อน PTP fields ตาม topic
  document.getElementById('wp-topic').addEventListener('change', function() {
    const isPTP = this.value === 'กรอก PTP ผิด (เกินวันนัดชำระ)';
    document.getElementById('wp-ptp-fields').style.display = isPTP ? '' : 'none';
    if (!isPTP) {
      document.getElementById('wp-product').value        = '';
      document.getElementById('wp-product-info').style.display = 'none';
      document.getElementById('wp-promised').value       = '';
      document.getElementById('wp-correct-date').value   = '';
      document.getElementById('wp-wrong-date').value     = '';
      document.getElementById('wp-linked').value         = 'ไม่มี';
    }
  });

  // event: เลือก product → แสดงข้อมูล
  document.getElementById('wp-product').addEventListener('change', function() {
    const opt      = this.options[this.selectedIndex];
    const totalDue = parseFloat(opt.dataset.total) || 0;
    const dpd      = parseInt(opt.dataset.dpd)     || 0;
    const M        = parseInt(opt.dataset.m)        || 0;
    if (this.value) {
      document.getElementById('wp-product-info').style.display = '';
      document.getElementById('wp-total-display').textContent  = fmt(totalDue);
      document.getElementById('wp-m-display').textContent      = M   ? 'M' + M  : '—';
      document.getElementById('wp-dpd-display').textContent    = dpd ? dpd      : '—';
    } else {
      document.getElementById('wp-product-info').style.display = 'none';
    }
  });

  document.getElementById('wp-submit-btn').addEventListener('click', saveWrongPTPRecord);

  // draft: wire auto-save แล้ว restore
  _wireDraft('wp', 'wrongptp-content');
  _loadDraft('wp').then(_applyDraft);
}

async function saveWrongPTPRecord() {
  const btn     = document.getElementById('wp-submit-btn');
  const errorEl = document.getElementById('wp-error');
  errorEl.style.display = 'none';

  const productSel   = document.getElementById('wp-product');
  const product      = productSel.value.trim();
  const opt          = productSel.options[productSel.selectedIndex];
  const totalDue     = parseFloat(opt?.dataset?.total) || 0;
  const M            = parseInt(opt?.dataset?.m)        || 0;
  const dueDD        = opt?.dataset?.due || '';
  const topic        = document.getElementById('wp-topic').value;
  const isPTP        = topic === 'กรอก PTP ผิด (เกินวันนัดชำระ)';
  const promised     = isPTP ? (parseFloat(document.getElementById('wp-promised').value) || 0) : 0;
  const callDate     = document.getElementById('wp-call-date').value;
  const correctDate  = isPTP ? document.getElementById('wp-correct-date').value : '';
  const wrongDate    = isPTP ? document.getElementById('wp-wrong-date').value   : '';
  const linkedCredit = isPTP ? document.getElementById('wp-linked').value       : 'ไม่มี';
  const reason       = document.getElementById('wp-reason')?.value.trim() || '';

  const missing = [];
  if (!product)                     missing.push('Product');
  if (!topic)                       missing.push('Topic');
  if (!callDate)                    missing.push('วันที่โทร');
  // ยอดนัดชำระ, วันที่ถูก, วันที่ผิด — ไม่บังคับ

  if (missing.length) {
    errorEl.textContent = 'กรุณากรอก: ' + missing.join(', ');
    errorEl.style.display = 'block';
    return;
  }

  if (typeof WRONG_PTP_WEB_APP_URL === 'undefined' || WRONG_PTP_WEB_APP_URL.includes('YOUR_')) {
    errorEl.textContent = '❌ ยังไม่ได้ตั้งค่า WRONG_PTP_WEB_APP_URL ใน config.js';
    errorEl.style.display = 'block';
    return;
  }

  btn.disabled    = true;
  btn.textContent = '⏳ กำลังส่ง...';

  const payload = {
    type:            'WRONG_PTP',
    timestamp:       new Date().toISOString(),
    agentEmail:      currentResult?.agentEmail   || '',
    creditUserId:    currentResult?.creditUserId || '',
    name:            currentResult?.name         || '',
    dueDate:         dueDD,
    caseId:          currentResult?.caseId       || '',
    product,
    installmentM:    M,
    totalDue,
    topic,
    promisedAmount:  promised,
    callDate,
    correctApptDate: correctDate,
    wrongApptDate:   wrongDate,
    linkedCredit,
    reason,
  };

  try {
    const res = await sheetsFetch(WRONG_PTP_WEB_APP_URL, payload);
    if (res && typeof res.rowsWritten === 'number' && res.rowsWritten === 0) {
      throw new Error('Apps Script ไม่ได้บันทึกข้อมูล (rowsWritten=0)\nกรุณา Redeploy Apps Script ใหม่');
    }
    btn.textContent      = '✅ ส่งแล้ว';
    btn.style.background = '#2e7d32';
    btn.classList.add('saved');
    _clearDraft('wp');
  } catch (err) {
    btn.disabled         = false;
    btn.textContent      = '⚠️ ส่ง Wrong PTP';
    btn.style.background = '#b71c1c';
    btn.classList.remove('saved');
    errorEl.textContent  = '❌ บันทึกไม่สำเร็จ: ' + err.message;
    errorEl.style.display = 'block';
  }
}

// ---------------------------------------------------------------------------
// Panel: Inbound Record
// ---------------------------------------------------------------------------
function renderInboundPanel(result) {
  warmup(typeof INBOUND_WEB_APP_URL !== 'undefined' ? INBOUND_WEB_APP_URL : '');
  const el     = document.getElementById('inbound-content');
  const groups = result.allActiveGroups || [];

  // รวม products และ M ทั้งหมดจาก case (comma-separated)
  const allProducts     = groups.map(g => g.productLabel || g.productType).join(', ');
  const allInstallments = groups.map(g => {
    const dpd = g.maxDaysPastDue != null ? g.maxDaysPastDue : 0;
    const M   = dpd > 0 ? Math.ceil(dpd / 30) : 0;
    return M ? 'M' + M : 'M0';
  }).join(', ');

  const productSummary = allProducts
    ? `<div style="background:#e0f2f1;border-radius:6px;padding:8px 12px;font-size:0.85rem;color:#004d40;line-height:1.8;margin-bottom:8px;">
        <div>🏷️ Product: <strong>${esc(allProducts)}</strong></div>
        <div>📊 M ค้างชำระ: <strong>${esc(allInstallments)}</strong></div>
       </div>`
    : `<div style="background:#f5f5f5;border-radius:6px;padding:8px 12px;font-size:0.85rem;color:#9e9e9e;margin-bottom:8px;">ไม่พบข้อมูล Product</div>`;

  el.innerHTML = `
    <div class="sms-field">
      <div class="sms-label">👤 สถานะลูกค้า</div>
      <select id="ib-customer-status" class="sms-select">
        <option value="Overdue">Overdue</option>
        <option value="Non Overdue">Non Overdue</option>
      </select>
    </div>

    ${productSummary}

    <div class="sms-field">
      <div class="sms-label">📋 Topic</div>
      <select id="ib-topic" class="sms-select">
        <option value="">— เลือก Topic —</option>
        <option value="งาน OA">งาน OA</option>
        <option value="ลูกค้าขอทำ RL">ลูกค้าขอทำ RL</option>
        <option value="PTP">PTP</option>
        <option value="RTP">RTP</option>
        <option value="Completed">Completed</option>
        <option value="งานฟ้อง">งานฟ้อง</option>
        <option value="สอบถามเอกสารปิดบัญชี">สอบถามเอกสารปิดบัญชี</option>
        <option value="สอบถามรายละเอียดการใช้งาน">สอบถามรายละเอียดการใช้งาน</option>
        <option value="ร้องเรียน">ร้องเรียน</option>
        <option value="__other__">อื่นๆ (ระบุเพิ่มเติม)</option>
      </select>
    </div>

    <div class="sms-field" id="ib-topic-other-wrap" style="display:none;">
      <div class="sms-label">✏️ ระบุ Topic เพิ่มเติม</div>
      <input type="text" id="ib-topic-other" class="sms-input" placeholder="กรอก Topic...">
    </div>

    <div class="sms-field">
      <div class="sms-label">📞 เบอร์โทรที่โทรเข้ามา</div>
      <input type="tel" id="ib-caller-phone" class="sms-input" placeholder="0812345678">
    </div>

    <div class="sms-field">
      <div class="sms-label">📱 เบอร์ลงทะเบียน</div>
      <input type="tel" id="ib-reg-phone" class="sms-input" placeholder="0812345678">
    </div>

    <div class="sms-field">
      <div class="sms-label">📌 Case Status</div>
      <select id="ib-case-status" class="sms-select">
        <option value="Solved" selected>Solved</option>
        <option value="Escalated to CS">Escalated to CS</option>
        <option value="Escalated to OA">Escalated to OA</option>
        <option value="Escalated to C-care">Escalated to C-care</option>
        <option value="Escalated to senior">Escalated to senior</option>
        <option value="Pending case">Pending case</option>
      </select>
    </div>

    <div class="sms-field">
      <div class="sms-label">🔄 ต้องการให้ติดต่อกลับหรือไม่</div>
      <select id="ib-callback-want" class="sms-select">
        <option value="ไม่ต้องการให้ติดต่อกลับ" selected>ไม่ต้องการให้ติดต่อกลับ</option>
        <option value="ต้องการให้ติดต่อกลับ">ต้องการให้ติดต่อกลับ</option>
      </select>
    </div>

    <div class="sms-field" id="ib-callback-phone-wrap" style="display:none;">
      <div class="sms-label">📞 เบอร์ติดต่อกลับ <span style="color:#9e9e9e;font-size:0.8rem;">(ไม่บังคับ)</span></div>
      <input type="tel" id="ib-callback-phone" class="sms-input" placeholder="0812345678">
    </div>

    <div class="sms-field">
      <div class="sms-label">📝 Remark</div>
      <textarea id="ib-remark" class="sms-input" rows="2" placeholder="หมายเหตุ..." style="resize:vertical;min-height:50px;"></textarea>
    </div>

    <div id="ib-error" class="excl-error-msg"></div>
    <button id="ib-submit-btn" class="sms-submit-btn" style="background:#004d40;">📥 ส่ง Inbound Record</button>`;

  // แสดง/ซ่อน เบอร์ติดต่อกลับ
  document.getElementById('ib-callback-want').addEventListener('change', function() {
    document.getElementById('ib-callback-phone-wrap').style.display =
      this.value === 'ต้องการให้ติดต่อกลับ' ? '' : 'none';
    if (this.value !== 'ต้องการให้ติดต่อกลับ')
      document.getElementById('ib-callback-phone').value = '';
  });

  // แสดง/ซ่อน "อื่นๆ" text input
  document.getElementById('ib-topic').addEventListener('change', function() {
    document.getElementById('ib-topic-other-wrap').style.display =
      this.value === '__other__' ? '' : 'none';
    if (this.value !== '__other__') document.getElementById('ib-topic-other').value = '';
  });

  document.getElementById('ib-submit-btn').addEventListener('click', saveInboundRecord);

  // เก็บข้อมูล products/installments ไว้ใน dataset สำหรับ save
  el.dataset.products     = allProducts;
  el.dataset.installments = allInstallments;

  // draft: wire auto-save แล้ว restore
  _wireDraft('ib', 'inbound-content');
  _loadDraft('ib').then(_applyDraft);
}

async function saveInboundRecord() {
  const btn     = document.getElementById('ib-submit-btn');
  const errorEl = document.getElementById('ib-error');
  errorEl.style.display = 'none';

  const customerStatus = document.getElementById('ib-customer-status')?.value || '';
  const caseStatus     = document.getElementById('ib-case-status')?.value     || 'Solved case';
  const callbackWant   = document.getElementById('ib-callback-want')?.value   || 'ไม่ต้องการให้ติดต่อกลับ';
  const callbackPhone  = document.getElementById('ib-callback-phone')?.value.trim() || '';
  const topicRaw   = document.getElementById('ib-topic').value;
  const topicOther = document.getElementById('ib-topic-other').value.trim();
  const topic      = topicRaw === '__other__' ? ('อื่นๆ: ' + topicOther) : topicRaw;
  const callerPhone = document.getElementById('ib-caller-phone').value.trim();
  const regPhone    = document.getElementById('ib-reg-phone').value.trim();
  const remark     = document.getElementById('ib-remark').value.trim();
  const el         = document.getElementById('inbound-content');
  const products     = el.dataset.products     || '';
  const installments = el.dataset.installments || '';

  // Due Date DD จาก allActiveGroups
  const groups  = currentResult?.allActiveGroups || [];
  const dueFull = groups.flatMap(g => (g.bills || []).map(b => b.dueDate))
                        .filter(d => d).sort().reverse()[0] || '';
  const dueDD   = dueFull ? dueFull.slice(-2).replace(/^0/, '') : '';

  const missing = [];
  if (!topic)                               missing.push('Topic');
  if (topicRaw === '__other__' && !topicOther) missing.push('ระบุ Topic เพิ่มเติม');

  if (missing.length) {
    errorEl.textContent = 'กรุณากรอก: ' + missing.join(', ');
    errorEl.style.display = 'block';
    return;
  }

  if (typeof INBOUND_WEB_APP_URL === 'undefined' || INBOUND_WEB_APP_URL.includes('YOUR_')) {
    errorEl.textContent = '❌ ยังไม่ได้ตั้งค่า INBOUND_WEB_APP_URL ใน config.js';
    errorEl.style.display = 'block';
    return;
  }

  btn.disabled    = true;
  btn.textContent = '⏳ กำลังส่ง...';

  const payload = {
    type:           'INBOUND',
    timestamp:      new Date().toISOString(),
    agentEmail:     currentResult?.agentEmail   || '',
    creditUserId:   currentResult?.creditUserId || '',
    name:           currentResult?.name         || '',
    dueDate:        dueDD,
    caseId:         currentResult?.caseId       || '',
    customerStatus,
    caseStatus,
    callbackWant,
    callbackPhone,
    topic,
    products,
    installments,
    callerPhone,
    regPhone,
    remark,
  };

  try {
    const res = await sheetsFetch(INBOUND_WEB_APP_URL, payload);
    if (res && typeof res.rowsWritten === 'number' && res.rowsWritten === 0) {
      throw new Error('Apps Script ไม่ได้บันทึกข้อมูล (rowsWritten=0)\nกรุณา Redeploy Apps Script ใหม่');
    }
    btn.textContent      = '✅ ส่งแล้ว';
    btn.style.background = '#2e7d32';
    btn.classList.add('saved');
    _clearDraft('ib');
  } catch (err) {
    btn.disabled         = false;
    btn.textContent      = '📥 ส่ง Inbound Record';
    btn.style.background = '#004d40';
    btn.classList.remove('saved');
    errorEl.textContent  = '❌ บันทึกไม่สำเร็จ: ' + err.message;
    errorEl.style.display = 'block';
  }
}

// ---------------------------------------------------------------------------
// Panel: hashtag
// ---------------------------------------------------------------------------
function renderHashtagPanel(result) {
  warmup(typeof HASHTAG_WEB_APP_URL !== 'undefined' ? HASHTAG_WEB_APP_URL : '');
  const el     = document.getElementById('hashtag-content');
  const groups = result.allActiveGroups || [];

  // Product options — same structure as Waive
  const productOptions = groups.length
    ? groups.map(g => {
        const label    = g.productLabel || g.productType;
        const dpd      = g.maxDaysPastDue != null ? g.maxDaysPastDue : 0;
        const M        = dpd > 0 ? Math.ceil(dpd / 30) : 0;
        const totalDue = g.totalDue || 0;
        const dueFull  = (g.bills || []).map(b => b.dueDate).filter(d => d).sort().reverse()[0] || '';
        const dueDD    = dueFull ? dueFull.slice(-2).replace(/^0/, '') : '';
        return `<option value="${esc(label)}" data-dpd="${dpd}" data-m="${M}" data-total="${totalDue}" data-due="${esc(dueDD)}">${esc(label)}</option>`;
      }).join('')
    : '';

  el.innerHTML = `
    <div class="sms-field">
      <div class="sms-label">🏷️ Product</div>
      <select id="ht-product" class="sms-select">
        <option value="" data-dpd="0" data-m="0" data-total="0" data-due="">— เลือก Product —</option>
        ${productOptions}
      </select>
    </div>

    <div id="ht-product-info" style="display:none;margin-bottom:6px;">
      <div style="background:#e3f2fd;border-radius:6px;padding:8px 12px;font-size:0.85rem;color:#0d47a1;line-height:2;">
        <div>💰 ยอดค้างรวม: <strong id="ht-total-display">—</strong> THB</div>
        <div>📊 M ค้างชำระ: <strong id="ht-m-display">—</strong>&nbsp;&nbsp;|&nbsp;&nbsp;DPD: <strong id="ht-dpd-display">—</strong> วัน</div>
      </div>
    </div>

    <div class="sms-field">
      <div class="sms-label">📌 สถานะนัดชำระ</div>
      <select id="ht-ptp-status" class="sms-select">
        <option value="">— เลือกสถานะ —</option>
        <option value="นัดชำระ">นัดชำระ</option>
        <option value="ไม่นัดชำระ">ไม่นัดชำระ</option>
      </select>
    </div>

    <div class="sms-field">
      <div class="sms-label">💵 ยอดนัดชำระ (THB) <span style="color:#9e9e9e;font-size:0.8rem;">(ไม่บังคับ)</span></div>
      <input type="number" id="ht-promised" class="sms-input" placeholder="ระบุยอด" min="0" step="0.01">
    </div>

    <div class="sms-field">
      <div class="sms-label">#️⃣ ระบุ hashtag</div>
      <input type="text" id="ht-hashtag" class="sms-input" placeholder="#tag1 #tag2 ...">
    </div>

    <div class="sms-field">
      <div class="sms-label">📝 Remark</div>
      <textarea id="ht-remark" class="sms-input" rows="2" placeholder="หมายเหตุ..." style="resize:vertical;min-height:50px;"></textarea>
    </div>

    <div id="ht-error" class="excl-error-msg"></div>
    <button id="ht-submit-btn" class="sms-submit-btn" style="background:#1565c0;">#️⃣ ส่ง hashtag</button>`;

  // event: เลือก product → แสดงข้อมูล
  document.getElementById('ht-product').addEventListener('change', function() {
    const opt      = this.options[this.selectedIndex];
    const totalDue = parseFloat(opt.dataset.total) || 0;
    const dpd      = parseInt(opt.dataset.dpd)     || 0;
    const M        = parseInt(opt.dataset.m)        || 0;
    if (this.value) {
      document.getElementById('ht-product-info').style.display = '';
      document.getElementById('ht-total-display').textContent  = fmt(totalDue);
      document.getElementById('ht-m-display').textContent      = M   ? 'M' + M  : '—';
      document.getElementById('ht-dpd-display').textContent    = dpd ? dpd      : '—';
    } else {
      document.getElementById('ht-product-info').style.display = 'none';
    }
  });

  document.getElementById('ht-submit-btn').addEventListener('click', saveHashtagRecord);

  // draft: wire auto-save แล้ว restore
  _wireDraft('ht', 'hashtag-content');
  _loadDraft('ht').then(_applyDraft);
}

async function saveHashtagRecord() {
  const btn     = document.getElementById('ht-submit-btn');
  const errorEl = document.getElementById('ht-error');
  errorEl.style.display = 'none';

  const productSel = document.getElementById('ht-product');
  const product    = productSel.value.trim();
  const opt        = productSel.options[productSel.selectedIndex];
  const totalDue   = parseFloat(opt?.dataset?.total) || 0;
  const M          = parseInt(opt?.dataset?.m)        || 0;
  const dueDD      = opt?.dataset?.due || '';
  const ptpStatus  = document.getElementById('ht-ptp-status').value;
  const promised   = parseFloat(document.getElementById('ht-promised').value) || 0;
  const hashtag    = document.getElementById('ht-hashtag').value.trim();
  const remark     = document.getElementById('ht-remark').value.trim();

  const missing = [];
  if (!product)   missing.push('Product');
  if (!ptpStatus) missing.push('สถานะนัดชำระ');
  if (!hashtag)   missing.push('ระบุ hashtag');

  if (missing.length) {
    errorEl.textContent = 'กรุณากรอก: ' + missing.join(', ');
    errorEl.style.display = 'block';
    return;
  }

  if (typeof HASHTAG_WEB_APP_URL === 'undefined' || HASHTAG_WEB_APP_URL.includes('YOUR_')) {
    errorEl.textContent = '❌ ยังไม่ได้ตั้งค่า HASHTAG_WEB_APP_URL ใน config.js';
    errorEl.style.display = 'block';
    return;
  }

  btn.disabled    = true;
  btn.textContent = '⏳ กำลังส่ง...';

  const payload = {
    type:           'HASHTAG',
    timestamp:      new Date().toISOString(),
    agentEmail:     currentResult?.agentEmail   || '',
    creditUserId:   currentResult?.creditUserId || '',
    name:           currentResult?.name         || '',
    dueDate:        dueDD,
    caseId:         currentResult?.caseId       || '',
    product,
    installmentM:   M,
    totalDue,
    ptpStatus,
    promisedAmount: promised || '',
    hashtag,
    remark,
  };

  try {
    const res = await sheetsFetch(HASHTAG_WEB_APP_URL, payload);
    if (res && typeof res.rowsWritten === 'number' && res.rowsWritten === 0) {
      throw new Error('Apps Script ไม่ได้บันทึกข้อมูล (rowsWritten=0)\nกรุณา Redeploy Apps Script ใหม่');
    }
    btn.textContent      = '✅ ส่งแล้ว';
    btn.style.background = '#2e7d32';
    btn.classList.add('saved');
    _clearDraft('ht');
  } catch (err) {
    btn.disabled         = false;
    btn.textContent      = '#️⃣ ส่ง hashtag';
    btn.style.background = '#1565c0';
    btn.classList.remove('saved');
    errorEl.textContent  = '❌ บันทึกไม่สำเร็จ: ' + err.message;
    errorEl.style.display = 'block';
  }
}

// ---------------------------------------------------------------------------
// Chrome helpers
// ---------------------------------------------------------------------------
function getActiveTab() {
  return new Promise(resolve => {
    // If opened as a detached window, tabId is passed via URL param
    const urlTabId = new URLSearchParams(window.location.search).get('tabId');
    if (urlTabId) {
      chrome.tabs.get(parseInt(urlTabId, 10), tab => {
        if (chrome.runtime.lastError) {
          // Tab may have been closed; fall back to normal query
          chrome.tabs.query({ active: true, lastFocusedWindow: true }, tabs => resolve(tabs[0] ?? null));
        } else {
          resolve(tab);
        }
      });
      return;
    }
    // Normal popup mode: returns the tab that was active before the popup opened
    // Iframe mode: the iframe IS on the active tab, so this returns the same tab
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      resolve(tabs[0] ?? null);
    });
  });
}

function sendToContent(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

// ส่ง fetch ผ่าน background service worker เพื่อหลีกเลี่ยง CORS
function sendToBackground(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!response?.ok) {
        reject(new Error(response?.error || 'ไม่ทราบสาเหตุ'));
      } else {
        resolve(response.data);
      }
    });
  });
}

// fetch Apps Script ตรงจาก popup (ไม่ผ่าน service worker — เร็วกว่า)
// manifest มี host_permissions: script.google.com + script.googleusercontent.com
async function sheetsFetch(url, payload) {
  if (!url || url.includes('YOUR_')) {
    throw new Error('Web App URL ยังไม่ได้ตั้งค่าใน config.js');
  }
  const resp = await fetch(url, {
    method:   'POST',
    redirect: 'follow',
    headers:  { 'Content-Type': 'text/plain' }, // text/plain หลีกเลี่ยง preflight CORS
    body:     JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error('HTTP ' + resp.status + ' จาก Apps Script');
  const json = await resp.json();
  if (json.status === 'error') throw new Error(json.message || 'Apps Script error');
  return json;
}

function isCaseDetailPage(url) {
  const u = url || '';
  // /main/case/* — outbound case detail and related pages
  if (/^https:\/\/collections\.scredit\.in\.th\/main\/case\//.test(u)) return true;
  // /main/agentWorkstation/case/* — inbound call and agent workstation pages
  if (/^https:\/\/collections\.scredit\.in\.th\/main\/agentWorkstation\/case\//.test(u)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// UI state
// ---------------------------------------------------------------------------
function showState(state) {
  ['auth', 'wrong', 'loading', 'error', 'result'].forEach(s => {
    document.getElementById('state-' + s).style.display = s === state ? '' : 'none';
  });
}

// ---------------------------------------------------------------------------
// Watermark — วาด email ซ้ำแบบทแยง บน canvas แล้วใช้เป็น repeating background
// ---------------------------------------------------------------------------
function applyWatermark(email) {
  const wm = document.getElementById('dc-watermark');
  if (!wm || !email) return;

  const now = new Date(Date.now() + 7 * 3600 * 1000);
  const dt  = now.toISOString().replace('T', ' ').slice(0, 16);

  const tileW = 280;
  const tileH = 140;

  const canvas = document.createElement('canvas');
  canvas.width  = tileW;
  canvas.height = tileH;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, tileW, tileH);
  ctx.save();
  ctx.translate(tileW / 2, tileH / 2);
  ctx.rotate(-Math.PI / 6);                          // -30 องศา
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  // บรรทัด 1: CONFIDENTIAL
  ctx.font      = 'bold 13px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = 'rgba(26, 35, 126, 0.11)';         // น้ำเงิน เหมือน email
  ctx.fillText('CONFIDENTIAL', 0, -16);

  // บรรทัด 2: email
  ctx.font      = '10px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = 'rgba(26, 35, 126, 0.11)';         // น้ำเงิน
  ctx.fillText(email, 0, 0);

  // บรรทัด 3: วันที่เวลา UTC+7
  ctx.font      = '10px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = 'rgba(26, 35, 126, 0.11)';
  ctx.fillText(dt + ' UTC+7', 0, 14);

  ctx.restore();

  const dataUrl = canvas.toDataURL();
  wm.style.backgroundImage  = `url(${dataUrl})`;
  wm.style.backgroundRepeat = 'repeat';
  wm.style.backgroundSize   = `${tileW}px ${tileH}px`;
}

function showError(msg) {
  document.getElementById('error-message').innerHTML =
    msg.split('\n').map(l => esc(l)).join('<br>');
  showState('error');
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
// Exact 2-decimal format (for totals and interest)
function fmt(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Integer format (for rounded offer/discount amounts — no decimals needed)
function fmtInt(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString('th-TH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Auto-format date input เป็น yyyy-mm-dd ขณะพิมพ์
function formatDateInput(el) {
  const pos  = el.selectionStart;
  let   v    = el.value.replace(/\D/g, '').slice(0, 8);
  let   out  = v;
  if (v.length > 4) out = v.slice(0, 4) + '-' + v.slice(4);
  if (v.length > 6) out = v.slice(0, 4) + '-' + v.slice(4, 6) + '-' + v.slice(6);
  el.value = out;
  // คงตำแหน่ง cursor
  const added = out.length - el.value.replace(/\D/g, '').length;
  try { el.setSelectionRange(pos + (out.length > pos ? 0 : 0), pos + (out.length > pos ? 0 : 0)); } catch(_) {}
}

function zoneLabel(zone) {
  return { green: 'Green Zone', yellow: 'Yellow Zone', red: 'Red Zone' }[zone] || zone;
}

function zoneRange(zone) {
  const t = DPD_ZONE_THRESHOLDS;
  if (zone === 'green')  return `DPD ≤ ${t.greenMax} วัน`;
  if (zone === 'yellow') return `DPD ${t.greenMax + 1}–${t.yellowMax} วัน`;
  return `DPD > ${t.yellowMax} วัน`;
}

// ---------------------------------------------------------------------------
// Admin tab — role gating
// ---------------------------------------------------------------------------
function applyAdminTab(role) {
  const tab = document.getElementById('tab-admin');
  if (!tab) return;
  // Show admin tab for admin and owner only
  if (role === 'admin' || role === 'owner') {
    tab.style.display = '';
    tab.addEventListener('click', () => renderAdminPanel(role), { once: true });
  }
}

// ---------------------------------------------------------------------------
// Admin panel — renders user list + add-user form
// ---------------------------------------------------------------------------
async function renderAdminPanel(role) {
  const container = document.getElementById('admin-content');
  if (!container) return;

  container.innerHTML = '<div style="padding:16px;text-align:center;color:#9e9e9e;font-size:0.923rem"><div class="spinner"></div><br>กำลังโหลดรายชื่อ...</div>';

  const loginUrl = (typeof LOGIN_WEB_APP_URL !== 'undefined') ? LOGIN_WEB_APP_URL : '';

  // ── header: current user badge ──────────────────────────────────────────
  const roleBadge = `<span class="role-badge role-${role}">${roleTH(role)}</span>`;
  let html = `
    <div style="padding:8px 12px 6px;font-size:11px;color:#9e9e9e;border-bottom:1px solid #f0f0f0;margin-bottom:6px;">
      ล็อกอินในฐานะ <strong style="color:#2c2c2c">${esc(verifiedEmail)}</strong>${roleBadge}
    </div>
    <div id="admin-msg" class="admin-msg"></div>`;

  // ── add user form (admin can add agent; owner can add agent or admin) ───
  const roleOptions = role === 'owner'
    ? '<option value="agent">Agent</option><option value="admin">Admin</option>'
    : '<option value="agent">Agent</option>';

  html += `
    <div class="add-user-card">
      <div class="add-user-title">➕ เพิ่มผู้ใช้ใหม่</div>
      <input type="email" id="new-user-email" placeholder="email@monee.com">
      <select id="new-user-role">${roleOptions}</select>
      <button class="add-user-submit" id="btn-add-user">เพิ่มผู้ใช้</button>
    </div>`;

  container.innerHTML = html;

  // wire add-user button
  document.getElementById('btn-add-user').addEventListener('click', () => saveAddUser(loginUrl, role));
}


function buildUserCard(u, viewerRole) {
  const isActive  = u.status === 'active';
  const dotClass  = isActive ? 'active' : 'inactive';
  const badge     = `<span class="role-badge role-${u.role}">${roleTH(u.role)}</span>`;
  const lastLogin = u.lastLogin ? `Login ล่าสุด: ${u.lastLogin}` : 'ยังไม่เคย login';

  // toggle button — hide if target is owner (no one can deactivate owner)
  let toggleBtn = '';
  if (u.role !== 'owner') {
    const btnLabel  = isActive ? 'ปิดการใช้งาน' : 'เปิดการใช้งาน';
    const btnClass  = isActive ? 'deactivate' : 'reactivate';
    toggleBtn = `<button class="user-btn ${btnClass}">${btnLabel}</button>`;
  }

  // role change select — owner can change anyone's role (except other owners); admin cannot change roles
  let roleSel = '';
  if (viewerRole === 'owner' && u.role !== 'owner') {
    roleSel = `<select class="role-change-sel">
      <option value="agent"${u.role === 'agent' ? ' selected' : ''}>Agent</option>
      <option value="admin"${u.role === 'admin' ? ' selected' : ''}>Admin</option>
    </select>`;
  }

  return `
    <div class="user-card${isActive ? '' : ' inactive'}" data-uid="${esc(u.email)}">
      <span class="status-dot ${dotClass}"></span>
      <div class="user-info">
        <div class="user-email">${esc(u.email)}${badge}</div>
        <div class="user-meta">${lastLogin}</div>
      </div>
      ${roleSel}
      ${toggleBtn}
    </div>`;
}

// ---------------------------------------------------------------------------
// Add user
// ---------------------------------------------------------------------------
async function saveAddUser(loginUrl, viewerRole) {
  const emailInput = document.getElementById('new-user-email');
  const roleInput  = document.getElementById('new-user-role');
  const btn        = document.getElementById('btn-add-user');
  const msg        = document.getElementById('admin-msg');

  const email = emailInput.value.trim().toLowerCase();
  const role  = roleInput.value;

  msg.className = 'admin-msg';
  msg.textContent = '';

  if (!email || !email.includes('@')) {
    msg.textContent = '❌ กรุณากรอก email ให้ถูกต้อง';
    msg.classList.add('error');
    return;
  }

  btn.disabled    = true;
  btn.textContent = '⏳ กำลังเพิ่ม...';

  try {
    await sendToBackground({
      type:    'ADMIN_OP',
      url:     loginUrl,
      payload: { type: 'ADD_USER', email, role, requestedBy: verifiedEmail },
    });
    msg.textContent = `✅ เพิ่ม ${email} (${roleTH(role)}) สำเร็จ`;
    msg.classList.add('success');
    emailInput.value = '';
    await loadUserList(loginUrl, viewerRole);
  } catch (err) {
    msg.textContent = '❌ ' + err.message;
    msg.classList.add('error');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'เพิ่มผู้ใช้';
  }
}

// ---------------------------------------------------------------------------
// Update user (toggle status or change role)
// ---------------------------------------------------------------------------
async function saveUpdateUser(loginUrl, viewerRole, email, changes, triggerEl) {
  const msg = document.getElementById('admin-msg');
  msg.className = 'admin-msg';
  msg.textContent = '';

  if (triggerEl) {
    triggerEl.disabled = true;
    triggerEl.classList.add('saving');
  }

  try {
    await sendToBackground({
      type:    'ADMIN_OP',
      url:     loginUrl,
      payload: { type: 'UPDATE_USER', email, changes, requestedBy: verifiedEmail },
    });
    await loadUserList(loginUrl, viewerRole);
    msg.textContent = `✅ อัปเดต ${email} สำเร็จ`;
    msg.classList.add('success');
  } catch (err) {
    if (triggerEl) {
      triggerEl.disabled = false;
      triggerEl.classList.remove('saving');
    }
    msg.textContent = '❌ ' + err.message;
    msg.classList.add('error');
  }
}

// ---------------------------------------------------------------------------
// Role label helper
// ---------------------------------------------------------------------------
function roleTH(role) {
  return { owner: 'Owner', admin: 'Admin', agent: 'Agent' }[role] || role;
}
