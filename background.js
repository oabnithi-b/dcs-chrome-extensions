// =============================================================================
// background.js — Extension Service Worker (Manifest V3) v1.4
//
// CORS workaround: popup.js → chrome.runtime.sendMessage → background.js
//                 → fetch → Apps Script / Google APIs (ไม่ถูก CORS บล็อก)
//
// New in v1.4:
//   - ดึง public IP จาก api.ipify.org ทุกครั้ง login
//   - สร้าง sessionId เพื่อติดตาม session login/logout
//   - ส่ง CLOSE_SESSION ไปยัง Apps Script เมื่อ timeout หรือ LOGOUT
//   - LOGOUT handler: revoke token + clear session + close session log
// =============================================================================

const SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 นาที

// =============================================================================
// Alarm — ping ทุก 1 นาทีเพื่ออัปเดต dc_last_ping
// =============================================================================

chrome.runtime.onInstalled.addListener(() => { setupPingAlarm(); scheduleDailyReset(); });
chrome.runtime.onStartup.addListener(()   => { setupPingAlarm(); scheduleDailyReset(); });

function setupPingAlarm() {
  chrome.alarms.get('dc_session_ping', existing => {
    if (!existing) {
      chrome.alarms.create('dc_session_ping', { periodInMinutes: 1 });
      console.log('[DC] Ping alarm created');
    }
  });
}

// ── Daily reset alarm — logout อัตโนมัติทุกวันตอน 23:59 (UTC+7) ──────────────
function scheduleDailyReset() {
  chrome.alarms.get('dc_daily_reset', existing => {
    if (existing) return; // มีอยู่แล้ว ไม่ต้องสร้างใหม่
    const nextReset = getNext2359UTC7();
    chrome.alarms.create('dc_daily_reset', {
      when:            nextReset,
      periodInMinutes: 24 * 60,  // วนซ้ำทุก 24 ชั่วโมง
    });
    console.log('[DC] Daily reset alarm set for', new Date(nextReset).toISOString());
  });
}

function getNext2359UTC7() {
  const now     = new Date();
  const utc7    = new Date(now.getTime() + 7 * 3600 * 1000);
  const target  = new Date(Date.UTC(
    utc7.getUTCFullYear(), utc7.getUTCMonth(), utc7.getUTCDate(),
    23 - 7, 59, 0, 0  // 23:59 UTC+7 = 16:59 UTC
  ));
  if (target.getTime() <= now.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1); // ถ้าผ่านเวลาแล้ว → วันถัดไป
  }
  return target.getTime();
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'dc_session_ping') {
    chrome.storage.local.set({ dc_last_ping: Date.now() });
  }
  if (alarm.name === 'dc_daily_reset') {
    // Auto-logout ตอน 23:59 — mark dc_daily loggedOut เพื่อให้วันใหม่ขึ้นเป็น first_today
    chrome.storage.local.get(['dc_session', 'dc_daily'], async store => {
      const session = store.dc_session || {};
      const daily2  = store.dc_daily   || {};
      // ส่ง CLOSE_SESSION ไปยัง Apps Script ถ้า session ยังอยู่
      if (session.sessionId) {
        const cfg = await chrome.storage.local.get('dc_login_url');
        const loginUrl = cfg.dc_login_url || '';
        if (loginUrl) {
          fetch(loginUrl, {
            method: 'POST',
            body: JSON.stringify({
              type:       'CLOSE_SESSION',
              sessionId:  session.sessionId,
              email:      session.email || '',
              logoutTime: new Date().toISOString(),
              reason:     'daily_reset_2359',
            }),
          }).catch(() => {});
        }
      }
      await chrome.storage.local.set({ dc_daily: { ...daily2, loggedOut: true } });
      await chrome.storage.local.remove(['dc_session']);
      console.log('[DC] Daily reset: session cleared at 23:59');
    });
  }
});

// =============================================================================
// Message router
// =============================================================================

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {

  if (request.type === 'WARMUP') {
    // fire-and-forget GET เพื่อ warm up Apps Script ก่อนที่ user จะกด save
    fetch(request.url).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }

  if (request.type === 'SEND_TO_SHEETS') {
    console.log('[DC] SEND_TO_SHEETS ->', request.payload?.type);
    fetchSheets(request.url, request.payload)
      .then(data  => { console.log('[DC] Sheets <-', data); sendResponse({ ok: true, data }); })
      .catch(err  => { console.error('[DC] Sheets x', err.message); sendResponse({ ok: false, error: err.message }); });
    return true;
  }

  if (request.type === 'CHECK_AUTH') {
    // interactive: true  = แสดง Google popup (เมื่อ user กดปุ่มเข้าสู่ระบบ)
    // interactive: false = ตรวจ token cache เงียบๆ ไม่แสดง popup
    checkAuth(request.loginUrl, !!request.interactive)
      .then(data => { console.log('[DC] CHECK_AUTH ok', data.email, '|', data.role); sendResponse({ ok: true, data }); })
      .catch(err  => { console.error('[DC] CHECK_AUTH x', err.message); sendResponse({ ok: false, error: err.message }); });
    return true;
  }

  if (request.type === 'ADMIN_OP') {
    postScript(request.url, request.payload)
      .then(data => sendResponse({ ok: true, data }))
      .catch(err  => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (request.type === 'LOGOUT') {
    handleLogout(request.loginUrl)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

});

// =============================================================================
// checkAuth
// =============================================================================

async function checkAuth(loginUrl, interactive = true) {
  const store    = await chrome.storage.local.get(['dc_session', 'dc_daily', 'dc_last_ping']);
  const session  = store.dc_session  || {};
  let   daily    = store.dc_daily    || {};   // let เพื่อ reset เมื่อ timeout
  const lastPing = store.dc_last_ping || 0;
  const now      = Date.now();

  const timedOut = lastPing > 0 && (now - lastPing) > SESSION_TIMEOUT_MS;
  if (timedOut) {
    const gapMin = Math.round((now - lastPing) / 60000);
    console.log('[DC] Session timed out (' + gapMin + ' min) — revoking token');

    if (session.sessionId && loginUrl && !loginUrl.includes('YOUR_')) {
      try {
        await postScript(loginUrl, {
          type:       'CLOSE_SESSION',
          sessionId:  session.sessionId,
          email:      session.email || '',
          logoutTime: new Date().toISOString(),
          reason:     'timeout_15min',
        });
      } catch (_) {}
    }

    // mark loggedOut ใน dc_daily แต่เก็บ date ไว้ เพื่อแยก after_logout จาก first_today
    await chrome.storage.local.set({ dc_daily: { ...daily, loggedOut: true } });
    await chrome.storage.local.remove(['dc_session']);
    daily = { ...daily, loggedOut: true };
    await revokeGoogleToken();
  }

  // ── Fast path: session_resume — ใช้ cache ทันที ไม่ยิง Apps Script ──────────
  if (!timedOut && session.email && session.role) {
    const today2 = new Date().toISOString().slice(0, 10);
    const sameDay = daily.email === session.email && daily.date === today2;
    if (sameDay) {
      // อัปเดต last ping แล้ว return ทันที
      await chrome.storage.local.set({ dc_last_ping: now });
      console.log('[DC] Fast resume:', session.email, '|', session.role);
      return { email: session.email, role: session.role };
    }
  }
  // ────────────────────────────────────────────────────────────────────────────

  const token = await getGoogleToken(interactive);
  const email  = await getGoogleEmail(token);

  const today        = new Date().toISOString().slice(0, 10);
  const isFirstToday = daily.email !== email || daily.date !== today;
  // loginType:
  //   session_resume = popup เปิดซ้ำ (session ยังอยู่)
  //   after_logout   = login หลัง logout / timeout วันเดียวกัน
  //   first_today    = login ครั้งแรกของวัน (รวมครั้งแรกสุด)
  const loginType = !isFirstToday && !daily.loggedOut ? 'session_resume'
                  : !isFirstToday &&  daily.loggedOut  ? 'after_logout'
                  :  daily.date === today               ? 'after_logout'  // same day, different state
                  :                                       'first_today';  // new day or first ever

  // ดึง IP เฉพาะ login จริง (ไม่ใช่ session_resume) เพื่อลด latency
  let clientIp = '';
  if (loginType !== 'session_resume') {
    try {
      const ipResp = await fetch('https://api.ipify.org?format=json');
      if (ipResp.ok) {
        const ipJson = await ipResp.json();
        clientIp = ipJson.ip || '';
      }
    } catch (_) {}
  }

  const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  let role = 'agent';
  if (loginUrl && !loginUrl.includes('YOUR_')) {
    const result = await postScript(loginUrl, {
      type:              'CHECK_ACCESS',
      email,
      isFirstLoginToday: isFirstToday,
      loginType,
      sessionId,
      ip:                clientIp,
      timestamp:         new Date().toISOString(),
    });
    if (!result.allowed) {
      throw new Error(
        'คุณไม่มีสิทธิ์เข้าใช้งาน DC Collection Tool\n' +
        'กรุณาติดต่อ Admin หรือ Owner เพื่อขอสิทธิ์'
      );
    }
    role = result.role || 'agent';
  }

  await chrome.storage.local.set({
    dc_session:   { email, role, startedAt: now, sessionId },
    dc_daily:     isFirstToday ? { email, date: today } : daily,
    dc_last_ping: now,
    dc_login_url: loginUrl || '',  // เก็บไว้ให้ daily reset alarm ใช้
  });

  return { email, role };
}

// =============================================================================
// handleLogout
// =============================================================================

async function handleLogout(loginUrl) {
  const store   = await chrome.storage.local.get('dc_session');
  const session = store.dc_session || {};

  if (session.sessionId && loginUrl && !loginUrl.includes('YOUR_')) {
    try {
      await postScript(loginUrl, {
        type:       'CLOSE_SESSION',
        sessionId:  session.sessionId,
        email:      session.email || '',
        logoutTime: new Date().toISOString(),
        reason:     'manual',
      });
    } catch (_) {}
  }

  // mark loggedOut ใน dc_daily แต่เก็บ date ไว้ เพื่อแยก after_logout จาก first_today
  const store2  = await chrome.storage.local.get('dc_daily');
  const daily2  = store2.dc_daily || {};
  await chrome.storage.local.set({ dc_daily: { ...daily2, loggedOut: true } });
  await chrome.storage.local.remove(['dc_session']);
  await revokeGoogleToken();
}

// =============================================================================
// Google OAuth helpers
// =============================================================================

async function getGoogleToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: !!interactive }, token => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(token);
      }
    });
  });
}

async function getGoogleEmail(token) {
  const resp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!resp.ok) throw new Error('Google API error: HTTP ' + resp.status);
  const info = await resp.json();
  if (!info.email) throw new Error('ดึง email จาก Google ไม่ได้ — กรุณาลองใหม่');
  return info.email;
}

async function revokeGoogleToken() {
  try {
    const token = await new Promise(res => {
      chrome.identity.getAuthToken({ interactive: false }, t => res(t || null));
    });
    if (token) {
      await new Promise(res => chrome.identity.removeCachedAuthToken({ token }, res));
    }
  } catch (_) {}
}

// =============================================================================
// Generic Apps Script POST
// =============================================================================

async function postScript(url, payload) {
  if (!url || url.includes('YOUR_')) {
    throw new Error('Apps Script URL ยังไม่ได้ตั้งค่า (YOUR_...)');
  }
  const r = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' จาก Apps Script');
  const json = await r.json();
  if (json.status === 'error') throw new Error(json.message || 'Apps Script error');
  return json;
}

// =============================================================================
// Sheets fetch — สำหรับ SEND_TO_SHEETS
// =============================================================================

async function fetchSheets(url, payload) {
  if (!url || url.includes('YOUR_APPS_SCRIPT')) {
    throw new Error('Web App URL ยังไม่ได้ตั้งค่าใน config.js');
  }
  const response = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });
  if (!response.ok) throw new Error('HTTP ' + response.status + ' จาก Apps Script');
  const json = await response.json();
  if (json.status !== 'ok') throw new Error('Apps Script ตอบกลับ: ' + JSON.stringify(json));
  return json;
}
