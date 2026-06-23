// =============================================================================
// LoginCode.gs — Google Apps Script: DC Login + Whitelist + Session Log v2.1
//
// Operation types:
//   CHECK_ACCESS  — ตรวจสิทธิ์ + เปิด session row + ส่ง email (ครั้งแรกของวัน)
//   CLOSE_SESSION — ปิด session row (logout / timeout / new day)
//   LIST_USERS    — ดึงรายชื่อ (admin/owner)
//   ADD_USER      — เพิ่มผู้ใช้
//   UPDATE_USER   — แก้ไข status/role
//
// Google Sheet tabs:
//   "Whitelist"    → Email | Role | Status | AddedBy | AddedDate | LastLogin
//   "Login Log"    → Date | Time(UTC+7) | Email | Role | Type
//   "Session Log"  → SessionID | Email | Role | LoginDate | LoginTime |
//                    LogoutDate | LogoutTime | Duration(min) | IP | LogoutReason
//
// SETUP:
//   1. สร้าง Google Sheet ใหม่ → ใส่ Spreadsheet ID ด้านล่าง
//   2. Extensions → Apps Script → วางโค้ดนี้ → Save
//   3. Deploy → New deployment → Web App
//      - Execute as: Me
//      - Who has access: Anyone (หรือ Anyone within Monee)
//   4. Copy Web App URL → ใส่ใน config.js ที่ LOGIN_WEB_APP_URL
// =============================================================================

const LOGIN_SPREADSHEET_ID = '1Dv7xHicm-xmMRL02MqvBdb68CT3ZXdcsKqzQ6XHVec0';

// ── Whitelist sheet ─────────────────────────────────────────────────────────
const WL_TAB     = 'Whitelist';
const WL_HEADERS = ['Email', 'Role', 'Status', 'AddedBy', 'AddedDate', 'LastLogin'];
const WL_COL     = { email: 1, role: 2, status: 3, addedBy: 4, addedDate: 5, lastLogin: 6 };

// ── Login Log sheet ─────────────────────────────────────────────────────────
const LOG_TAB     = 'Login Log';
const LOG_HEADERS = ['Date', 'Time (UTC+7)', 'Email', 'Role', 'Type'];

// ── Session Log sheet ───────────────────────────────────────────────────────
const SES_TAB     = 'Session Log';
const SES_HEADERS = ['SessionID', 'Email', 'Role', 'LoginDate', 'LoginTime',
                     'LogoutDate', 'LogoutTime', 'Duration(min)', 'IP', 'LogoutReason'];
const SES_COL     = {
  sessionId: 1, email: 2, role: 3,
  loginDate: 4, loginTime: 5,
  logoutDate: 6, logoutTime: 7, duration: 8,
  ip: 9, reason: 10
};

const ROLE_RANK = { agent: 1, admin: 2, owner: 3 };

// =============================================================================
// testEmail() — ทดสอบส่งอีเมลโดยตรง (รันใน Apps Script Editor)
// วิธีใช้: เปลี่ยน TEST_EMAIL → กด Run → ดู Execution log
// =============================================================================
function testEmail() {
  const TEST_EMAIL = 'thawatchai.man@monee.com'; // ← เปลี่ยนเป็น email ที่ต้องการทดสอบ
  try {
    GmailApp.sendEmail(
      TEST_EMAIL,
      '[TEST] DC Collection Tool — ทดสอบส่งอีเมล',
      'ทดสอบระบบส่งอีเมล DC Collection Tool\nถ้าได้รับอีเมลนี้แสดงว่าระบบทำงานปกติ',
      { name: 'DC Collection Tool Test' }
    );
    Logger.log('✅ Test email sent to: ' + TEST_EMAIL);
  } catch (err) {
    Logger.log('❌ Test email FAILED: ' + err.message);
  }
}

// =============================================================================
// setup() — รันครั้งเดียวเพื่อสร้างแท็บ + header ทั้งหมด
// วิธีใช้: Apps Script Editor → เลือกฟังก์ชัน "setup" → กด Run
// =============================================================================
function setup() {
  const ss = SpreadsheetApp.openById(LOGIN_SPREADSHEET_ID);

  // 1. Whitelist
  const wl = findOrCreateTab(ss, WL_TAB, WL_HEADERS);
  formatHeader(wl, WL_HEADERS.length, '#1A237E');

  // 2. Login Log
  const log = findOrCreateTab(ss, LOG_TAB, LOG_HEADERS);
  formatHeader(log, LOG_HEADERS.length, '#1B5E20');

  // 3. Session Log
  const ses = findOrCreateTab(ss, SES_TAB, SES_HEADERS);
  formatHeader(ses, SES_HEADERS.length, '#4A148C');

  Logger.log('✅ Setup complete — สร้างแท็บและ header เรียบร้อยแล้ว');
  Logger.log('  Whitelist   : ' + WL_HEADERS.join(' | '));
  Logger.log('  Login Log   : ' + LOG_HEADERS.join(' | '));
  Logger.log('  Session Log : ' + SES_HEADERS.join(' | '));
}

function formatHeader(sheet, numCols, bgColor) {
  const hdr = sheet.getRange(1, 1, 1, numCols);
  hdr.setBackground(bgColor);
  hdr.setFontColor('#FFFFFF');
  hdr.setFontWeight('bold');
  hdr.setFontSize(10);
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 220); // Email column wider
}

// =============================================================================
// Entry point
// =============================================================================
function doPost(e) {
  try {
    const raw     = e.postData ? e.postData.contents : '{}';
    const payload = JSON.parse(raw);
    switch (payload.type) {
      case 'CHECK_ACCESS':  return handleCheckAccess(payload);
      case 'CLOSE_SESSION': return handleCloseSession(payload);
      case 'LIST_USERS':    return handleListUsers(payload);
      case 'ADD_USER':      return handleAddUser(payload);
      case 'UPDATE_USER':   return handleUpdateUser(payload);
      default:
        return jsonResponse({ status: 'error', message: 'Unknown type: ' + payload.type });
    }
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.message });
  }
}

function doGet() {
  return jsonResponse({ status: 'ok', service: 'DC Login Manager v2.1' });
}

// =============================================================================
// CHECK_ACCESS — ตรวจ whitelist + เปิด session row + log + email
// =============================================================================
function handleCheckAccess(payload) {
  const email     = (payload.email     || '').toLowerCase().trim();
  const isFirst   = !!payload.isFirstLoginToday;
  const sessionId = payload.sessionId  || '';
  const ip        = payload.ip         || '';
  const timestamp = payload.timestamp  || new Date().toISOString();

  if (!email) return jsonResponse({ status: 'error', message: 'Missing email' });

  const ss  = SpreadsheetApp.openById(LOGIN_SPREADSHEET_ID);
  const wl  = findOrCreateTab(ss, WL_TAB, WL_HEADERS);
  const row = findUserRow(wl, email);

  if (!row || row[WL_COL.status - 1] !== 'active') {
    return jsonResponse({ status: 'ok', allowed: false, role: null });
  }

  const role = row[WL_COL.role - 1] || 'agent';

  // อัปเดต LastLogin ใน Whitelist
  updateLastLogin(wl, email, toThaiDate(timestamp) + ' ' + toThaiTime(timestamp));

  const loginType = payload.loginType || (isFirst ? 'first_today' : 'session_resume');

  // บันทึก Login Log — เฉพาะ first_today และ after_logout เท่านั้น (ไม่บันทึก session_resume)
  if (loginType !== 'session_resume') {
    const logSheet = findOrCreateTab(ss, LOG_TAB, LOG_HEADERS);
    appendRow(logSheet, [
      toThaiDate(timestamp),
      toThaiTime(timestamp),
      email,
      role,
      loginType,
    ]);
  }

  // เปิด Session Log row ใหม่ — เฉพาะ login จริง (ไม่สร้างแถวซ้ำสำหรับ session_resume)
  if (sessionId && loginType !== 'session_resume') {
    const sesSheet = findOrCreateTab(ss, SES_TAB, SES_HEADERS);
    appendRow(sesSheet, [
      sessionId,
      email,
      role,
      toThaiDate(timestamp),
      toThaiTime(timestamp),
      '', '', '', // logout fields — ยังไม่รู้
      ip,
      '',         // logout reason
    ]);
  }

  // ส่ง email แจ้งเตือน — เฉพาะ first_today (ไม่ส่งซ้ำเมื่อ login หลัง logout วันเดิม)
  if (loginType === 'first_today') {
    try {
      GmailApp.sendEmail(
        email,
        '[DC Collection Tool] เข้าสู่ระบบสำเร็จ',
        buildPlainBody(email, role, timestamp),
        { htmlBody: buildHtmlBody(email, role, timestamp), name: 'DC Collection Tool' }
      );
      console.log('✅ Email sent to: ' + email);
    } catch (mailErr) {
      console.log('❌ Email send failed for ' + email + ': ' + mailErr.message);
    }
  }

  return jsonResponse({ status: 'ok', allowed: true, role });
}

// =============================================================================
// CLOSE_SESSION — บันทึก logout time + คำนวณ Duration
// =============================================================================
function handleCloseSession(payload) {
  const sessionId  = payload.sessionId  || '';
  const logoutTime = payload.logoutTime || new Date().toISOString();
  const reason     = payload.reason     || '';

  if (!sessionId) return jsonResponse({ status: 'error', message: 'Missing sessionId' });

  const ss        = SpreadsheetApp.openById(LOGIN_SPREADSHEET_ID);
  const sesSheet  = findOrCreateTab(ss, SES_TAB, SES_HEADERS);
  const rowIdx    = findSessionRowIndex(sesSheet, sessionId);

  if (rowIdx < 0) {
    // Session row ไม่พบ — อาจถูกลบหรือไม่เคยสร้าง (skip gracefully)
    return jsonResponse({ status: 'ok', message: 'Session row not found — skipped' });
  }

  const data      = sesSheet.getDataRange().getValues();
  const rowData   = data[rowIdx - 1];
  const loginDate = rowData[SES_COL.loginDate - 1] || '';
  const loginTime = rowData[SES_COL.loginTime - 1] || '';

  const logoutDateStr = toThaiDate(logoutTime);
  const logoutTimeStr = toThaiTime(logoutTime);

  // คำนวณ duration (นาที)
  let durationMin = '';
  try {
    const loginDt  = new Date(loginDate + 'T' + loginTime + ':00+07:00');
    const logoutDt = new Date(new Date(logoutTime).getTime() + 7 * 3600 * 1000);
    const diffMs   = logoutDt - loginDt;
    if (!isNaN(diffMs) && diffMs >= 0) {
      durationMin = Math.round(diffMs / 60000);
    }
  } catch (_) {}

  sesSheet.getRange(rowIdx, SES_COL.logoutDate).setValue(logoutDateStr);
  sesSheet.getRange(rowIdx, SES_COL.logoutTime).setValue(logoutTimeStr);
  sesSheet.getRange(rowIdx, SES_COL.duration).setValue(durationMin);
  sesSheet.getRange(rowIdx, SES_COL.reason).setValue(reason);

  // บันทึก Login Log — เพิ่มแถว logout ทุกกรณี (manual / timeout_15min / ฯลฯ)
  const logEmail  = payload.email || rowData[SES_COL.email - 1] || '';
  const logRole   = rowData[SES_COL.role - 1] || '';
  const logType   = reason === 'manual' ? 'logout' : 'logout (' + reason + ')';
  const logSheet2 = findOrCreateTab(ss, LOG_TAB, LOG_HEADERS);
  appendRow(logSheet2, [
    logoutDateStr,
    logoutTimeStr,
    logEmail,
    logRole,
    logType,
  ]);

  return jsonResponse({ status: 'ok', durationMin });
}

// =============================================================================
// LIST_USERS
// =============================================================================
function handleListUsers(payload) {
  const requestedBy = (payload.requestedBy || '').toLowerCase().trim();
  const ss  = SpreadsheetApp.openById(LOGIN_SPREADSHEET_ID);
  const wl  = findOrCreateTab(ss, WL_TAB, WL_HEADERS);
  const reqRow  = findUserRow(wl, requestedBy);
  const reqRole = reqRow ? reqRow[WL_COL.role - 1] : null;

  if (!reqRole || (reqRole !== 'admin' && reqRole !== 'owner')) {
    return jsonResponse({ status: 'error', message: 'ไม่มีสิทธิ์ดูรายชื่อผู้ใช้' });
  }

  const data  = wl.getDataRange().getValues();
  const users = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r[0]) continue;
    users.push({
      email:     r[WL_COL.email - 1],
      role:      r[WL_COL.role - 1],
      status:    r[WL_COL.status - 1],
      addedBy:   r[WL_COL.addedBy - 1],
      addedDate: r[WL_COL.addedDate - 1],
      lastLogin: r[WL_COL.lastLogin - 1],
    });
  }

  return jsonResponse({ status: 'ok', users });
}

// =============================================================================
// ADD_USER
// =============================================================================
function handleAddUser(payload) {
  const requestedBy = (payload.requestedBy || '').toLowerCase().trim();
  const newEmail    = (payload.email        || '').toLowerCase().trim();
  const newRole     = (payload.role         || 'agent').toLowerCase();

  if (!newEmail || !newEmail.includes('@'))
    return jsonResponse({ status: 'error', message: 'email ไม่ถูกต้อง' });

  const ss     = SpreadsheetApp.openById(LOGIN_SPREADSHEET_ID);
  const wl     = findOrCreateTab(ss, WL_TAB, WL_HEADERS);
  const reqRow  = findUserRow(wl, requestedBy);
  const reqRole = reqRow ? reqRow[WL_COL.role - 1] : null;

  if (!reqRole || ROLE_RANK[reqRole] < ROLE_RANK['admin'])
    return jsonResponse({ status: 'error', message: 'ไม่มีสิทธิ์เพิ่มผู้ใช้' });

  if (reqRole === 'admin' && newRole !== 'agent')
    return jsonResponse({ status: 'error', message: 'Admin เพิ่มได้เฉพาะ Agent เท่านั้น' });

  if (newRole === 'owner')
    return jsonResponse({ status: 'error', message: 'ไม่สามารถเพิ่ม Owner ผ่านระบบนี้ได้' });

  if (findUserRow(wl, newEmail)) {
    updateUserField(wl, newEmail, WL_COL.status, 'active');
    updateUserField(wl, newEmail, WL_COL.role, newRole);
    return jsonResponse({ status: 'ok', message: 'Reactivated existing user' });
  }

  appendRow(wl, [newEmail, newRole, 'active', requestedBy, toThaiDate(new Date().toISOString()), '']);
  return jsonResponse({ status: 'ok', message: 'User added' });
}

// =============================================================================
// UPDATE_USER
// =============================================================================
function handleUpdateUser(payload) {
  const requestedBy = (payload.requestedBy || '').toLowerCase().trim();
  const targetEmail = (payload.email        || '').toLowerCase().trim();
  const changes     = payload.changes       || {};

  const ss       = SpreadsheetApp.openById(LOGIN_SPREADSHEET_ID);
  const wl       = findOrCreateTab(ss, WL_TAB, WL_HEADERS);
  const reqRow    = findUserRow(wl, requestedBy);
  const reqRole   = reqRow    ? reqRow[WL_COL.role - 1]    : null;
  const targetRow = findUserRow(wl, targetEmail);
  const targetRole = targetRow ? targetRow[WL_COL.role - 1] : null;

  if (!reqRole || ROLE_RANK[reqRole] < ROLE_RANK['admin'])
    return jsonResponse({ status: 'error', message: 'ไม่มีสิทธิ์แก้ไขผู้ใช้' });

  if (!targetRow)
    return jsonResponse({ status: 'error', message: 'ไม่พบ email: ' + targetEmail });

  if (targetRole === 'owner')
    return jsonResponse({ status: 'error', message: 'ไม่สามารถแก้ไข Owner ได้' });

  if (reqRole === 'admin' && targetRole !== 'agent')
    return jsonResponse({ status: 'error', message: 'Admin แก้ไขได้เฉพาะ Agent เท่านั้น' });

  if (changes.status) {
    if (!['active', 'inactive'].includes(changes.status))
      return jsonResponse({ status: 'error', message: 'status ไม่ถูกต้อง' });
    updateUserField(wl, targetEmail, WL_COL.status, changes.status);
  }

  if (changes.role) {
    if (reqRole !== 'owner')
      return jsonResponse({ status: 'error', message: 'เฉพาะ Owner เท่านั้นที่เปลี่ยน role ได้' });
    if (!['agent', 'admin'].includes(changes.role))
      return jsonResponse({ status: 'error', message: 'role ไม่ถูกต้อง' });
    updateUserField(wl, targetEmail, WL_COL.role, changes.role);
  }

  return jsonResponse({ status: 'ok', message: 'Updated' });
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

function findUserRow(sheet, email) {
  if (!email) return null;
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase().trim() === email) return data[i];
  }
  return null;
}

function findUserRowIndex(sheet, email) {
  if (!email) return -1;
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase().trim() === email) return i + 1;
  }
  return -1;
}

// หา row index ของ Session Log โดย SessionID (column 1)
function findSessionRowIndex(sheet, sessionId) {
  if (!sessionId) return -1;
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === sessionId) return i + 1;
  }
  return -1;
}

function updateUserField(sheet, email, colIndex, value) {
  const rowIdx = findUserRowIndex(sheet, email);
  if (rowIdx < 0) return;
  sheet.getRange(rowIdx, colIndex).setValue(value);
}

function updateLastLogin(sheet, email, dateTimeStr) {
  updateUserField(sheet, email, WL_COL.lastLogin, dateTimeStr);
}

function appendRow(sheet, rowData) {
  const nextR = sheet.getDataRange().getLastRow() + 1;
  sheet.getRange(nextR, 1, 1, rowData.length).setValues([rowData]);
}

// =============================================================================
// Email builders
// =============================================================================

function buildPlainBody(email, role, isoTs) {
  return (
    'แจ้งการเข้าสู่ระบบ DC Collection Tool\n\n' +
    'Agent  : ' + email + '\n' +
    'Role   : ' + roleTH(role) + '\n' +
    'วันที่ : ' + toThaiDate(isoTs) + '\n' +
    'เวลา   : ' + toThaiTime(isoTs) + ' น. (UTC+7)\n\n' +
    'หากคุณไม่ได้เป็นผู้เข้าสู่ระบบ กรุณาแจ้ง Admin ทันที'
  );
}

function buildHtmlBody(email, role, isoTs) {
  const roleLabel = roleTH(role);
  const roleColor = { owner: '#4527a0', admin: '#e65100', agent: '#1565c0' }[role] || '#2c2c2c';
  const roleBg    = { owner: '#ede7f6', admin: '#fff3e0', agent: '#e3f2fd' }[role] || '#f5f5f5';

  return '<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"></head>' +
    '<body style="margin:0;padding:20px;background:#f0f2f5;font-family:Segoe UI,Arial,sans-serif;">' +
    '<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:10px;' +
    'border:1px solid #e0e0e0;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">' +
    '<div style="background:#1a237e;padding:16px 22px;">' +
    '<span style="color:#fff;font-size:16px;font-weight:700;">💼 DC Collection Tool</span></div>' +
    '<div style="padding:24px 22px 20px;">' +
    '<h3 style="margin:0 0 16px;color:#1a237e;font-size:17px;">✅ เข้าสู่ระบบสำเร็จ</h3>' +
    '<table style="width:100%;border-collapse:collapse;font-size:14px;">' +
    '<tr><td style="padding:7px 0;color:#757575;width:90px;">Agent</td>' +
    '<td style="padding:7px 0;font-weight:700;color:#2c2c2c;">' + email + '</td></tr>' +
    '<tr><td style="padding:7px 0;color:#757575;">Role</td>' +
    '<td style="padding:7px 0;"><span style="display:inline-block;padding:2px 10px;border-radius:10px;' +
    'font-size:12px;font-weight:700;background:' + roleBg + ';color:' + roleColor + ';">' + roleLabel + '</span></td></tr>' +
    '<tr><td style="padding:7px 0;color:#757575;">วันที่</td>' +
    '<td style="padding:7px 0;color:#2c2c2c;">' + toThaiDate(isoTs) + '</td></tr>' +
    '<tr><td style="padding:7px 0;color:#757575;">เวลา</td>' +
    '<td style="padding:7px 0;color:#2c2c2c;">' + toThaiTime(isoTs) + ' น. (UTC+7)</td></tr>' +
    '</table>' +
    '<div style="margin-top:20px;padding:12px 14px;background:#fff3e0;border-radius:6px;' +
    'border-left:3px solid #fb8c00;font-size:12.5px;color:#795548;line-height:1.6;">' +
    '⚠️ หากคุณ<strong>ไม่ได้</strong>เป็นผู้เข้าสู่ระบบ กรุณาแจ้ง Admin ทันที</div></div>' +
    '<div style="background:#f5f5f5;padding:10px 22px;font-size:11px;color:#bdbdbd;border-top:1px solid #eee;">' +
    'อีเมลนี้ถูกส่งอัตโนมัติโดย DC Collection Tool — กรุณาอย่าตอบกลับ</div></div></body></html>';
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

function roleTH(role) {
  return { owner: 'Owner', admin: 'Admin', agent: 'Agent' }[role] || role;
}

// =============================================================================
// JSON response
// =============================================================================
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
