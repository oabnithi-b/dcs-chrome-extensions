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

// Cache key for sessionStorage — one entry per case ID.
// This allows the extension to show the last-known data when an inbound call
// bar permanently displaces the page and extractBillRows() returns nothing.
function cacheKey(caseId) {
  return 'dc_case_' + (caseId || 'unknown');
}

async function extractData() {
  const userInfo = extractUserInfo();
  const key      = cacheKey(userInfo.caseId);

  // Retry up to 5× with 800 ms gap — the SPA may still be rendering the Bill
  // table on first load.  (Inbound call bar is handled by the cache fallback
  // below, not by waiting longer.)
  let billRows = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    billRows = extractBillRows();
    if (billRows.length > 0) break;
    if (attempt < 4) await new Promise(r => setTimeout(r, 800));
  }

  if (billRows.length === 0) {
    // Check whether Bill Info tab exists but is not the active tab
    // Supports both English ("Bill Info") and Thai ("ข้อมูลบิล") UI
    const allTabs = Array.from(document.querySelectorAll('[role="tab"]'));
    const billTab = allTabs.find(t => {
      const txt = t.textContent.trim();
      return txt === 'Bill Info' || txt === 'ข้อมูลบิล';
    });
    if (billTab && billTab.getAttribute('aria-selected') !== 'true') {
      return { error: 'BILL_INFO_TAB_NOT_ACTIVE', userInfo, billRows: [] };
    }

    // Live extraction failed — try sessionStorage cache (e.g. inbound call bar
    // has permanently pushed the page content so the bill table is gone).
    try {
      const cached = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (cached && Array.isArray(cached.billRows) && cached.billRows.length > 0) {
        return { userInfo: cached.userInfo, billRows: cached.billRows, fromCache: true };
      }
    } catch (_) {}
  }

  // Augment productType using Bill Details section headers (e.g. SPL CCC vs SPL Digi).
  // Maps generic code (e.g. 'SPL') → refined code (e.g. 'SPL Digi') based on which
  // Bill Details section header is associated with that code.
  // Falls back to summary-table code on any error or conflict.
  try {
    const sectionMap = buildSectionHeaderMap();
    if (Object.keys(sectionMap).length > 0) {
      billRows = billRows.map(row => {
        const refined = sectionMap[row.productType];
        return refined ? { ...row, productType: refined } : row;
      });
    }
  } catch (_) {
    // Non-fatal — original productType codes remain
  }

  const result = { userInfo, billRows };

  // Persist to sessionStorage so the inbound-call cache fallback can use it.
  if (billRows.length > 0) {
    try { sessionStorage.setItem(key, JSON.stringify(result)); } catch (_) {}
  }

  return result;
}

// ---------------------------------------------------------------------------
// Build a map of genericProductType → refinedProductType from Bill Details
// section headers (e.g. "Buyer Cash Loan Nano Company: Shopee" → 'BCL' → 'PCL').
//
// Two key fixes vs. naive approach:
//  1. "Company:" may live in a SEPARATE element from the product name — so we
//     walk UP a few levels collecting wider text until we find meaningful text
//     before "Company" to extract the product name from.
//  2. When finding the section's own table we must not cross into another
//     section's subtree. We stop walking up as soon as we find a container
//     with exactly ONE "Company:" text node outside tables (= this section).
// ---------------------------------------------------------------------------
function buildSectionHeaderMap() {
  if (typeof SECTION_HEADER_PRODUCT_MAP === 'undefined') return {};

  const refined   = {};
  const conflicts = new Set();

  // Normalise text: strip punctuation (keep Thai ฀-๿), collapse whitespace, lowercase
  const norm = s => s.replace(/[^\w\s฀-๿]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  // Anchor text that marks the company/owner line — English or Thai UI
  const isCompanyMarker = t => t.includes('Company:') || t.includes('บริษัท:');

  // Collect parent elements of all "Company:" / "บริษัท:" text nodes that are outside tables
  const companyEls = [];
  const walker = document.createTreeWalker(
    document.body, NodeFilter.SHOW_TEXT,
    { acceptNode(node) {
        return isCompanyMarker(node.textContent)
          ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }}
  );
  let textNode;
  while ((textNode = walker.nextNode())) {
    const el = textNode.parentElement;
    if (el && !el.closest('table')) companyEls.push(el);
  }

  for (const companyEl of companyEls) {

    // ── Phase 1: find refined product code ──────────────────────────────────
    // DOM: <span>ShopeePayLater</span><span>Digi</span>"Company: Shopee"
    // element.textContent merges spans without spaces → "ShopeePayLaterDigi..."
    // Fix: scan direct childNodes, collect text BEFORE "Company:" and join with
    // spaces to get "ShopeePayLater Digi", then match SECTION_HEADER_PRODUCT_MAP.
    let refinedCode = null;
    let probe       = companyEl;
    for (let level = 0; level < 6; level++) {
      const parts = [];
      for (const child of probe.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          if (isCompanyMarker(child.textContent)) break; // stop at Company:/บริษัท: node
          const t = child.textContent.trim();
          if (t) parts.push(t);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          if (child.getAttribute?.('role') === 'img') continue; // skip icon elements
          const t = child.textContent.trim();
          if (isCompanyMarker(t)) break;
          // Accept short clean text only — word chars, spaces, and Thai (฀-๿)
          if (t && t.length < 60 && /^[\w\s฀-๿]+$/.test(t)) parts.push(t);
        }
      }

      if (parts.length > 0) {
        const namePart = norm(parts.join(' ')); // "shopeepaytaler digi" — with space ✓
        let bestLen    = 0;
        for (const [key, code] of Object.entries(SECTION_HEADER_PRODUCT_MAP)) {
          const nkey = norm(key);
          if (namePart.includes(nkey) && nkey.length > bestLen) {
            refinedCode = code;
            bestLen     = nkey.length;
          }
        }
        if (refinedCode) break;
      }

      if (!probe.parentElement || probe.parentElement === document.body) break;
      probe = probe.parentElement;
    }
    if (!refinedCode) continue;

    // ── Phase 2: find this section's own table ───────────────────────────────
    // Walk up from companyEl. At each level that contains ≥1 table, count the
    // "Company:" text nodes (outside tables) in that subtree:
    //   count === 1 → this is the correct section wrapper → use its first table
    //   count  >  1 → we've crossed a common parent of multiple sections → stop
    let sectionTable = null;
    let container    = companyEl;
    for (let i = 0; i < 12; i++) {
      if (!container.parentElement || container.parentElement === document.body) break;
      container = container.parentElement;

      if (!container.querySelector('table')) continue; // no table yet — keep walking

      let count = 0;
      const w2  = document.createTreeWalker(
        container, NodeFilter.SHOW_TEXT,
        { acceptNode(n) {
            return (isCompanyMarker(n.textContent) && !n.parentElement?.closest('table'))
              ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }}
      );
      while (w2.nextNode()) { if (++count > 1) break; }

      if (count === 1) {
        // Ant Design fixed-header renders two separate <table> elements:
        //   1st table: <thead> only (no <td>) — the frozen header
        //   2nd table: <tbody> with actual data rows (<td>) — the scroll body
        // querySelector('table') returns the 1st (header-only), which has no <td>
        // and yields no product codes.  Find the first table that actually has <td>.
        for (const t of container.querySelectorAll('table')) {
          if (t.querySelector('td')) { sectionTable = t; break; }
        }
        break;
      }
      if (count >  1) break;   // overshot — multiple sections share this ancestor
    }
    if (!sectionTable) continue;

    // ── Phase 3: read Product column (index 1) from the section table ────────
    // Bill Details columns: Amount To Pay | Product | Bill ID | …
    const genericCodes = new Set();
    for (const row of sectionTable.querySelectorAll('tr')) {
      const cells = Array.from(row.querySelectorAll('td'));
      if (cells.length < 2) continue;
      const code = cells[1]?.textContent.trim();
      if (code && code.length > 0 && code.length < 20) genericCodes.add(code);
    }

    // ── Phase 4: register with conflict detection ─────────────────────────────
    for (const genericCode of genericCodes) {
      if (conflicts.has(genericCode)) continue;
      if (refined[genericCode] && refined[genericCode] !== refinedCode) {
        conflicts.add(genericCode);
        delete refined[genericCode];
      } else {
        refined[genericCode] = refinedCode;
      }
    }
  }

  return refined; // e.g. { SPL: 'SPL Digi', BCL: 'PCL', … }
}

function extractUserInfo() {
  function getField(forAttr) {
    const label = document.querySelector(`label[for="${forAttr}"]`);
    const item  = label?.closest('.ant-form-item');
    return item?.querySelector('.ant-form-item-control-input-content')
               ?.textContent?.trim() ?? null;
  }

  // Extract caseId correctly for both page types:
  //   Normal:   /main/case/detail/12831655            → "12831655"
  //   Inbound:  /main/agentWorkstation/case/inboundCallDetail?conversationId=…
  //             → try DOM link to /case/detail/, otherwise use conversationId param
  function extractCaseId() {
    const href = window.location.href;

    // Normal case detail page
    const detailMatch = href.match(/\/case\/detail\/([^/?#]+)/);
    if (detailMatch) return detailMatch[1];

    // Inbound call page — look for a DOM link back to the case detail
    const caseLink = document.querySelector('a[href*="/case/detail/"]');
    if (caseLink) {
      const m = (caseLink.href || '').match(/\/case\/detail\/([^/?#]+)/);
      if (m) return m[1];
    }

    // Inbound call page — Case ID is visible in the "Case Info" section.
    // The DC System renders it as "Case ID: 4970918" or "Case ID  4970918"
    // (colon may or may not appear in innerText depending on layout).
    // Strategy A: scan innerText with flexible regex (colon optional)
    const bodyText = document.body.innerText || '';
    const domMatch = bodyText.match(/Case\s+ID\s*[：:]?\s*(\d{5,})/);
    if (domMatch) return domMatch[1];

    // Strategy B: find element whose text is exactly "Case ID" then read
    // the adjacent sibling / parent text for the numeric value
    const allEls = Array.from(document.querySelectorAll('span, div, td, p, label'));
    for (const el of allEls) {
      if (el.children.length > 0) continue;          // leaf nodes only
      if (!/^Case\s*ID\s*:?\s*$/.test(el.textContent.trim())) continue;
      // try next sibling
      const sib = el.nextElementSibling;
      if (sib) {
        const m = sib.textContent.trim().match(/^(\d{5,})/);
        if (m) return m[1];
      }
      // try parent text (label + value in same container)
      const parentText = el.parentElement?.textContent || '';
      const pm = parentText.match(/Case\s*ID\s*[：:]?\s*(\d{5,})/);
      if (pm) return pm[1];
    }

    // Nothing found — return null (Case ID column will be blank)
    return null;
  }

  return {
    agentEmail:   document.querySelector('.name___2eduw')?.textContent?.trim() ?? null,
    creditUserId: getField('userInfo_userId'),
    name:         getField('userInfo_userName'),
    shopeeUserId: getField('userInfo_shopeeUserId'),
    caseId:       extractCaseId(),
  };
}

function extractBillRows() {
  // Identify the bill summary table by its header columns
  const tables    = Array.from(document.querySelectorAll('table'));
  const billTable = tables.find(t => {
    const headers = Array.from(t.querySelectorAll('th')).map(th => th.textContent.trim());
    // "Bill ID" → Thai: "รหัสใบเรียกเก็บเงิน" (translated)
    // "Product Type" and "Days Past Due" stay in English in both language modes
    const hasBillId = headers.includes('Bill ID') || headers.includes('รหัสใบเรียกเก็บเงิน');
    return hasBillId && headers.includes('Product Type');
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
