// =============================================================================
// Code.gs — Google Apps Script Web App
// Receives POST from content.js and writes rows to Google Sheets.
//
// SETUP:
//   1. Deploy → New deployment → Web App
//      - Execute as: Me
//      - Who has access: Anyone
//   2. Copy the Web App URL into WEB_APP_URL in config.js
// =============================================================================

// [CONFIGURABLE RULE] — Spreadsheet ID (from the URL of your Google Sheet)
const SPREADSHEET_ID = '1Bcld8Waacy2hGooIyGQU0L3TN3Eu1E1fLLeIv9oNt1Q';

// Tab names
const MASTER_TAB = 'DR';           // Partial Payment audit log (all agents)
const RL_TAB     = 'DR Extension'; // Restructure Loan save log

// Exclude spreadsheet (คนละ Sheet กับ RL)
const EXCLUDE_SPREADSHEET_ID = '1_a-JedcXKsQDk2f1Lq14xJNmLTkZnFLiAhjMsvYvvzw';
const EXCLUDE_TAB             = 'Exclude Extension';

// Phone spreadsheet
const PHONE_SPREADSHEET_ID = '1EmsGIH_G7ZzgHrkspXEKHTpgtCCfkj-cGTjyKq7a0Ts';
const PHONE_TAB            = 'DC tool extension';

// ---------------------------------------------------------------------------
// Column headers
// ---------------------------------------------------------------------------
const PARTIAL_HEADERS = [
  'Date',
  'Agent',
  'Credit User ID',
  'Name',
  'Shopee ID',
  'Case ID',
  'Type',
  'Product',
  'Label',
  'Total Due',
  'Offered Amount',
  'Zone',
  'Bill Count',
  'Max DPD',
  'Earliest Due Date',
];

const RL_HEADERS = [
  'Date',
  'Agent Email',
  'Credit User ID',
  'Name',
  'Shopee User ID',
  'Product Label',
  'Due Date',
];

const EXCLUDE_HEADERS = [
  'Date',
  'Agent Email',
  'Credit User ID',
  'Name',
  'Product Label',
  'Case ID',
  'Max DPD',
  'ประเภท Exclude',
  'สาเหตุ',
  'สถานะนัดชำระ',
  'ยอดนัดชำระ',
  'Delinquent',
  'Next Calling Date',
];

const PHONE_HEADERS = [
  'Date',
  'Agent Email',
  'Credit User ID',
  'Name',
  'สถานะเบอร์',
  'เบอร์โทร',
];

// ---------------------------------------------------------------------------
// POST handler — called by content.js fetch()
// ---------------------------------------------------------------------------
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);

    // Route by payload type
    if (payload.type === 'RL') {
      const rowsWritten = writeRLPayload(payload);
      return jsonResponse({ status: 'ok', rowsWritten });
    }

    if (payload.type === 'EXCLUDE') {
      const rowsWritten = writeExcludePayload(payload);
      return jsonResponse({ status: 'ok', rowsWritten });
    }

    if (payload.type === 'PHONE') {
      const rowsWritten = writePhonePayload(payload);
      return jsonResponse({ status: 'ok', rowsWritten });
    }

    // Default: Partial Payment audit log
    const rowsWritten = writePartialPayload(payload);
    return jsonResponse({ status: 'ok', rowsWritten });

  } catch (err) {
    return jsonResponse({ status: 'error', message: err.message });
  }
}

// GET handler — required for CORS preflight and health-check
function doGet(e) {
  return jsonResponse({ status: 'ok', service: 'DC Collection Tool' });
}

// ---------------------------------------------------------------------------
// Partial Payment — write to agent tab + MASTER_TAB
// ---------------------------------------------------------------------------
function writePartialPayload(payload) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  const agentEmail   = payload.agentEmail || 'unknown';
  const agentTabName = agentEmail.split('@')[0] || agentEmail;

  const products = payload.eligibleProducts || [];
  if (products.length === 0) return 0;

  const agentTab  = findOrCreateTab(ss, agentTabName,  PARTIAL_HEADERS);
  const masterTab = findOrCreateTab(ss, MASTER_TAB,    PARTIAL_HEADERS);

  let rowsWritten = 0;
  for (const product of products) {
    const row = buildPartialRow(payload, product);
    appendRow(agentTab,  PARTIAL_HEADERS, row);
    appendRow(masterTab, PARTIAL_HEADERS, row);
    rowsWritten++;
  }
  return rowsWritten;
}

function buildPartialRow(payload, product) {
  return [
    toThaiDateTime(payload.timestamp),
    payload.agentEmail       || '',
    payload.creditUserId     || '',
    payload.name             || '',
    payload.shopeeUserId     || '',
    payload.caseId           || '',
    payload.eligibilityType  || 'Partial Payment',
    product.productType      || '',
    product.productLabel     || '',
    product.totalDue         || 0,
    product.offeredAmount    || 0,
    product.zone             || '',
    product.billCount        || 0,
    product.maxDaysPastDue   || 0,
    product.earliestDueDate  || '',
  ];
}

// ---------------------------------------------------------------------------
// Restructure Loan (RL) — write to DR Extension tab only
// ---------------------------------------------------------------------------
function writeRLPayload(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const rlTab = findOrCreateTab(ss, RL_TAB, RL_HEADERS);
    appendRow(rlTab, RL_HEADERS, buildRLRow(payload));
    return 1;
  } finally {
    lock.releaseLock();
  }
}

function buildRLRow(payload) {
  return [
    toThaiDateTime(payload.timestamp),
    payload.agentEmail   || '',
    payload.creditUserId || '',
    payload.name         || '',
    payload.shopeeUserId || '',
    payload.productLabel || '',
    payload.dueDay       || '',   // DD เท่านั้น เช่น "05" จาก "2025-03-05"
  ];
}

// ---------------------------------------------------------------------------
// Exclude — write to Exclude Extension tab (คนละ Spreadsheet)
// ---------------------------------------------------------------------------
function writeExcludePayload(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000); // รอสูงสุด 10 วินาที ป้องกัน concurrent write
  try {
    const ss  = SpreadsheetApp.openById(EXCLUDE_SPREADSHEET_ID);
    const tab = findOrCreateTab(ss, EXCLUDE_TAB, EXCLUDE_HEADERS);
    appendRow(tab, EXCLUDE_HEADERS, buildExcludeRow(payload));
    return 1;
  } finally {
    lock.releaseLock();
  }
}

function buildExcludeRow(payload) {
  return [
    toThaiDateTime(payload.timestamp),
    payload.agentEmail     || '',
    payload.creditUserId   || '',
    payload.name           || '',
    payload.productLabel   || '',
    payload.caseId         || '',
    payload.maxDaysPastDue || '',
    payload.excludeType    || '',
    payload.reason         || '',
    payload.appointStatus  || '',
    payload.ptpAmount      || '',
    payload.delinquent     || '',
    payload.nextCallingDate|| '',
  ];
}

// ---------------------------------------------------------------------------
// Phone — write to DC tool extension tab (Phone spreadsheet)
// ---------------------------------------------------------------------------
function writePhonePayload(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss  = SpreadsheetApp.openById(PHONE_SPREADSHEET_ID);
    const tab = findOrCreateTab(ss, PHONE_TAB, PHONE_HEADERS);
    appendRow(tab, PHONE_HEADERS, buildPhoneRow(payload));
    return 1;
  } finally {
    lock.releaseLock();
  }
}

function buildPhoneRow(payload) {
  return [
    toThaiDateTime(payload.timestamp),
    payload.agentEmail   || '',
    payload.creditUserId || '',
    payload.name         || '',
    payload.phoneStatus  || '',
    payload.phoneNumber  || '',
  ];
}

// ---------------------------------------------------------------------------
// Sheet helpers
// ---------------------------------------------------------------------------
function findOrCreateTab(ss, name, headers) {
  const existing = ss.getSheets().find(
    s => s.getName().toLowerCase() === name.toLowerCase()
  );
  if (existing) return existing;

  const newSheet = ss.insertSheet(name);
  newSheet.appendRow(headers);
  newSheet.setFrozenRows(1);
  newSheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  return newSheet;
}

function appendRow(sheet, headers, row) {
  // Use column A to find the last row that actually has data.
  // sheet.getLastRow() counts rows with formatting too, which causes new rows
  // to be written far below the visible data when the sheet has phantom formatting.
  const colA      = sheet.getRange('A:A').getValues();
  let lastDataRow = 0;
  for (let i = 0; i < colA.length; i++) {
    if (colA[i][0] !== '') lastDataRow = i + 1;
  }

  if (lastDataRow === 0) {
    // Sheet is empty — write headers first
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    lastDataRow = 1;
  }

  // Write data directly after last real row (no phantom-row gap)
  sheet.getRange(lastDataRow + 1, 1, 1, row.length).setValues([row]);
}

// ---------------------------------------------------------------------------
// Date helper — ISO timestamp → "yyyy-mm-dd hh:mm" (Thailand UTC+7)
// ---------------------------------------------------------------------------
function toThaiDateTime(isoString) {
  const d = new Date(new Date(isoString || Date.now()).getTime() + 7 * 60 * 60 * 1000);
  const yyyy = d.getUTCFullYear();
  const mo   = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd   = String(d.getUTCDate()).padStart(2, '0');
  const hh   = String(d.getUTCHours()).padStart(2, '0');
  const mi   = String(d.getUTCMinutes()).padStart(2, '0');
  return yyyy + '-' + mo + '-' + dd + ' ' + hh + ':' + mi;
}

// ---------------------------------------------------------------------------
// CORS / response helper
// ---------------------------------------------------------------------------
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
