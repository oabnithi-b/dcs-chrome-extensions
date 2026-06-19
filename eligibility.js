// =============================================================================
// eligibility.js — Pure logic engine (no DOM, no fetch)
// Input : raw bill rows array + PRODUCT_CONFIG (from config.js)
// Output: structured eligibility result object
// =============================================================================

// ---------------------------------------------------------------------------
// Public entry point — extensible for future types
// ---------------------------------------------------------------------------
function evaluate(billRows, config, type = 'PARTIAL_PAYMENT') {
  switch (type) {
    case 'PARTIAL_PAYMENT':
      return evaluatePartialPayment(billRows, config);
    case 'RESTRUCTURE':
      return evaluateRestructure(billRows, config); // [FUTURE PHASE]
    case 'FULL_SETTLEMENT':
      return evaluateFullSettlement(billRows, config); // [FUTURE PHASE]
    default:
      throw new Error('Unknown eligibility type: ' + type);
  }
}

// ---------------------------------------------------------------------------
// PARTIAL PAYMENT
// ---------------------------------------------------------------------------
function evaluatePartialPayment(billRows, config) {
  const productCfg  = config.PRODUCT_CONFIG;
  const zoneTable   = config.PARTIAL_ZONE_TABLE;
  const minAmount   = config.PARTIAL_MIN_AMOUNT;
  const redMinAmt   = config.PARTIAL_RED_ZONE_MIN_AMOUNT;
  const dpdZones    = config.DPD_ZONE_THRESHOLDS;
  const pclConfig   = config.PCL_PARTIAL_CONFIG;

  // ------------------------------------------------------------------
  // Step 1 — Filter out rows that cannot participate
  // [CONFIGURABLE RULE] — filter conditions
  // ------------------------------------------------------------------
  const activeBills = billRows.filter(b => {
    if (b.billStatus === 'Fully repayment') return false; // [CONFIGURABLE RULE]
    if (b.amountToPay === 0)                return false; // [CONFIGURABLE RULE]
    if (!productCfg[b.productType])         return false; // unknown product
    return true;
  });

  // ------------------------------------------------------------------
  // Step 2 — Group by productType
  // ------------------------------------------------------------------
  const groups = {};
  for (const bill of activeBills) {
    if (!groups[bill.productType]) {
      groups[bill.productType] = [];
    }
    groups[bill.productType].push(bill);
  }

  // ------------------------------------------------------------------
  // Step 3 & 4 & 5 — Per-product: aggregate → check eligibility → calc
  // ------------------------------------------------------------------
  const eligibleProducts   = [];
  const ineligibleProducts = [];

  for (const [productType, bills] of Object.entries(groups)) {
    const cfg       = productCfg[productType];
    const totalDue  = round2(bills.reduce((s, b) => s + b.amountToPay, 0));
    const billCount = bills.length;
    const maxDPD    = Math.max(...bills.map(b => b.daysPastDue));
    const earliestDueDate = bills
      .map(b => b.dueDate)
      .sort()[0]; // lexicographic sort works for YYYY-MM-DD

    // --- Eligibility check ---
    // [CONFIGURABLE RULE] — product-level flag
    if (!cfg.eligibleForPartial) {
      ineligibleProducts.push({
        productType,
        productLabel: cfg.label,
        reason: 'ผลิตภัณฑ์ไม่อยู่ในเงื่อนไข Partial Payment',
        totalDue,
      });
      continue;
    }

    // [CONFIGURABLE RULE] — minimum amount threshold
    if (totalDue < minAmount) {
      ineligibleProducts.push({
        productType,
        productLabel: cfg.label,
        reason: 'ยอดรวมต่ำกว่าขั้นต่ำ (' + minAmount.toLocaleString() + ' THB)',
        totalDue,
      });
      continue;
    }

    // --- Zone assignment from DPD ---
    const zone = assignZone(maxDPD, dpdZones);

    // --- Red Zone minimum check ---
    // [CONFIGURABLE RULE] — Red Zone requires 3,000 THB minimum
    if (zone === 'red' && totalDue < redMinAmt) {
      ineligibleProducts.push({
        productType,
        productLabel: cfg.label,
        reason: 'Red Zone ต้องมียอดขั้นต่ำ ' + redMinAmt.toLocaleString() + ' THB (ยอดปัจจุบัน ' + totalDue.toLocaleString() + ' THB)',
        totalDue,
      });
      continue;
    }

    // --- Calculate offered amounts for all applicable zones ---
    const offerAmounts = calcOfferAmounts(totalDue, zone, zoneTable);

    // No valid percentage found (e.g. Red Zone at 1,000–3,000 range)
    if (offerAmounts === null) {
      ineligibleProducts.push({
        productType,
        productLabel: cfg.label,
        reason: 'ยอดและ Zone ไม่ตรงเงื่อนไขใดๆ',
        totalDue,
      });
      continue;
    }

    // PCL products: คำนวณ recommended offer (50% ของยอดค้าง) เพื่อแนะนำพนักงานต่อรองก่อน
    // ยอดที่แนะนำให้พนักงานนำเสนอก่อน (% ของยอดค้างรวม) เพื่อใช้ต่อรอง
    // ถ้าลูกค้าไม่ไหว ค่อยลดลงมาที่แผนนัดชำระ / ขั้นต่ำ 300 THB
    const recPct           = pclConfig?.recommendedOfferPct ?? 50;
    const recommendedOffer = cfg.pclRecommendation
      ? roundUpTo100(totalDue * recPct / 100)
      : null;

    eligibleProducts.push({
      productType,
      productLabel: cfg.label,
      totalDue,
      zone,
      offeredAmounts: offerAmounts, // { green, yellow, red } — null if N/A
      offeredAmount: offerAmounts.primary, // primary offer for the assigned zone
      pclRecommendation:    cfg.pclRecommendation ?? false,
      recommendedOffer,             // null สำหรับ SPL/SPLX
      recommendedOfferPct:  cfg.pclRecommendation ? recPct : null,
      pclMinAmount:         cfg.pclRecommendation ? (pclConfig?.minAmount ?? 300) : null,
      billCount,
      maxDaysPastDue: maxDPD,
      earliestDueDate,
      bills,
    });
  }

  // ------------------------------------------------------------------
  // Step 6 — Build output
  // allActiveGroups is used by the Discount and Interest calculator tools
  // ------------------------------------------------------------------
  const allActiveGroups = Object.entries(groups).map(([pt, bills]) => {
    const cfg = productCfg[pt];
    return {
      productType:    pt,
      productLabel:   cfg?.label ?? pt,
      totalDue:       round2(bills.reduce((s, b) => s + b.amountToPay, 0)),
      maxDaysPastDue: Math.max(...bills.map(b => b.daysPastDue)),
      billCount:      bills.length,
      bills,
    };
  });

  return {
    eligibilityType: 'Partial Payment',
    timestamp: new Date().toISOString(),
    summary: {
      totalProducts:       Object.keys(groups).length,
      eligibleCount:       eligibleProducts.length,
      ineligibleCount:     ineligibleProducts.length,
      notEligibleProducts: ineligibleProducts.map(p => p.productLabel),
    },
    eligibleProducts,
    ineligibleProducts,
    allActiveGroups,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Assign zone label based on maxDaysPastDue
// [CONFIGURABLE RULE] — DPD thresholds come from DPD_ZONE_THRESHOLDS in config
function assignZone(maxDPD, dpdZones) {
  if (maxDPD <= dpdZones.greenMax)  return 'green';
  if (maxDPD <= dpdZones.yellowMax) return 'yellow';
  return 'red';
}

// Look up zone percentages from PARTIAL_ZONE_TABLE and return offer amounts.
// Always returns amounts for ALL three zones (null where not eligible).
// "primary" is the amount for the *assigned* zone of this product.
// Amounts are rounded UP to the nearest 100 THB for agent quoting.
// [CONFIGURABLE RULE] — percentage table is PARTIAL_ZONE_TABLE in config
function calcOfferAmounts(totalDue, zone, zoneTable) {
  const row = zoneTable.find(
    r => totalDue >= r.minAmount && totalDue < r.maxAmount
  );
  if (!row) return null;

  const pct = row[zone]; // null if zone not eligible for this tier
  if (pct === null) return null;

  // Exact amount for internal reference; offer = rounded UP to nearest 100
  const makeOffer = (p) => p !== null ? roundUpTo100(totalDue * p / 100) : null;

  return {
    primary:        makeOffer(pct),
    percentageUsed: pct,
    // All three zone amounts + their percentages for the UI table
    green:          makeOffer(row.green),
    greenPct:       row.green,   // null if not available for this tier
    yellow:         makeOffer(row.yellow),
    yellowPct:      row.yellow,
    red:            makeOffer(row.red),
    redPct:         row.red,
  };
}

// Rounds n UP to the nearest 100. Used for all agent-facing offer amounts.
// e.g. 4,075.95 → 4,100 | 2,445.57 → 2,500 | 1,222.79 → 1,300
function roundUpTo100(n) {
  if (n === null || n === undefined) return null;
  return Math.ceil(n / 100) * 100;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// DISCOUNT CALCULATOR
// Source: "ส่วนลดปิดบัญชี WRO 3" sheet
// Returns an array of rows, one per discount percentage tier.
// ---------------------------------------------------------------------------
function calculateDiscount(totalDue, percentages) {
  return percentages.map(pct => ({
    pct,
    discountAmt: Math.round(totalDue * pct / 100),
    actualAmt:   Math.ceil(totalDue * (1 - pct / 100) / 100) * 100,
  }));
}

// ---------------------------------------------------------------------------
// INTEREST CALCULATOR
// Source: "คำนวณดอกเบี้ย SPL" and "คำนวณดอกเบี้ย BCL & SCL" sheets
// Formula: dailyInterest = principal × annualPct / 100 / 365
// ---------------------------------------------------------------------------
function calculateInterest(principal, days, annualPct) {
  const dailyRate = principal * annualPct / 100 / 365; // exact, unrounded
  const dailyAmt  = round2(dailyRate);                 // display: 2 decimal places
  const totalAmt  = round2(dailyRate * days);          // use exact rate to avoid compounding rounding error
  return { dailyAmt, totalAmt };
}

// ---------------------------------------------------------------------------
// FUTURE PHASE stubs
// ---------------------------------------------------------------------------

// [FUTURE PHASE — rules TBD]
function evaluateRestructure(billRows, config) {
  throw new Error('Restructure eligibility is not yet implemented.');
}

// [FUTURE PHASE — rules TBD]
function evaluateFullSettlement(billRows, config) {
  throw new Error('Full Settlement eligibility is not yet implemented.');
}
