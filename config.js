// =============================================================================
// config.js — Central configuration for DC Collection Tool
// All business rules are marked [CONFIGURABLE RULE].
// Update this file on the host PC; agents do not need to reinstall.
// =============================================================================

// Google Apps Script Web App endpoint (deploy from Code.gs)
// [CONFIGURABLE RULE] — replace with your deployed Apps Script URL
const WEB_APP_URL         = 'https://script.google.com/a/macros/monee.com/s/AKfycbzGTo09Y8nVSP_yjurRuS9ikUzfF3gDIutyguBUho8LXwClrAfMFD5SwYaqrxISbfoZ/exec';
const EXCLUDE_WEB_APP_URL = 'https://script.google.com/a/macros/monee.com/s/AKfycbxUFOXnj_3QKPqYiMv6v4zc7ELdPe83Za7-wemcrp8xWpaqHbIlfgM-hsgZFCKkVZO1aA/exec';
const PHONE_WEB_APP_URL   = 'https://script.google.com/a/macros/monee.com/s/AKfycbyaAsIBtH93M-lT8oMjBWsDFjP1BTkofr2qx_Zv7jbvxFC8hpNWaJtLZuqn3y5qUYS9QQ/exec';
const SMS_WEB_APP_URL     = 'https://script.google.com/a/macros/monee.com/s/AKfycbxpue9i80KYyJ3OroEN5hVPR_cUgn2eAOpz5UCKBLzUiFqbEzN_UzYTaRack3i08iMo/exec';

// =============================================================================
// RESTRUCTURE LOAN (RL) CONFIG
// DPD > RL_DPD_THRESHOLD → พนักงานกรอกแบบฟอร์มให้ลูกค้า
// DPD ≤ RL_DPD_THRESHOLD → แนะนำลูกค้ากรอกเว็บฟอร์มเอง
// [CONFIGURABLE RULE] — อัปเดต threshold และ URL ให้ตรงกับนโยบาย
// =============================================================================
const RL_DPD_THRESHOLD = 61; // [CONFIGURABLE RULE]
const RL_STAFF_FORM_URL = ''; // [CONFIGURABLE RULE] URL แบบฟอร์มที่พนักงานกรอก (DPD > 61)
const RL_WEB_FORM_URL   = ''; // [CONFIGURABLE RULE] URL เว็บฟอร์มที่ลูกค้ากรอกเอง (DPD ≤ 61)

// Product ที่ลูกค้าต้องกรอกเว็บฟอร์มเอง เสมอ (ไม่ว่า DPD จะเท่าไร)
// รวม 'SPL' (fallback เมื่อแยก variant ไม่ได้) ไว้ด้วยเพื่อความปลอดภัย
// [CONFIGURABLE RULE]
const RL_ALWAYS_WEB_FORM_PRODUCTS = ['SPL', 'SPL CCC', 'SPLX'];

// =============================================================================
// BILL DETAILS SECTION HEADER → PRODUCT TYPE MAP
// content.js จะอ่าน section header ใน Bill Details เพื่อแยก variant ที่ใช้
// productType code เดียวกันในตาราง (เช่น SPL CCC vs SPL Digi ทั้งคู่ = "SPL")
// ค่าต้องตรงกับ key ใน PRODUCT_CONFIG ด้านล่าง
// [CONFIGURABLE RULE] — อัปเดตเมื่อพบ section header รูปแบบใหม่
// =============================================================================
const SECTION_HEADER_PRODUCT_MAP = {
  // key = ข้อความที่ปรากฏใน Bill Details section header (ก่อน "Company:"/"บริษัท:")
  // value = PRODUCT_CONFIG key ที่ต้องการ map ไป (ต้องตรงกับ key ข้างบน)
  // [CONFIGURABLE RULE] — longest-key-wins ถ้า key ซ้อนทับกัน

  // ── English UI ──
  'ShopeePayLater Extra':    'SPLX',           // "ShopeePayLater Extra CCC" → SPLX
  'ShopeePayLater Digi':     'SPL Digi',
  'ShopeePayLater CCC':      'SPL CCC',
  'Buyer Cash Loan Digi':    'PCL Digi',
  'Buyer Cash Loan Nano':    'PCL Nano',
  'Seller Cash Loan P-loan': 'SCL P-loan',
  'Seller Cash Loan Nano':   'SCL Nano',

  // ── Thai UI (ชื่อสินเชื่อภาษาไทย) ──
  // ShopeePayLater ยังคงเป็น English แม้ UI เป็นไทย (ชื่อแบรนด์)
  'สินเชื่อเงินสดสำหรับผู้ซื้อ Digi':   'PCL Digi',   // Buyer Cash Loan Digi
  'สินเชื่อเงินสดสำหรับผู้ซื้อ Nano':   'PCL Nano',   // Buyer Cash Loan Nano
  'สินเชื่อเงินสดสำหรับผู้ขาย P-loan':  'SCL P-loan', // Seller Cash Loan P-loan
  'สินเชื่อเงินสดสำหรับผู้ขาย Nano':    'SCL Nano',   // Seller Cash Loan Nano
};

// =============================================================================
// PRODUCT CONFIG
// eligibleForPartial: derived from the Partial Payment Calculator.xlsx
// partialCalcParams: zone-percentage table is shared across products (see
//   PARTIAL_ZONE_TABLE below); product-level overrides can be added here.
// [CONFIGURABLE RULE] — update eligibleForPartial per product as rules change
// =============================================================================
const PRODUCT_CONFIG = {
  // ==========================================================================
  // REFINED codes — ใช้เมื่อ content.js อ่าน Bill Details section header ได้
  // SECTION_HEADER_PRODUCT_MAP จะ map generic code → refined code เหล่านี้
  // ==========================================================================
  'SPL CCC': {
    label: 'SPL CCC',
    eligibleForPartial: true,
    eligibleForRestructure: null,
    partialCalcParams: {},
    restructureCalcParams: null,
  },
  'SPL Digi': {
    label: 'SPL Digi',
    eligibleForPartial: true,
    eligibleForRestructure: null,
    partialCalcParams: {},
    restructureCalcParams: null,
  },
  'SPLX': {
    label: 'SPLX CCC',
    eligibleForPartial: true,
    eligibleForRestructure: null,
    partialCalcParams: {},
    restructureCalcParams: null,
  },
  'PCL Digi': {
    label: 'PCL Digi',
    eligibleForPartial: true,
    pclRecommendation: true,
    eligibleForRestructure: null,
    partialCalcParams: {},
    restructureCalcParams: null,
  },
  'PCL Nano': {
    label: 'PCL Nano',
    eligibleForPartial: true,
    pclRecommendation: true,
    eligibleForRestructure: null,
    partialCalcParams: {},
    restructureCalcParams: null,
  },
  'SCL Nano': {
    label: 'SCL Nano',
    eligibleForPartial: false,
    eligibleForRestructure: null,
    partialCalcParams: {},
    restructureCalcParams: null,
  },
  'SCL P-loan': {
    label: 'SCL P-loan',
    eligibleForPartial: false,
    eligibleForRestructure: null,
    partialCalcParams: {},
    restructureCalcParams: null,
  },
  'TL': {
    label: 'Term Loan',
    eligibleForPartial: false,
    eligibleForRestructure: null,
    partialCalcParams: {},
    restructureCalcParams: null,
  },
  'Fast': {
    label: 'Fast Escrow',
    eligibleForPartial: false,
    eligibleForRestructure: null,
    partialCalcParams: {},
    restructureCalcParams: null,
  },

  // ==========================================================================
  // GENERIC FALLBACKS — ใช้เมื่อ section header detection ล้มเหลว
  // (Bill Details ยังไม่โหลด / DOM structure เปลี่ยน / มี conflict)
  // key ตรงกับ Product column ในตาราง Bill Summary (SPL, BCL, SCL, PCL)
  // [CONFIGURABLE RULE] — ห้ามลบ ไม่อย่างนั้น bill จะหายจากทุก tab
  // ==========================================================================
  'SPL': {
    label: 'SPL',                   // generic — แสดงถ้าแยก CCC/Digi ไม่ได้
    eligibleForPartial: true,
    eligibleForRestructure: null,
    partialCalcParams: {},
    restructureCalcParams: null,
  },
  'BCL': {
    label: 'BCL',                   // generic — แสดงถ้าแยก Nano/Digi ไม่ได้
    eligibleForPartial: true,
    pclRecommendation: true,
    eligibleForRestructure: null,
    partialCalcParams: {},
    restructureCalcParams: null,
  },
  'SCL': {
    label: 'SCL',                   // generic — แสดงถ้าแยก Nano/P-loan ไม่ได้
    eligibleForPartial: false,
    eligibleForRestructure: null,
    partialCalcParams: {},
    restructureCalcParams: null,
  },
  'PCL': {
    label: 'PCL',                   // generic fallback (ถ้า DC system ใช้ code นี้)
    eligibleForPartial: true,
    pclRecommendation: true,
    eligibleForRestructure: null,
    partialCalcParams: {},
    restructureCalcParams: null,
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
// DISCOUNT CONFIG (M-based)
// M = ceil(DPD / 30)  เช่น DPD 160 → 160/30 = 5.33 → M6
//
// Formulas:
//   ส่วนลดที่ได้รับ = Math.round(totalDue × pct / 100)
//   ยอดชำระจริง    = Math.ceil(totalDue × (1 − pct/100) / 100) × 100
//
// สินเชื่อที่แสดงในแท็บ Discount (productType key ใน PRODUCT_CONFIG)
// [CONFIGURABLE RULE]
// =============================================================================
const DISCOUNT_ELIGIBLE_PRODUCTS = [
  // Refined codes (เมื่อ section header detection ทำงานสำเร็จ)
  'SPL CCC', 'SPL Digi', 'PCL Nano', 'PCL Digi', 'SCL Nano',
  // Generic fallbacks (เมื่อ detection ล้มเหลว)
  'SPL', 'BCL', 'SCL',
];

// ตารางส่วนลดสูงสุดตาม M — สำหรับ SPL CCC / SPL Digi / PCL Nano / PCL Digi
// [CONFIGURABLE RULE] — อัปเดตเมื่อนโยบายเปลี่ยน
const DISCOUNT_TIERS_SPL_PCL = [
  { minM: 7,  maxM: 12,       maxPct: 40 },
  { minM: 13, maxM: 18,       maxPct: 50 },
  { minM: 19, maxM: 24,       maxPct: 55 },
  { minM: 25, maxM: 36,       maxPct: 60 },
  { minM: 37, maxM: Infinity, maxPct: 70 },
];

// ตารางส่วนลดสูงสุดตาม M — สำหรับ SCL Nano
// [CONFIGURABLE RULE] — อัปเดตเมื่อนโยบายเปลี่ยน
const DISCOUNT_TIERS_SCL = [
  { minM: 7,  maxM: 12,       maxPct: 15 },
  { minM: 13, maxM: 18,       maxPct: 20 },
  { minM: 19, maxM: 24,       maxPct: 25 },
  { minM: 25, maxM: Infinity, maxPct: 30 },
];

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
  // ── Generic fallbacks (เมื่อ refinement ไม่สำเร็จ) ──────────────────────────
  'SPL':  [{ label: 'CCC (15%/ปี)',  annualPct: 15 },
           { label: 'DGL (25%/ปี)',  annualPct: 25 }],  // [CONFIGURABLE RULE]
  'SPLX': [{ label: 'CCC (15%/ปี)',  annualPct: 15 }],  // [CONFIGURABLE RULE]
  'BCL':  [{ label: 'DGL (25%/ปี)',  annualPct: 25 },
           { label: 'Nano (33%/ปี)', annualPct: 33 }],  // [CONFIGURABLE RULE]
  'SCL':  [{ label: 'DGL (25%/ปี)',  annualPct: 25 },
           { label: 'Nano (33%/ปี)', annualPct: 33 }],  // [CONFIGURABLE RULE]

  // ── Refined keys (หลัง buildSectionHeaderMap แยก variant ได้) ───────────────
  'SPL CCC':    [{ label: 'CCC (15%/ปี)',  annualPct: 15 }],  // [CONFIGURABLE RULE]
  'SPL Digi':   [{ label: 'DGL (25%/ปี)',  annualPct: 25 }],  // [CONFIGURABLE RULE]
  'SPLX':       [{ label: 'CCC (15%/ปี)',  annualPct: 15 }],  // [CONFIGURABLE RULE]
  'PCL Digi':   [{ label: 'DGL (25%/ปี)',  annualPct: 25 }],  // [CONFIGURABLE RULE]
  'PCL Nano':   [{ label: 'Nano (33%/ปี)', annualPct: 33 }],  // [CONFIGURABLE RULE]
  'SCL P-loan': [{ label: 'P-loan (25%/ปี)', annualPct: 25 }], // [CONFIGURABLE RULE]
  'SCL Nano':   [{ label: 'Nano (33%/ปี)', annualPct: 33 }],  // [CONFIGURABLE RULE]
};
