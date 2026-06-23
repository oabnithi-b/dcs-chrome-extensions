// =============================================================================
// SMS Trigger — Google Apps Script
// Spreadsheet: https://docs.google.com/spreadsheets/d/1Ps3FhQETp5OU7pIVPberQR4tcr9n880zS-sBtzHFTKc
// Tab: "SMS extension"
// Deploy: Extensions → Apps Script → Deploy → New deployment → Web app
//         Execute as: Me | Who has access: Anyone within Monee (domain)
// หลัง Deploy → Copy Web app URL → วางใน config.js SMS_WEB_APP_URL
// =============================================================================

const SMS_SPREADSHEET_ID = '1Ps3FhQETp5OU7pIVPberQR4tcr9n880zS-sBtzHFTKc';
const SMS_TAB            = 'SMS extension';
const SMS_HEADERS        = [
  'Date',
  'Agent Email',
  'Credit User ID',
  'Name',
  'Product',
  'ธนาคาร',
  'ประเภทการชำระ',
  'ยอดชำระ',
  'วันที่นัดชำระ',
  'เบอร์โทร',
];

// ---------------------------------------------------------------------------
// doPost — entry point
// ---------------------------------------------------------------------------
function doPost(e) {
  try {
    const raw     = e.postData ? e.postData.contents : '{}';
    const payload = JSON.parse(raw);

    const sheet = findOrCreateTab(SMS_SPREADSHEET_ID, SMS_TAB, SMS_HEADERS);
    const row   = buildRow(payload);
    appendRow(sheet, row);

    return jsonResponse({ status: 'ok', rowsWritten: 1 });
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.message, rowsWritten: 0 });
  }
}

// ---------------------------------------------------------------------------
// buildRow
// ---------------------------------------------------------------------------
function buildRow(p) {
  return [
    toThaiDate(p.timestamp),   // Date = yyyy-mm-dd
    p.agentEmail   || '',
    p.creditUserId || '',
    p.name         || '',
    p.product      || '',
    p.bank         || '',
    p.paymentType  || '',
    p.amount       || '',
    p.apptDate     || '',      // วันที่นัดชำระ (yyyy-mm-dd จาก date input)
    p.phone        || '',
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** หา / สร้าง sheet tab และเพิ่ม header row ถ้าว่าง */
function findOrCreateTab(spreadsheetId, tabName, headers) {
  const ss    = SpreadsheetApp.openById(spreadsheetId);
  let   sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
  }
  // ถ้า header ยังไม่มี ให้เพิ่ม
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }
  return sheet;
}

/** appendRow แบบสแกน column A เพื่อหลีกเลี่ยง phantom rows */
function appendRow(sheet, rowData) {
  const nextR = sheet.getDataRange().getLastRow() + 1;
  sheet.getRange(nextR, 1, 1, rowData.length).setValues([rowData]);
}

/** แปลง ISO timestamp → yyyy-mm-dd (Thailand UTC+7) */
function toThaiDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  d.setHours(d.getHours() + 7); // UTC → UTC+7
  const yyyy = d.getUTCFullYear();
  const mm   = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd   = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** ส่งผล JSON กลับ */
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
