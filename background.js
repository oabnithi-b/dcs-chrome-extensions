// =============================================================================
// background.js — Extension Service Worker (Manifest V3)
//
// ทำไมต้องมีไฟล์นี้:
//   content.js รันใน context ของหน้าเว็บ (collections.scredit.in.th)
//   → browser บล็อก fetch ไปยัง script.google.com ด้วย CORS policy
//
//   background service worker รันใน extension context แยกต่างหาก
//   → ไม่ถูก CORS บล็อก สามารถ fetch ไปยัง host_permissions ได้เลย
//
// Flow:
//   popup.js → chrome.runtime.sendMessage(SEND_TO_SHEETS) → background.js
//            → fetch → Apps Script Web App → Google Sheets
// =============================================================================

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === 'SEND_TO_SHEETS') {
    fetchSheets(request.url, request.payload)
      .then(data => sendResponse({ ok: true, data }))
      .catch(err  => sendResponse({ ok: false, error: err.message }));
    return true; // keep message channel open for async response
  }
});

async function fetchSheets(url, payload) {
  if (!url || url.includes('YOUR_APPS_SCRIPT')) {
    throw new Error('Web App URL ยังไม่ได้ตั้งค่าใน config.js');
  }

  const response = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
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
