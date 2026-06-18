// =============================================================================
// config.js — Central configuration for DC Collection Tool
// All business rules are marked [CONFIGURABLE RULE].
// Update this file on the host PC; agents do not need to reinstall.
// =============================================================================

// Google Apps Script Web App endpoint (deploy from Code.gs)
// [CONFIGURABLE RULE] — replace with your deployed Apps Script URL
const WEB_APP_URL         = 'https://script.google.com/a/macros/monee.com/s/AKfycbzGTo09Y8nVSP_yjurRuS9ikUzfF3gDIutyguBUho8LXwClrAfMFD5SwYaqrxISbfoZ/exec';
const EXCLUDE_WEB_APP_URL = 'https://script.google.com/a/macros/monee.com/s/AKfycbxUFOXnj_3QKPqYiMv6v4zc7ELdPe83Za7-wemcrp8xWpaqHbIlfgM-hsgZFCKkVZO1aA/exec';

// =============================================================================
// RESTRUCTURE LOAN (RL) CONFIG
// DPD > RL_DPD_THRESHOLD → พนักงานกรอกแบบฟอร์มให้ลูกค้า
// DPD ≤ RL_DPD_THRESHOLD → แนะนำลูกค้ากรอกเว็บฟอร์มเอง
// [CONFIGURABLE RULE] — อัปเดต threshold และ URL ให้ตรงกับนโยบาย
// =============================================================================
const RL_DPD_THRESHOLD = 61; // [CONFIGURABLE RULE]
const RL_STAFF_FORM_URL = ''; // [CONFIGURABLE RULE] URL แบบฟอร์มที่พนักงานกรอก (DPD > 61)
const RL_WEB_FORM_URL   = ''; // [CONFIGURABLE RULE] URL เว็บฟอร์มที่ลูกค้ากรอกเอง (DPD ≤ 61)

// =============================================================================
// PRODUCT CONFIG
// eligibleForPartial: derived from the Partial Payment Calculator.xlsx
// partialCalcParams: zone-percentage table is shared across products (see
//   PARTIAL_ZONE_TABLE below); product-level overrides can be added here.
// [CONFIGURABLE RULE] — update eligibleForPartial per product as rules change
// =============================================================================
const PRODUCT_CONFIG = {
  SPL: {
    label: 'SPL Digi',
    eligibleForPartial: true,       // [CONFIGURABLE RULE]
    eligibleForRestructure: null,   // [FUTURE PHASE]
    partialCalcParams: {},          // uses shared PARTIAL_ZONE_TABLE
    restructureCalcParams: null,    // [FUTURE PHASE]
  },
  SPLX: {
    label: 'SPLX CCC',
    eligibleForPartial: true,       // [CONFIGURABLE RULE]
    eligibleForRestructure: null,   // [FUTURE PHASE]
    partialCalcParams: {},
    restructureCalcParams: null,    // [FUTURE PHASE]
  },
  BCL: {
    label: 'PCL Nano',
    eligibleForPartial: true,       // [CONFIGURABLE RULE]
    pclRecommendation: true,        // แสดง note แนะนำ 50% ก่อนต่อรอง + ขั้นต่ำ 300 THB
    eligibleForRestructure: null,   // [FUTURE PHASE]
    partialCalcParams: {},
    restructureCalcParams: null,    // [FUTURE PHASE]
  },
  SCL: {
    label: 'SCL Nano',
    eligibleForPartial: false,      // [CONFIGURABLE RULE]
    eligibleForRestructure: null,   // [FUTURE PHASE]
    partialCalcParams: {},
    restructureCalcParams: null,    // [FUTURE PHASE]
  },
  TL: {
    label: 'Term Loan',
    eligibleForPartial: false,      // [CONFIGURABLE RULE]
    eligibleForRestructure: null,   // [FUTURE PHASE]
    partialCalcParams: {},
    restructureCalcParams: null,    // [FUTURE PHASE]
  },
  Fast: {
    label: 'Fast Escrow',
    eligibleForPartial: false,      // [CONFIGURABLE RULE]
    eligibleForRestructure: null,   // [FUTURE PHASE]
    partialCalcParams: {},
    restructureCalcParams: null,    // [FUTURE PHASE]
  },
  PCL: {
    label: 'PCL Digi',
    eligibleForPartial: true,       // [CONFIGURABLE RULE]
    pclRecommendation: true,        // แสดง note แนะนำ 50% ก่อนต่อรอง + ขั้นต่ำ 300 THB
    eligibleForRestructure: null,   // [FUTURE PHASE]
    partialCalcParams: {},
    restructureCalcParams: null,    // [FUTURE PHASE]
  },
};

// =============================================================================
// PARTIAL PAYMENT ZONE TABLE
// Source: "เงื่อนไข" sheet in Partial Payment Calculator.xlsx
//
// Structure: array of { minAmount, maxAmount, green, yellow, red }
//   - percentages are 0–100; null means "not eligible in this zone+tier"
//   - Ranges are INCLUSIVE of minAmount, EXCLUSIVE of maxAmount
//     (except the last row which is open-ended)
//
// [CONFIGURABLE RULE] — update tiers if the .xlsx conditions sheet changes
// =============================================================================
const PARTIAL_ZONE_TABLE = [
  // Amount 1,000 ≤ x < 3,000
  { minAmount: 1000,  maxAmount: 3000,  green: 50, yellow: 35, red: null },
  // Amount 3,000 ≤ x < 5,000
  { minAmount: 3000,  maxAmount: 5000,  green: 50, yellow: 35, red: 20   },
  // Amount 5,000 ≤ x < 7,500
  { minAmount: 5000,  maxAmount: 7500,  green: 50, yellow: 30, red: 15   },
  // Amount 7,500 ≤ x < 10,000
  { minAmount: 7500,  maxAmount: 10000, green: 50, yellow: 30, red: 15   },
  // Amount ≥ 10,000
  { minAmount: 10000, maxAmount: Infinity, green: 50, yellow: 30, red: 15 },
];

// [CONFIGURABLE RULE] — minimum total due to qualify for any partial offer
const PARTIAL_MIN_AMOUNT = 1000;

// [CONFIGURABLE RULE] — Red Zone requires at least this amount
const PARTIAL_RED_ZONE_MIN_AMOUNT = 3000;

// =============================================================================
// ZONE ASSIGNMENT BY DAYS PAST DUE (DPD)
// NOTE: DPD thresholds are NOT specified in the .xlsx file.
//       The values below are assumptions based on common Thai DC practice.
//       Verify with the business team and update as [CONFIGURABLE RULE].
// [CONFIGURABLE RULE] — confirm DPD cut-offs with the collections team
// =============================================================================
const DPD_ZONE_THRESHOLDS = {
  greenMax: 30,   // DPD 0–30   → Green Zone
  yellowMax: 90,  // DPD 31–90  → Yellow Zone
                  // DPD > 90   → Red Zone
};

// =============================================================================
// DISCOUNT CONFIG
// Source: "ส่วนลดปิดบัญชี WRO 3" sheet in Partial Payment Calculator.xlsx
//
// Formulas:
//   ส่วนลดที่ได้รับ = Math.round(totalDue × pct / 100)
//   ยอดชำระจริง    = Math.ceil(totalDue × (1 − pct/100) / 100) × 100
//
// [CONFIGURABLE RULE] — update discount percentages if policy changes
// =============================================================================
// DPD > DISCOUNT_DPD_THRESHOLD → แสดงตารางส่วนลด
// DPD ≤ DISCOUNT_DPD_THRESHOLD → แจ้งเตือน Waive ค่าติดตามทวงถามเท่านั้น
// [CONFIGURABLE RULE]
const DISCOUNT_DPD_THRESHOLD = 181;
const DISCOUNT_PERCENTAGES   = [30, 40, 45, 50, 55, 60, 65, 70]; // [CONFIGURABLE RULE]

// =============================================================================
// INTEREST RATES BY PRODUCT + VARIANT
// Source: "คำนวณดอกเบี้ย SPL" and "คำนวณดอกเบี้ย BCL & SCL" sheets
//
// Formula:
//   ดอกเบี้ยต่อวัน = principal × annualPct / 100 / 365
//   รวมดอกเบี้ย   = ดอกเบี้ยต่อวัน × numberOfDays
//
// [CONFIGURABLE RULE] — update if interest rates change
// =============================================================================
// =============================================================================
// PCL PARTIAL PAYMENT CONFIG
// PCL Digi ไม่ใช้ Zone Table เหมือน SPL — ใช้เงื่อนไขนี้แทน
//
// Rules:
//   - ลูกค้ากดชำระขั้นต่ำ 300 THB ขึ้นไป
//   - พนักงานพิจารณานำเสนอแผนนัดชำระได้
//   - ยิ่งนัดมาก ดอกเบี้ยยิ่งลด
//
// [CONFIGURABLE RULE] — ปรับ interestReductionPct ตามเงื่อนไขจริงจากทีม
// =============================================================================
const PCL_PARTIAL_CONFIG = {
  minAmount: 300, // [CONFIGURABLE RULE] ยอดขั้นต่ำที่ลูกค้าต้องชำระต่อนัด

  // ยอดที่แนะนำให้พนักงานนำเสนอก่อน (% ของยอดค้างรวม) เพื่อใช้ต่อรอง
  // ถ้าลูกค้าไม่ไหว ค่อยลดลงมาที่แผนนัดชำระ / ขั้นต่ำ 300 THB
  // [CONFIGURABLE RULE] — ปรับ % ได้ตามนโยบายทีม
  recommendedOfferPct: 50,

  // จำนวนนัดชำระ → % ดอกเบี้ยที่ลดได้ (ยิ่งนัดมาก ดอกเบี้ยยิ่งลด)
  // [CONFIGURABLE RULE] — อัปเดตตัวเลขให้ตรงกับนโยบายจริง
  installmentOptions: [
    { appointments: 1, interestReductionPct: 0  },
    { appointments: 2, interestReductionPct: 10 },
    { appointments: 3, interestReductionPct: 20 },
    { appointments: 4, interestReductionPct: 30 },
    { appointments: 5, interestReductionPct: 40 },
    { appointments: 6, interestReductionPct: 50 },
  ],
};

// =============================================================================
// INTEREST RATES BY PRODUCT + VARIANT
// Source: "คำนวณดอกเบี้ย SPL" and "คำนวณดอกเบี้ย BCL & SCL" sheets
//
// Formula:
//   ดอกเบี้ยต่อวัน = principal × annualPct / 100 / 365
//   รวมดอกเบี้ย   = ดอกเบี้ยต่อวัน × numberOfDays
//
// [CONFIGURABLE RULE] — update if interest rates change
// =============================================================================
const INTEREST_RATES = {
  SPL: [
    { key: 'CCC', label: 'CCC (15%/ปี)',  annualPct: 15 }, // [CONFIGURABLE RULE]
    { key: 'DGL', label: 'DGL (25%/ปี)',  annualPct: 25 }, // [CONFIGURABLE RULE]
  ],
  SPLX: [
    { key: 'CCC', label: 'CCC (15%/ปี)',  annualPct: 15 }, // [CONFIGURABLE RULE]
  ],
  BCL: [
    { key: 'DGL',  label: 'DGL (25%/ปี)',  annualPct: 25 }, // [CONFIGURABLE RULE]
    { key: 'Nano', label: 'Nano (33%/ปี)', annualPct: 33 }, // [CONFIGURABLE RULE]
  ],
  SCL: [
    { key: 'DGL',  label: 'DGL (25%/ปี)',  annualPct: 25 }, // [CONFIGURABLE RULE]
    { key: 'Nano', label: 'Nano (33%/ปี)', annualPct: 33 }, // [CONFIGURABLE RULE]
  ],
};
