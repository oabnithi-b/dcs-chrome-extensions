// =============================================================================
// popup.js — UI orchestration
// config.js + eligibility.js are loaded before this file via <script> tags.
// =============================================================================

let currentTool   = 'partial'; // which tool tab is active
let currentResult = null;     // last successful evaluate() result (for RL save)
let currentTabId  = null;     // active Chrome tab ID (for sending messages)

document.addEventListener('DOMContentLoaded', async () => {
  // Tool tab switching
  document.querySelectorAll('.tool-tab[data-tool]').forEach(tab => {
    tab.addEventListener('click', () => switchTool(tab.dataset.tool));
  });

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

  await runAnalysis();
});

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
      'กรุณาไปที่แท็บ "Bill Info" ก่อน แล้วเปิด popup ใหม่\n' +
      'หรือกดปุ่ม 🔄 ลองใหม่ หลังจากเปลี่ยนแท็บแล้ว'
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

  renderResult(result);
}

// ---------------------------------------------------------------------------
// Master render — populates all three tool panels at once
// ---------------------------------------------------------------------------
function renderResult(result) {
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
// Panel: Discount
// ---------------------------------------------------------------------------
function renderDiscountPanel(groups) {
  const el = document.getElementById('discount-content');

  if (!groups.length) {
    el.innerHTML = '<div class="no-data">ไม่มีข้อมูลสำหรับคำนวณส่วนลด</div>';
    return;
  }

  el.innerHTML = groups.map(g => buildDiscountCard(g)).join('');
}

function buildDiscountCard(group) {
  const dpd       = group.maxDaysPastDue;
  const isOverDPD = dpd > DISCOUNT_DPD_THRESHOLD;

  const header = `
    <div class="disc-card">
      <div class="disc-header">
        💸 ${esc(group.productLabel)}
        <div class="disc-meta">${group.billCount} บิล &nbsp;·&nbsp; DPD สูงสุด ${dpd} วัน</div>
      </div>
      <div class="disc-total-row">
        <span class="disc-total-label">ยอดค้างรวม:</span>
        <span class="disc-total-value">${fmt(group.totalDue)}</span>
        <span class="disc-total-unit">THB</span>
      </div>`;

  if (!isOverDPD) {
    // DPD ≤ 181 — ยังไม่ถึงเกณฑ์ส่วนลด
    return header + `
      <div class="disc-waive-notice">
        ℹ️ DPD ไม่เกิน ${DISCOUNT_DPD_THRESHOLD} วัน<br>
        <strong>สามารถนำเสนอ Waive ค่าติดตามทวงถามได้เท่านั้น</strong>
      </div>
    </div>`;
  }

  // DPD > 181 — แสดงตารางส่วนลด
  const rows = calculateDiscount(group.totalDue, DISCOUNT_PERCENTAGES);
  const tableRows = rows.map(r => `
    <tr>
      <td><span class="disc-pct">${r.pct}%</span></td>
      <td><span class="disc-amt">${fmt(r.discountAmt)}</span><span class="disc-unit">THB</span></td>
      <td><span class="disc-actual">${fmtInt(r.actualAmt)}</span><span class="disc-unit">THB</span></td>
    </tr>`).join('');

  return header + `
      <table class="disc-table">
        <thead>
          <tr>
            <th>%</th>
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
function renderExcludePanel(groups) {
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
            <option>อื่นๆ</option>
          </optgroup>
        </select>
      </div>

      <!-- 3. สถานะนัดชำระ -->
      <div class="excl-field">
        <div class="excl-label">3. สถานะนัดชำระ</div>
        <div class="excl-radio-inline">
          <label><input type="radio" name="excl-appoint" value="YES"> YES</label>
          <label><input type="radio" name="excl-appoint" value="NO"> NO</label>
        </div>
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
}

async function saveExcludeRecord(groups) {
  const btn      = document.getElementById('excl-submit-btn');
  const errorEl  = document.getElementById('excl-error');
  errorEl.style.display = 'none';

  // Read form values
  const excludeType     = document.querySelector('input[name="excl-type"]:checked')?.value || '';
  const reason          = document.getElementById('excl-reason').value;
  const appointStatus   = document.querySelector('input[name="excl-appoint"]:checked')?.value || '';
  const delinquent      = document.querySelector('input[name="excl-delinquent"]:checked')?.value || '';
  const nextCallingDate = document.getElementById('excl-next-date').value;

  // รวม Product Label ทุกตัวด้วย ,
  const productLabel  = groups.map(g => g.productLabel).join(', ');
  const maxDaysPastDue = Math.max(...groups.map(g => g.maxDaysPastDue));

  // Validate
  const missing = [];
  if (!excludeType)   missing.push('ประเภทการ Exclude');
  if (!reason)        missing.push('สาเหตุ');
  if (!appointStatus) missing.push('สถานะนัดชำระ');
  if (!delinquent)    missing.push('Delinquent');
  // Next Calling Date เป็น optional — ไม่บังคับ

  if (missing.length) {
    errorEl.textContent = 'กรุณากรอก: ' + missing.join(', ');
    errorEl.style.display = 'block';
    return;
  }

  btn.disabled    = true;
  btn.textContent = '⏳ กำลังบันทึก...';
  btn.classList.add('saving');

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
    delinquent,
    nextCallingDate,
  };

  try {
    await sendToBackground({ type: 'SEND_TO_SHEETS', url: EXCLUDE_WEB_APP_URL, payload });
    btn.textContent = '✅ บันทึกแล้ว';
    btn.classList.remove('saving');
    btn.classList.add('saved');
  } catch (err) {
    btn.disabled    = false;
    btn.textContent = '🚫 กดเพื่อ Exclude';
    btn.classList.remove('saving');
    errorEl.textContent = '❌ บันทึกไม่สำเร็จ: ' + err.message;
    errorEl.style.display = 'block';
  }
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

  const dpdBadge = `<span class="rl-dpd-badge ${isOverDPD ? 'over' : 'under'}">DPD ${dpd} วัน</span>`;

  if (isOverDPD) {
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
    // DPD ≤ 61 — แนะนำลูกค้ากรอกเว็บฟอร์มเอง
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
          DPD ไม่เกิน ${RL_DPD_THRESHOLD} วัน ลูกค้าสามารถยื่นขอ Restructure ผ่านเว็บฟอร์มได้เลย
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
    await sendToBackground({ type: 'SEND_TO_SHEETS', url: WEB_APP_URL, payload });
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
// Chrome helpers
// ---------------------------------------------------------------------------
function getActiveTab() {
  return new Promise(resolve => {
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
  return /^https:\/\/collections\.scredit\.in\.th\/main\/case\/detail\//.test(url || '');
}

// ---------------------------------------------------------------------------
// UI state
// ---------------------------------------------------------------------------
function showState(state) {
  ['wrong', 'loading', 'error', 'result'].forEach(s => {
    document.getElementById('state-' + s).style.display = s === state ? '' : 'none';
  });
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
