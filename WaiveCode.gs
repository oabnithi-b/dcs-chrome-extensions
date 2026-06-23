// =============================================================================
// WaiveCode.gs — Google Apps Script: DC Waive Request v1.0
//
// บันทึกคำร้อง Waive จาก DC Collection Tool Extension
// ไปยัง Google Sheet tab "waive extension"
//
// Columns:
//   วันที่ | เวลา (UTC+7) | Agent Email | Credit User ID | Case ID (auto) |
//   Name | Product | Max DPD | Due Date | วันที่นัดชำระ |
//   ยอดที่ต้องการ Waive | เหตุผลที่ร้องขอ | Case ID (inbound)
//
// SETUP:
//   1. Extensions → Apps Script → วางโค้ดนี้ → Save
//   2. Deploy → New deployment → Web App
//      - Execute as: Me
//      - Who has access: Anyone within Monee
//   3. Copy Web App URL → ใส่ใน config.js ที่ WAIVE_WEB_APP_URL
//   4. รัน setup() ครั้งแรกเพื่อสร้าง header
// =============================================================================

const WAIVE_SPREADSHEET_ID = '1dWgwP-dFQnKkOqI5XVxf9KAcKb7yzA2VK_62ApLT73o';
const WAIVE_TAB            = 'waive extension';

const WAIVE_HEADERS = [
  'วันที่',
  'เวลา (UTC+7)',
  'Agent Email',
  'Credit User ID',
  'Case ID (auto)',
  'Name',
  'Product',
  'Max DPD',
  'Due Date',
  'วันที่นัดชำระ',
  'ยอดที่ต้องการ Waive',
  'เหตุผลที่ร้องขอ',
  'Case ID (inbound)',
];

// =============================================================================
// setup() — รันครั้งเดียวเพื่อสร้าง header
// =============================================================================
function setup() {
  const ss    = SpreadsheetApp.openById(WAIVE_SPREADSHEET_ID);
  let sheet   = ss.getSheetByName(WAIVE_TAB);
  if (!sheet) sheet = ss.insertSheet(WAIVE_TAB);

  // เขียน header ทับเสมอ แม้ tab มีอยู่แล้ว
  sheet.getRange(1, 1, 1, WAIVE_HEADERS.length).setValues([WAIVE_HEADERS]);
  sheet.setFrozenRows(1);
  formatHeader(sheet, WAIVE_HEADERS.length, '#880E4F');

  Logger.log('✅ Waive setup complete — tab: ' + WAIVE_TAB);
  Logger.log('Headers: ' + WAIVE_HEADERS.join(' | '));
}

function formatHeader(sheet, numCols, bgColor) {
  const hdr = sheet.getRange(1, 1, 1, numCols);
  hdr.setBackground(bgColor);
  hdr.setFontColor('#FFFFFF');
  hdr.setFontWeight('bold');
  hdr.setFontSize(10);
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(3, 200);  // Agent Email wider
  sheet.setColumnWidth(4, 160);  // Credit User ID
  sheet.setColumnWidth(6, 160);  // Name
}

// =============================================================================
// Entry point
// =============================================================================
function doPost(e) {
  try {
    const raw     = e.postData ? e.postData.contents : '{}';
    const payload = JSON.parse(raw);
    if (payload.type === 'WAIVE') return handleWaive(payload);
    return jsonResponse({ status: 'error', message: 'Unknown type: ' + payload.type });
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.message });
  }
}

function doGet() {
  return jsonResponse({ status: 'ok', service: 'DC Waive Manager v1.0' });
}

// =============================================================================
// WAIVE handler
// =============================================================================
function handleWaive(payload) {
  const timestamp   = payload.timestamp   || new Date().toISOString();
  const agentEmail  = payload.agentEmail  || '';
  const creditUserId= payload.creditUserId|| '';
  const caseIdAuto  = payload.caseIdAuto  || '';
  const name        = payload.name        || '';
  const product     = payload.product     || '';
  const maxDpd      = payload.maxDpd      != null ? payload.maxDpd : '';
  const dueDate     = payload.dueDate     || '';
  const apptDate    = payload.apptDate    || '';
  const waiveAmount = payload.waiveAmount || '';
  const reason      = payload.reason      || '';
  const caseIdInbound = payload.caseIdInbound || '';

  const ss    = SpreadsheetApp.openById(WAIVE_SPREADSHEET_ID);
  const sheet = findOrCreateTab(ss, WAIVE_TAB, WAIVE_HEADERS);

  appendRow(sheet, [
    toThaiDate(timestamp),
    toThaiTime(timestamp),
    agentEmail,
    creditUserId,
    caseIdAuto,
    name,
    product,
    maxDpd,
    dueDate,
    apptDate,
    waiveAmount,
    reason,
    caseIdInbound,
  ]);

  return jsonResponse({ status: 'ok', message: 'Waive record saved', rowsWritten: 1 });
}

// =============================================================================
// Sheet helpers
// =============================================================================

function findOrCreateTab(ss, tabName, headers) {
  let sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  return sheet;
}

function appendRow(sheet, rowData) {
  const nextR = sheet.getDataRange().getLastRow() + 1;
  sheet.getRange(nextR, 1, 1, rowData.length).setValues([rowData]);
}

// =============================================================================
// Date / time helpers (UTC+7)
// =============================================================================

function toThaiDate(isoString) {
  if (!isoString) return '';
  const d = new Date(new Date(isoString).getTime() + 7 * 3600 * 1000);
  return d.getUTCFullYear() + '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(d.getUTCDate()).padStart(2, '0');
}

function toThaiTime(isoString) {
  if (!isoString) return '';
  const d = new Date(new Date(isoString).getTime() + 7 * 3600 * 1000);
  return String(d.getUTCHours()).padStart(2, '0') + ':' +
    String(d.getUTCMinutes()).padStart(2, '0');
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
