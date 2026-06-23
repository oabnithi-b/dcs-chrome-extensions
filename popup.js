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
  // ลองตรวจ token cache ก่อน (interactive: false) — ไม่แสดง Google popup อัตโนมัติ
  showState('auth');
  const loginUrl = (typeof LOGIN_WEB_APP_URL !== 'undefined') ? LOGIN_WEB_APP_URL : '';

  try {
    const authResult = await sendToBackground({ type: 'CHECK_AUTH', loginUrl, interactive: false });
    verifiedEmail = authResult.email;
    verifiedRole  = authResult.role || 'agent';
    applyWatermark(verifiedEmail);
    applyAdminTab(verifiedRole);
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) btnLogout.style.display = '';
    await runAnalysis();
  } catch (_) {
    // ไม่มี token cache — แสดงปุ่มให้ user กดเองแทนการ popup อัตโนมัติ
    showLoginPrompt(loginUrl);
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
// Tool switching
// ---------------------------------------------------------------------------
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
// Master render — populates all three tool panels at once
// ---------------------------------------------------------------------------
function renderResult(result) {
  // Show/hide inbound-call cache banner
  const cacheBanner = document.getElementById('cache-banner');
  if (cacheBanner) cacheBanner.style.display = result.fromCache ? '' : 'none';

  setText('r-name',    result.name         || '—');
  setText('r-userId',  result.creditUserId || '—');
  setText('r-shopeeId',result.shopeeUserId || '—');
  setText('r-agent',   result.agentEmail   || '—');

  currentResult = result; // store for RL save button access
  renderPartialPanel(result);
  renderDiscountPanel(result.allActiveGroups || []);
  renderExcludePanel(result.allActiveGroups || []);
  renderRLPanel(result.allActiveGroups || []);
  renderInterestPanel(result.allActiveGroups || []);
  renderPhonePanel(result);
  renderSmsPanel(result);
  renderWaivePanel(result);
  renderRefundPanel(result);

  showState('result');
  switchTool(currentTool); // keep whichever tab was last active
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

  // ส่งข้อมูลใน background — ถ้า error แสดงเตือนเบาๆ ด้านล่าง
  sendToBackground({ type: 'SEND_TO_SHEETS', url: EXCLUDE_WEB_APP_URL, payload })
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
    const res = await sendToBackground({ type: 'SEND_TO_SHEETS', url: WEB_APP_URL, payload });
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
    const res = await sendToBackground({ type: 'SEND_TO_SHEETS', url: PHONE_WEB_APP_URL, payload });
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
    const res = await sendToBackground({ type: 'SEND_TO_SHEETS', url: SMS_WEB_APP_URL, payload });
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
    const res = await sendToBackground({ type: 'SEND_TO_SHEETS', url: WAIVE_WEB_APP_URL, payload });
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

  sendToBackground({ type: 'SEND_TO_SHEETS', url: REFUND_WEB_APP_URL, payload })
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

  // ── user list placeholder ────────────────────────────────────────────────
  html += `<div class="admin-section-lbl">รายชื่อผู้ใช้ทั้งหมด</div>
           <div id="user-list-wrap"><div class="no-data">กำลังโหลด…</div></div>`;

  container.innerHTML = html;

  // wire add-user button
  document.getElementById('btn-add-user').addEventListener('click', () => saveAddUser(loginUrl, role));

  // load user list
  await loadUserList(loginUrl, role);
}

// ---------------------------------------------------------------------------
// Load user list from Apps Script
// ---------------------------------------------------------------------------
async function loadUserList(loginUrl, role) {
  const wrap = document.getElementById('user-list-wrap');
  if (!wrap) return;

  let users;
  try {
    users = await sendToBackground({ type: 'ADMIN_OP', url: loginUrl, payload: { type: 'LIST_USERS', requestedBy: verifiedEmail } });
  } catch (err) {
    wrap.innerHTML = `<div class="no-data" style="color:#b71c1c">โหลดรายชื่อไม่สำเร็จ: ${esc(err.message)}</div>`;
    return;
  }

  if (!Array.isArray(users) || users.length === 0) {
    wrap.innerHTML = '<div class="no-data">ไม่มีรายชื่อในระบบ</div>';
    return;
  }

  // sort: owner first, then admin, then agent; inactive last
  const roleOrder = { owner: 0, admin: 1, agent: 2 };
  users.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
    return (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9);
  });

  wrap.innerHTML = users.map(u => buildUserCard(u, role)).join('');

  // wire per-card buttons/selects
  users.forEach(u => {
    const card = wrap.querySelector(`[data-uid="${CSS.escape(u.email)}"]`);
    if (!card) return;

    // toggle active/inactive
    const toggleBtn = card.querySelector('.user-btn');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => saveUpdateUser(loginUrl, role, u.email, {
        status: u.status === 'active' ? 'inactive' : 'active',
      }, toggleBtn));
    }

    // role change select (owner only)
    const roleSel = card.querySelector('.role-change-sel');
    if (roleSel) {
      roleSel.addEventListener('change', () => saveUpdateUser(loginUrl, role, u.email, {
        role: roleSel.value,
      }, roleSel));
    }
  });
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
