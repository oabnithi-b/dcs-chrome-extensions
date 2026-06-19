# DC Collection Tool — Project Handoff

> Intended for colleagues picking up this project. Covers everything you need to understand the codebase, configure it, and continue development with Claude.

---

## 1. What This Is

A **Chrome Extension (Manifest V3, Vanilla JS)** used by debt-collection agents at `collections.scredit.in.th/main/case/detail/:caseId`.

**Problem it solves:** Agents previously had to manually copy numbers from the DC System into a Google Sheets calculator. This extension reads bill data directly from the page DOM and runs the eligibility logic in-extension, showing agents the result instantly during live customer calls.

**Phase 1 tools (implemented):**
| Tool | Purpose |
|---|---|
| 🧮 Partial Payment | Check eligibility + show offer amounts for all 3 DPD zones |
| 💸 Discount | Show close-account discount table (10–80%) per product |
| 📊 ดอกเบี้ย | Interactive late-interest calculator (SPL/BCL/SCL variants) |

**Future phases (stubs in place):**
- Restructure (rules TBD)
- Full Settlement (rules TBD)

---

## 2. Required Software

| Software | Purpose | Download |
|---|---|---|
| Google Chrome (or any Chromium browser) | Run the extension | Installed on agent PCs |
| Notepad++ / VS Code | Edit config rules | On "host PC" (team lead) |
| Google Account | Deploy Apps Script audit log | Sheets writer |

> **No build step. No npm. No framework.** Pure HTML/CSS/JS — open files directly.

---

## 3. File Structure

```
DCs Extension/
├── manifest.json         Chrome Extension config (MV3)
├── config.js             ALL business rules in one place  ← EDIT THIS FOR RULE CHANGES
├── eligibility.js        Pure calculation engine (no DOM, no fetch)
├── content.js            Injected into DC System page; scrapes DOM
├── popup.html            Extension popup UI
├── popup.js              Popup UI logic + tool rendering
├── Code.gs               Google Apps Script for audit log (deployed separately)
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── HANDOFF.md            This file
└── Partial Payment Calculator.xlsx   Source of truth for all business rules
```

**Dependency load order** (important — scripts must load in this sequence):
```
config.js → eligibility.js → content.js  (content script context)
config.js → eligibility.js → popup.js    (popup context via <script> tags)
```

---

## 4. How to Install the Extension

1. Open Chrome → go to `chrome://extensions/`
2. Enable **Developer Mode** (top-right toggle)
3. Click **Load unpacked** → select the `DCs Extension` folder
4. The "DC Collection Tool" icon appears in the Chrome toolbar
5. Navigate to any `collections.scredit.in.th/main/case/detail/...` page
6. Click the extension icon — popup opens and auto-reads the page

**Updating for agents:**
- Agent PCs do NOT need to reinstall after rule changes
- The "host PC" (team lead) edits `config.js`, then the agent clicks "Reload" on `chrome://extensions/` (or the reload icon next to the extension)
- For code changes (not just config), share the updated folder and repeat step 3–4

---

## 5. Business Rules Reference (config.js)

All configurable rules are in **`config.js`** and marked `// [CONFIGURABLE RULE]`.

### 5.1 Product eligibility for Partial Payment
```javascript
const PRODUCT_CONFIG = {
  SPL:  { eligibleForPartial: true,  ... },  // ShopeePayLater Digi
  SPLX: { eligibleForPartial: true,  ... },  // SPL CCC
  BCL:  { eligibleForPartial: false, ... },  // PCL Nano
  SCL:  { eligibleForPartial: false, ... },  // SCL Nano
  TL:   { eligibleForPartial: false, ... },  // Term Loan
  Fast: { eligibleForPartial: false, ... },  // Fast Escrow
  PCL:  { eligibleForPartial: false, ... },  // PCL Digi
};
```

### 5.2 Zone percentage table (from Excel "เงื่อนไข" sheet)
```javascript
const PARTIAL_ZONE_TABLE = [
  { minAmount: 1000,     maxAmount: 3000,     green: 50, yellow: 35, red: null },
  { minAmount: 3000,     maxAmount: 5000,     green: 50, yellow: 35, red: 20   },
  { minAmount: 5000,     maxAmount: 7500,     green: 50, yellow: 30, red: 15   },
  { minAmount: 7500,     maxAmount: 10000,    green: 50, yellow: 30, red: 15   },
  { minAmount: 10000,    maxAmount: Infinity, green: 50, yellow: 30, red: 15   },
];
```

### 5.3 DPD zone thresholds
```javascript
const DPD_ZONE_THRESHOLDS = {
  greenMax: 30,   // DPD 0–30   → Green Zone
  yellowMax: 90,  // DPD 31–90  → Yellow Zone
                  // DPD > 90   → Red Zone
};
```

### 5.4 Minimum amounts
```javascript
const PARTIAL_MIN_AMOUNT = 1000;             // Min total due for any Partial offer
const PARTIAL_RED_ZONE_MIN_AMOUNT = 3000;    // Extra min for Red Zone
```

### 5.5 Discount percentages (from Excel "ส่วนลดปิดบัญชี WRO 3" sheet)
```javascript
const DISCOUNT_PERCENTAGES = [10, 25, 30, 35, 40, 50, 55, 60, 70, 80];
```

### 5.6 Interest rates (from Excel interest sheets)
```javascript
const INTEREST_RATES = {
  SPL:  [ { key: 'CCC', annualPct: 15 }, { key: 'DGL', annualPct: 25 } ],
  SPLX: [ { key: 'CCC', annualPct: 15 } ],
  BCL:  [ { key: 'DGL', annualPct: 25 }, { key: 'Nano', annualPct: 33 } ],
  SCL:  [ { key: 'DGL', annualPct: 25 }, { key: 'Nano', annualPct: 33 } ],
};
```

---

## 6. Formulas Reference

### Partial Payment offered amount
```
offerAmount = ceil(totalDue × zonePercentage / 100 / 100) × 100
             = roundUpTo100(totalDue × pct%)
```
Amounts are rounded **UP** to the nearest 100 THB (agent quotes exact rounded figure to customer).

### Discount calculator
```
ส่วนลดที่ได้รับ = round(totalDue × discountPct / 100)
ยอดชำระจริง    = ceil(totalDue × (1 − discountPct/100) / 100) × 100
```

### Interest calculator
```
ดอกเบี้ยต่อวัน = principal × annualRate% / 100 / 365
รวมดอกเบี้ย   = ดอกเบี้ยต่อวัน × numberOfDays
```

---

## 7. Data Flow

```
Agent opens popup
    │
    ▼
popup.js sends EXTRACT_DATA message
    │
    ▼
content.js scrapes DOM
  ├── extractUserInfo()   → creditUserId, name, shopeeUserId, agentEmail, caseId
  └── extractBillRows()   → array of bill objects (one per table row in Bill Info)
    │
    ▼
popup.js calls evaluate() from eligibility.js
  └── evaluatePartialPayment()
        ├── filter (remove Fully repayment, zero amount, unknown product)
        ├── group by productType
        └── per group: check eligibility → assign DPD zone → calc all zone amounts
    │
    ▼
popup.js renders 3 panels:
  ├── Partial Payment (eligibility + zone table with rounded offers)
  ├── Discount (table of 10 discount tiers per product)
  └── Interest calculator (interactive form per applicable product)
```

---

## 8. PII Rules — Must Never Change

These rules are non-negotiable:

| ✅ Captured | ❌ Never captured |
|---|---|
| creditUserId | National ID card number |
| name | Phone number |
| shopeeUserId | Customer email |
| agentEmail | Customer address |
| caseId | Any additional personal data |
| Bill summary fields | |

**Storage rules:**
- No data is persisted in `chrome.storage` or `localStorage`
- `WEB_APP_URL` lives only in `config.js` — never hardcoded elsewhere
- Extension only reads from the DC System page — it does not modify the page

---

## 9. Apps Script (Audit Log — Optional)

The `Code.gs` file is a Google Apps Script Web App. It is NOT required for the extension to work; it provides an optional audit trail in Google Sheets.

**To deploy:**
1. Open [script.google.com](https://script.google.com) → New project
2. Paste the contents of `Code.gs`
3. Replace `'YOUR_SPREADSHEET_ID_HERE'` with your Google Sheets ID
4. Deploy → New deployment → Web App:
   - Execute as: **Me**
   - Who has access: **Anyone with the link**
5. Copy the Web App URL → paste into `config.js` as `WEB_APP_URL`

**Apps Script is currently unused in Phase 1** (the "บันทึกข้อมูล" button was removed). The `sendToSheets()` function in `content.js` remains in place for future use.

---

## 10. Adding a New Tool (for Future Phases)

### Step 1 — Add the tool tab in `popup.html`
```html
<button class="tool-tab" data-tool="restructure">🔄 Restructure</button>
```
And add a panel:
```html
<div id="panel-restructure" class="tool-panel">
  <div class="section-label">🔄 Restructure</div>
  <div id="restructure-content"></div>
</div>
```

### Step 2 — Implement the logic in `eligibility.js`
Replace the stub:
```javascript
// [FUTURE PHASE — rules TBD]
function evaluateRestructure(billRows, config) {
  throw new Error('Restructure eligibility is not yet implemented.');
}
```
with the actual logic. Add any new config to `config.js`.

### Step 3 — Add the renderer in `popup.js`
```javascript
function renderRestructurePanel(result) {
  // ... build HTML and insert into #restructure-content
}
```
Call it from `renderResult()`.

### Step 4 — Add config in `config.js`
Add a `RESTRUCTURE_CONFIG` constant with `[CONFIGURABLE RULE]` comments.

---

## 11. Known DOM Selectors (as of Phase 1)

| Data | Selector |
|---|---|
| Agent email | `.name___2eduw` |
| Credit User ID | `label[for="userInfo_userId"]` → closest `.ant-form-item` → `.ant-form-item-control-input-content` |
| Customer name | Same pattern, `for="userInfo_userName"` |
| Shopee User ID | Same pattern, `for="userInfo_shopeeUserId"` |
| Bill Info tab | `[role="tab"]` where `textContent === 'Bill Info'` |
| Bill table | `<table>` that has `th` cells containing "Bill ID" and "Product Type" |
| Bill rows | `.ant-table-row` inside `[.ant-table-wrapper]` wrapping the Bill table |

> **Note:** The DC System uses Ant Design. Class names like `.ant-table-row` are stable across Ant Design versions but could change on major upgrades. If extraction breaks, inspect the page DOM and update the selectors in `content.js`.

**Bill Info tab requirement:** The extension does NOT auto-switch to the Bill Info tab. If the agent is on a different tab (Case Info, Repayment Info, etc.), the extension shows an instruction message asking them to switch first.

---

## 12. Continuing Development with Claude

When handing the project folder to a colleague using Claude Code:

1. **Open this folder** in Claude Code as the working directory
2. **Share context:** Paste this entire `HANDOFF.md` into the first message
3. **Reference the Excel file:** `Partial Payment Calculator.xlsx` contains all the source rules. Claude can read it with PowerShell COM automation if needed:
   ```powershell
   $excel = New-Object -ComObject Excel.Application
   $wb = $excel.Workbooks.Open("C:\...\Partial Payment Calculator.xlsx")
   $ws = $wb.Worksheets.Item("SheetName")
   # $ws.UsedRange.Cells(row, col).Text
   ```
4. **Claude model to use:** Claude Sonnet 4.6 or newer (the claude-sonnet-4-6 model ID)
5. **No build step needed** — just edit files and reload the extension in Chrome

### Useful prompts to give Claude:
- "Read HANDOFF.md to understand the project, then implement the Restructure tool based on the rules in [sheet name] of the Excel file."
- "Update the DPD thresholds in config.js — Green is now ≤20 days, Yellow is 21–60 days."
- "Add BCL to eligibleForPartial: true."

---

## 13. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Popup shows "กรุณา Refresh" | Extension was loaded after the page was already open | Refresh the DC System page, then open popup |
| Popup shows "Bill Info tab" message | Agent is not on the Bill Info tab | Click Bill Info tab in DC System first |
| Amounts look wrong | Zone table rules changed | Update `PARTIAL_ZONE_TABLE` in `config.js` |
| Extension icon missing | Not loaded in Chrome | Go to `chrome://extensions/` → Load unpacked |
| All bills show ineligible | New product type not in PRODUCT_CONFIG | Add it to `PRODUCT_CONFIG` in `config.js` |
| DOM extraction returns empty | DC System updated their HTML structure | Inspect page → update selectors in `content.js` |

---

## 14. Version History

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-05 | Initial build: Partial Payment tool, zone table, Google Sheets log |
| 1.1 | 2026-06 | Round-up offers to nearest 100; Discount tool; Interest calculator; removed auto Bill Info tab switch; refresh button; removed Restructure/Settlement from UI |
