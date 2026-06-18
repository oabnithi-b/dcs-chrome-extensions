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
  'Delinquent',
  'Next Calling Date',
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
    payload.timestamp        || new Date().toISOString(),
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
    payload.timestamp    || new Date().toISOString(),
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
    payload.timestamp      || new Date().toISOString(),
    payload.agentEmail     || '',
    payload.creditUserId   || '',
    payload.name           || '',
    payload.productLabel   || '',
    payload.caseId         || '',
    payload.maxDaysPastDue || '',
    payload.excludeType    || '',
    payload.reason         || '',
    payload.appointStatus  || '',
    payload.delinquent     || '',
    payload.nextCallingDate|| '',
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
  const lastRow = sheet.getLastRow();
  if (lastRow === 0) {
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  sheet.appendRow(row);
}

// ---------------------------------------------------------------------------
// CORS / response helper
// ---------------------------------------------------------------------------
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
