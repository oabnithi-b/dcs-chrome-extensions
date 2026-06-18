// =============================================================================
// content.js — Injected into collections.scredit.in.th/main/case/detail/*
// Responsibilities:
//   1. Listen for messages from popup.js
//   2. EXTRACT_DATA  → scrape page and return raw data
//   3. SEND_TO_SHEETS → POST final result to Apps Script Web App
// No eligibility logic here — that lives in eligibility.js.
// =============================================================================

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === 'EXTRACT_DATA') {
    extractData().then(sendResponse).catch(err => {
      sendResponse({ error: err.message });
    });
    return true; // keep message channel open for async response
  }

  if (request.type === 'SEND_TO_SHEETS') {
    sendToSheets(request.payload).then(sendResponse).catch(err => {
      sendResponse({ error: err.message });
    });
    return true;
  }
});

// ---------------------------------------------------------------------------
// DOM extraction
// ---------------------------------------------------------------------------

async function extractData() {
  const userInfo = extractUserInfo();
  const billRows = extractBillRows();

  if (billRows.length === 0) {
    // Check whether Bill Info tab exists but is not the active tab
    const allTabs = Array.from(document.querySelectorAll('[role="tab"]'));
    const billTab = allTabs.find(t => t.textContent.trim() === 'Bill Info');
    if (billTab && billTab.getAttribute('aria-selected') !== 'true') {
      return { error: 'BILL_INFO_TAB_NOT_ACTIVE', userInfo, billRows: [] };
    }
  }

  return { userInfo, billRows };
}

function extractUserInfo() {
  function getField(forAttr) {
    const label = document.querySelector(`label[for="${forAttr}"]`);
    const item  = label?.closest('.ant-form-item');
    return item?.querySelector('.ant-form-item-control-input-content')
               ?.textContent?.trim() ?? null;
  }

  return {
    agentEmail:   document.querySelector('.name___2eduw')?.textContent?.trim() ?? null,
    creditUserId: getField('userInfo_userId'),
    name:         getField('userInfo_userName'),
    shopeeUserId: getField('userInfo_shopeeUserId'),
    caseId:       window.location.href.split('/').pop(),
  };
}

function extractBillRows() {
  // Identify the bill summary table by its header columns
  const tables    = Array.from(document.querySelectorAll('table'));
  const billTable = tables.find(t => {
    const headers = Array.from(t.querySelectorAll('th')).map(th => th.textContent.trim());
    return headers.includes('Bill ID') && headers.includes('Product Type');
  });

  if (!billTable) return [];

  const wrapper  = billTable.closest('.ant-table-wrapper');
  const rows     = Array.from(wrapper?.querySelectorAll('.ant-table-row') ?? []);

  return rows.map(row => {
    const c = row.querySelectorAll('td');
    return {
      billId:          c[0]?.textContent.trim()  ?? '',
      productType:     c[1]?.textContent.trim()  ?? '',
      dueDate:         c[2]?.textContent.trim()  ?? '', // YYYY-MM-DD
      amountToPay:     parseFloat(c[3]?.textContent.replace(/,/g, '') || '0'),
      daysPastDue:     parseInt(c[4]?.textContent || '0', 10),
      billStatus:      c[5]?.textContent.trim()  ?? '',
      financialStatus: c[6]?.textContent.trim()  ?? '',
    };
  });
}

// ---------------------------------------------------------------------------
// Google Sheets write
// ---------------------------------------------------------------------------

async function sendToSheets(payload) {
  const url = WEB_APP_URL; // from config.js (loaded before content.js)

  if (!url || url.includes('YOUR_APPS_SCRIPT')) {
    throw new Error('Web App URL ยังไม่ได้ตั้งค่าใน config.js');
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error('HTTP ' + response.status + ' จาก Apps Script');
  }

  const json = await response.json();
  if (json.status !== 'ok') {
    throw new Error('Apps Script ตอบกลับ: ' + JSON.stringify(json));
  }

  return json;
}
