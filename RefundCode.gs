// =============================================================================
// RefundCode.gs — Google Apps Script: DC Refund Request v1.0
//
// บันทึกคำร้อง Refund จาก DC Collection Tool Extension
// ไปยัง Google Sheet tab "refund extension"
//
// Columns:
//   วันที่ | เวลา (UTC+7) | Agent Email | Credit User ID | Name |
//   Shopee Pay User ID | Product | Due Date (DD) |
//   รายการที่ขอคืน | เหตุผลที่ร้องขอ
//
// SETUP:
//   1. Extensions → Apps Script → สร้างไฟล์ใหม่ → วางโค้ดนี้ → Save
//   2. Deploy → New deployment → Web App
//      - Execute as: Me
//      - Who has access: Anyone within Monee
//   3. Copy Web App URL → ใส่ใน config.js ที่ REFUND_WEB_APP_URL
//   4. รัน setup() ครั้งแรกเพื่อสร้าง header
// =============================================================================

const REFUND_SPREADSHEET_ID = '17HP_xhTtga6x_ECfil6grJXX7vpBWML0RaT2rnI3z1g';
const REFUND_TAB            = 'refund extension';

const REFUND_HEADERS = [
  'วันที่',
  'เวลา (UTC+7)',
  'Agent Email',
  'Credit User ID',
  'Name',
  'Shopee Pay User ID',
  'Product',
  'Due Date',
  'รายการที่ขอคืน',
  'เหตุผลที่ร้องขอ',
];

// =============================================================================
// setup() — รันครั้งเดียวเพื่อสร้าง/อัปเดต header
// =============================================================================
function setup() {
  const ss    = SpreadsheetApp.openById(REFUND_SPREADSHEET_ID);
  let sheet   = ss.getSheetByName(REFUND_TAB);
  if (!sheet) sheet = ss.insertSheet(REFUND_TAB);

  sheet.getRange(1, 1, 1, REFUND_HEADERS.length).setValues([REFUND_HEADERS]);
  sheet.setFrozenRows(1);
  formatHeader(sheet, REFUND_HEADERS.length, '#004D40'); // สีเขียวเข้ม

  Logger.log('✅ Refund setup complete — tab: ' + REFUND_TAB);
  Logger.log('Headers: ' + REFUND_HEADERS.join(' | '));
}

function formatHeader(sheet, numCols, bgColor) {
  const hdr = sheet.getRange(1, 1, 1, numCols);
  hdr.setBackground(bgColor);
  hdr.setFontColor('#FFFFFF');
  hdr.setFontWeight('bold');
  hdr.setFontSize(10);
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(3, 200);  // Agent Email
  sheet.setColumnWidth(4, 160);  // Credit User ID
  sheet.setColumnWidth(5, 160);  // Name
  sheet.setColumnWidth(10, 300); // เหตุผล
}

// =============================================================================
// Entry point
// =============================================================================
function doPost(e) {
  try {
    const raw     = e.postData ? e.postData.contents : '{}';
    const payload = JSON.parse(raw);
    if (payload.type === 'REFUND') return handleRefund(payload);
    return jsonResponse({ status: 'error', message: 'Unknown type: ' + payload.type });
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.message });
  }
}

function doGet() {
  return jsonResponse({ status: 'ok', service: 'DC Refund Manager v1.0' });
}

// =============================================================================
// REFUND handler
// =============================================================================
function handleRefund(payload) {
  const timestamp    = payload.timestamp    || new Date().toISOString();
  const agentEmail   = payload.agentEmail   || '';
  const creditUserId = payload.creditUserId || '';
  const name         = payload.name         || '';
  const shopeeUserId = payload.shopeeUserId || '';
  const product      = payload.product      || '';
  const dueDate      = payload.dueDate      || '';
  const refundItem   = payload.refundItem   || '';
  const reason       = payload.reason       || '';

  const ss    = SpreadsheetApp.openById(REFUND_SPREADSHEET_ID);
  const sheet = findOrCreateTab(ss, REFUND_TAB, REFUND_HEADERS);

  appendRow(sheet, [
    toThaiDate(timestamp),
    toThaiTime(timestamp),
    agentEmail,
    creditUserId,
    name,
    shopeeUserId,
    product,
    dueDate,
    refundItem,
    reason,
  ]);

  return jsonResponse({ status: 'ok', message: 'Refund record saved', rowsWritten: 1 });
}

// =============================================================================
// Sheet helpers
// =============================================================================

function findOrCreateTab(ss, tabName, headers) {
  let sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
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
