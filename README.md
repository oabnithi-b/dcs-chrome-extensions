# DC Collection Tool — Chrome Extension

Phase 1: Partial Payment eligibility engine for DC agents.

---

## File Structure

```
DCs Extension/
├── manifest.json       MV3 extension manifest
├── config.js           All configurable rules & product config
├── eligibility.js      Pure logic engine (no DOM, no fetch)
├── content.js          DOM scraper + Sheets writer
├── popup.html          Extension popup UI
├── popup.js            UI orchestration
├── icons/              16×16, 48×48, 128×128 PNG icons (add your own)
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── Code.gs             Google Apps Script (deployed separately)
```

---

## 1 — Add Icons

Place three PNG files in the `icons/` folder:
- `icon16.png` — 16×16 px
- `icon48.png` — 48×48 px
- `icon128.png` — 128×128 px

Any simple icon works. You can generate them from a single image at
https://www.favicon.cc or any image editor.

---

## 2 — Deploy the Apps Script Web App

1. Open [Google Sheets](https://sheets.google.com) and create a new spreadsheet.
2. Copy the **Spreadsheet ID** from the URL:
   `https://docs.google.com/spreadsheets/d/**SPREADSHEET_ID**/edit`
3. Open **Extensions → Apps Script** in that sheet.
4. Delete the default `myFunction` and paste the contents of `Code.gs`.
5. At the top of `Code.gs`, replace:
   ```javascript
   const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE';
   ```
   with your actual Spreadsheet ID.
6. Click **Deploy → New deployment**.
   - Type: **Web App**
   - Execute as: **Me**
   - Who has access: **Anyone**
7. Click **Deploy** and copy the **Web App URL** shown.

---

## 3 — Configure the Extension

Open `config.js` and set:

```javascript
const WEB_APP_URL = 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec';
```

Replace with the URL you copied in step 2.7.

---

## 4 — Install the Extension (Developer Mode)

> **Important for centralized management**: Load the extension from a shared
> folder (e.g. a network drive or synced OneDrive/Google Drive folder).
> When the host PC updates `config.js` in that folder, agents only need to
> click **Update** in `chrome://extensions` — no reinstall required.

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked**.
4. Select the `DCs Extension` folder.
5. The "DC Collection Tool" extension icon appears in the toolbar.

---

## 5 — Usage

1. Open a case: `https://collections.scredit.in.th/main/case/detail/<caseId>`
2. Click the extension icon.
3. The popup extracts data and runs eligibility automatically.
4. Review the result (eligible products shown in green, ineligible in grey).
5. Click **📋 บันทึกข้อมูล** to write the audit row to Google Sheets.

---

## 6 — Google Sheets Output

Each click of "บันทึกข้อมูล" writes one row per eligible product to:
- An agent-specific tab (named by email prefix, e.g. `somchai`)
- A master log tab named **DR**

Columns written:

| Column | Description |
|---|---|
| Date | ISO timestamp of the check |
| Agent | Full agent email |
| Credit User ID | Case identifier |
| Name | Customer display name |
| Shopee ID | Shopee user ID |
| Case ID | URL case ID |
| Type | `Partial Payment` |
| Product | Product type code (e.g. `SPL`) |
| Label | Human label (e.g. `SPL Digi`) |
| Total Due | Sum of amountToPay for this product |
| Offered Amount | Calculated partial offer (THB) |
| Zone | `green` / `yellow` / `red` |
| Bill Count | Number of active bills |
| Max DPD | Maximum days past due |
| Earliest Due Date | Oldest bill due date |

---

## 7 — Updating Rules (Host PC)

All business rules live in `config.js`. Edit that file and agents will pick
up the changes the next time they click **Update** in `chrome://extensions`
(or Chrome auto-reloads unpacked extensions on file change if DevTools is open).

No redeployment of Apps Script is needed for rule changes.

---

## 8 — All [CONFIGURABLE RULE] Locations

| File | Location | What it controls |
|---|---|---|
| `config.js` | `WEB_APP_URL` | Apps Script endpoint |
| `config.js` | `PRODUCT_CONFIG[x].eligibleForPartial` | Whether each product type qualifies for Partial Payment |
| `config.js` | `PARTIAL_ZONE_TABLE` | Amount tiers and Green/Yellow/Red percentages (from เงื่อนไข sheet) |
| `config.js` | `PARTIAL_MIN_AMOUNT` | Minimum total due to qualify (default 1,000 THB) |
| `config.js` | `PARTIAL_RED_ZONE_MIN_AMOUNT` | Red Zone minimum (default 3,000 THB) |
| `config.js` | `DPD_ZONE_THRESHOLDS.greenMax` | Max DPD for Green Zone (default 30) |
| `config.js` | `DPD_ZONE_THRESHOLDS.yellowMax` | Max DPD for Yellow Zone (default 90); above = Red |
| `eligibility.js` | Step 1 filter | Bills excluded from consideration (Fully repayment, zero amount, unknown product) |
| `eligibility.js` | `assignZone()` | DPD → zone mapping logic |
| `eligibility.js` | `calcOfferAmounts()` | Percentage lookup and offer calculation |
| `Code.gs` | `SPREADSHEET_ID` | Target Google Spreadsheet |
| `Code.gs` | `MASTER_TAB` | Master log tab name (default `DR`) |
| `Code.gs` | `HEADERS` | Column order in Sheets |

---

## 9 — Adding a New Eligibility Type (Future Phases)

### Step 1 — Add product flags in `config.js`

```javascript
// In PRODUCT_CONFIG for each relevant product:
eligibleForRestructure: true,          // or false
restructureCalcParams: { /* ... */ },
```

Also add any new threshold constants at the bottom of `config.js`.

### Step 2 — Implement the stub in `eligibility.js`

```javascript
// Replace the stub:
function evaluateRestructure(billRows, config) {
  // 1. Filter active bills (same pattern as evaluatePartialPayment)
  // 2. Group by productType
  // 3. Apply restructure-specific rules from config
  // 4. Return same shape: { eligibilityType, timestamp, summary,
  //                         eligibleProducts, ineligibleProducts }
}
```

The output shape **must match** the existing shape so `popup.js` renders it
without modification.

### Step 3 — Call it from the popup

In `popup.js`, change the `evaluate()` call:

```javascript
result = evaluate(rawData.billRows, configObject, 'RESTRUCTURE');
```

Or add a tab/toggle in `popup.html` to switch between types.

### Step 4 — No changes needed to `content.js` or `Code.gs`

The DOM extraction and Sheets write are type-agnostic.
