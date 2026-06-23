import prisma from "./prisma.js";

/**
 * PearQuote Estimation Policy Layer
 *
 * This file defines the "estimation policy" for PearQuote — not an accurate cost database.
 * Its purpose is to make AI quotes:
 *   1. Consistent:    same module type → same starting logic every time
 *   2. Explainable:   hours broken down by role (PM / UI/UX / Frontend / Backend / QA / DevOps)
 *   3. Adjustable:    calibrate with real project data over time
 *   4. Commercially controlled: billingRates and internalRate managed separately
 *   5. Transparent about uncertainty: via assumptions, missingInfo, confidenceScore
 *
 * Estimation pipeline:
 *   Requirements
 *   → AI maps to modules
 *   → apply baselineHours
 *   → apply complexityMultiplier
 *   → apply riskBuffer
 *   → compute hours range
 *   → apply billingRates
 *   → output: price range + assumptions + risk notes
 */

/**
 * Complexity multipliers applied in code (not by AI).
 * Supports simple/standard/complex (preferred) and low/medium/high (AI output).
 */
export const COMPLEXITY_MULTIPLIERS = {
  simple: 0.75,   low: 0.75,
  standard: 1.0,  medium: 1.0,
  complex: 1.4,   high: 1.4,
  unknown: 1.0,
};

/**
 * Project-level overhead multipliers applied to the aggregate total.
 * Accounts for PM coordination, cross-team communication, and QA regression overhead.
 */
export const PROJECT_TYPE_MULTIPLIERS = {
  landing:    1.0,
  website:    1.05,
  webapp:     1.1,
  saas:       1.2,
  mobile:     1.25,
  enterprise: 1.35,
  unknown:    1.1,
};

/**
 * Default billing rates (TWD/hr) — what you charge the client.
 * internalRate is optional and used only for internal margin reference; never shown to clients.
 *
 * TODO: Owner should adjust to match actual team structure and market positioning.
 */
export const DEFAULT_BILLING_RATES = {
  pm:       { billingRate: 1200, internalRate: 820  },
  uiux:     { billingRate: 1400, internalRate: 950  },
  frontend: { billingRate: 1400, internalRate: 950  },
  backend:  { billingRate: 1550, internalRate: 1050 },
  qa:       { billingRate: 1100, internalRate: 750  },
  devops:   { billingRate: 1700, internalRate: 1150 },
};

/** Target gross margin range (used for internal reference, not enforced). */
export const DEFAULT_MARGIN_TARGET = { min: 0.30, max: 0.45 };

/**
 * Baseline module library for Taiwan SME / B2B custom software market.
 *
 * baselineHours: { role: { min, max } } at "standard" complexity.
 * All numbers represent reference work hours in a standard project context.
 * Actual hours vary with requirement clarity, team familiarity, client responsiveness,
 * material completeness, and scope changes.
 *
 * riskBuffer (0–1): additional hours buffer for integration risk or ambiguity.
 * defaultComplexity: fallback if AI cannot determine complexity from requirements.
 * confidence: how reliable this baseline is as a starting point.
 * assumptions: what must be true for this estimate to hold.
 * exclusions: what is NOT included — scope items that need separate quotes.
 * missingInfo: what information gaps would most reduce estimation accuracy.
 */
export const DEFAULT_BASELINES = [
  // ─── 官網 / 企業網站（分層，依需求複雜度選擇） ─────────────────────────────────
  {
    baselineKey: "landing_page_simple",
    name: "簡易形象頁（單頁 Landing Page）",
    description: "單頁品牌形象或活動頁，RWD，無後端 API，無 CMS",
    defaultComplexity: "simple",
    confidence: "high",
    baselineHours: {
      pm:       { min: 2,  max: 4  },
      uiux:     { min: 8,  max: 16 },
      frontend: { min: 16, max: 28 },
      backend:  { min: 0,  max: 0  },
      qa:       { min: 4,  max: 6  },
      devops:   { min: 3,  max: 4  },
    },
    assumptions: ["Vercel/Netlify 靜態部署", "設計師出稿，非客戶提供"],
    exclusions: ["多語系", "會員登入", "CMS", "後台管理"],
    missingInfo: ["頁面區塊數量", "是否需要動畫效果", "是否客戶自行提供設計稿"],
  },
  {
    baselineKey: "corporate_site_static",
    name: "多頁企業官網（靜態，無 CMS）",
    description: "5–10 頁企業網站，內容寫死或由前端設定，含基本聯絡表單，無後台管理",
    defaultComplexity: "standard",
    confidence: "high",
    baselineHours: {
      pm:       { min: 4,  max: 8  },
      uiux:     { min: 18, max: 32 },
      frontend: { min: 44, max: 70 },
      backend:  { min: 6,  max: 10 },
      qa:       { min: 8,  max: 16 },
      devops:   { min: 4,  max: 8  },
    },
    assumptions: ["內容由團隊硬編碼或 JSON 設定", "含聯絡表單寄送基本通知", "SEO meta 設定"],
    exclusions: ["客戶自行更新內容", "CMS 後台", "多語系", "部落格功能"],
    missingInfo: ["頁面數量", "是否需要多語系", "是否需要客戶自行維護內容（若是，請改用 corporate_site_with_cms）"],
  },
  {
    baselineKey: "corporate_site_with_cms",
    name: "企業官網 + CMS 後台",
    description: "企業網站搭配自建 CMS，客戶可自行新增/修改文章、頁面、圖片，含基本 admin 後台",
    defaultComplexity: "standard",
    confidence: "high",
    baselineHours: {
      pm:       { min: 8,  max: 14 },
      uiux:     { min: 28, max: 48 },
      frontend: { min: 68, max: 100},
      backend:  { min: 32, max: 56 },
      qa:       { min: 18, max: 32 },
      devops:   { min: 8,  max: 14 },
    },
    assumptions: ["單一語系", "文章/頁面/媒體三種內容類型", "後台需 email 登入"],
    exclusions: ["多語系", "版本回溯", "多人協作審核流程", "行銷 Email 系統"],
    missingInfo: ["內容類型數量與欄位", "是否需要排程發布", "是否有多人協作需求"],
  },
  {
    baselineKey: "corporate_site_advanced",
    name: "進階企業官網（CMS + 多語系 + SEO + 通知 + 完整部署）",
    description: "完整企業網站，含 CMS 後台、多語系切換、SEO 深度設定、表單通知、CI/CD 部署，適合需要長期維護的官網",
    defaultComplexity: "standard",
    confidence: "medium",
    baselineHours: {
      pm:       { min: 12, max: 22 },
      uiux:     { min: 44, max: 68 },
      frontend: { min: 100, max: 148 },
      backend:  { min: 50, max: 80 },
      qa:       { min: 28, max: 48 },
      devops:   { min: 16, max: 24 },
    },
    assumptions: ["2 種語系（中英）", "CMS 含多內容類型", "SendGrid/SES 通知", "CI/CD + staging 環境"],
    exclusions: ["電商", "會員系統", "三種以上語系（需另估）"],
    missingInfo: ["語系數量", "CMS 內容類型與欄位複雜度", "是否需要 sitemap 自動產生", "通知類型與數量"],
  },

  // ─── 舊版官網 baseline（@deprecated，保留供歷史 snapshot 使用，AI prompt 不顯示） ──
  {
    baselineKey: "landing_page",
    deprecated: true,
    name: "形象官網 / Landing Page",
    description: "品牌形象頁或活動登陸頁，RWD，純前端，無自訂後端 API",
    defaultComplexity: "simple",
    confidence: "high",
    baselineHours: {
      pm:       { min: 2,  max: 4  },
      uiux:     { min: 8,  max: 16 },
      frontend: { min: 16, max: 28 },
      backend:  { min: 0,  max: 0  },
      qa:       { min: 4,  max: 6  },
      devops:   { min: 3,  max: 4  },
    },
    assumptions: ["使用 Vercel/Netlify 等靜態部署", "設計稿由設計師產出，非客戶提供"],
    exclusions: ["多語系", "會員登入", "自訂後台", "CMS 串接"],
    missingInfo: ["是否需要動畫或互動效果（影響 frontend）", "頁數與區塊數量", "是否客戶自行提供設計稿"],
  },
  {
    baselineKey: "multi_page_website",
    deprecated: true,
    name: "多頁式企業官網",
    description: "8–15 頁企業網站，含聯絡表單、部落格或 CMS 串接",
    defaultComplexity: "standard",
    confidence: "high",
    baselineHours: {
      pm:       { min: 4,  max: 8  },
      uiux:     { min: 16, max: 24 },
      frontend: { min: 24, max: 40 },
      backend:  { min: 6,  max: 12 },
      qa:       { min: 6,  max: 10 },
      devops:   { min: 4,  max: 6  },
    },
    assumptions: ["含聯絡表單 email 通知", "SEO 基礎設定", "使用 headless CMS 或靜態部署"],
    exclusions: ["會員系統", "電商功能", "客製化後台"],
    missingInfo: ["頁面數量與複雜度", "是否需要多語系", "是否需要後台讓客戶自行更新內容"],
  },
  {
    baselineKey: "cms_backend",
    name: "CMS 後台內容管理",
    description: "內容類型管理、富文字編輯器、圖片上傳、發布/草稿狀態",
    defaultComplexity: "standard",
    confidence: "high",
    baselineHours: {
      pm:       { min: 4,  max: 8  },
      uiux:     { min: 8,  max: 14 },
      frontend: { min: 16, max: 24 },
      backend:  { min: 20, max: 32 },
      qa:       { min: 8,  max: 12 },
      devops:   { min: 4,  max: 6  },
    },
    assumptions: ["單一內容類型", "基本富文字編輯（如 TipTap）"],
    exclusions: ["多語系", "版本歷史與回溯", "多層審核工作流程"],
    missingInfo: ["內容類型的數量與欄位複雜度", "是否需要排程發布", "是否需要多人協作與審核"],
  },
  {
    baselineKey: "auth_standard",
    name: "會員系統（Email / 手機登入）",
    description: "Email 或手機號碼登入、JWT session、密碼重設、Email 驗證",
    defaultComplexity: "standard",
    confidence: "high",
    baselineHours: {
      pm:       { min: 4,  max: 6  },
      uiux:     { min: 6,  max: 10 },
      frontend: { min: 12, max: 20 },
      backend:  { min: 16, max: 24 },
      qa:       { min: 8,  max: 12 },
      devops:   { min: 2,  max: 4  },
    },
    assumptions: ["單一登入方式", "JWT + Refresh Token", "基本帳號管理"],
    exclusions: ["第三方社群登入（另計）", "2FA / MFA", "SSO / SAML"],
    missingInfo: ["是否需要手機 OTP 登入", "是否需要管理員強制登出功能", "Session 有效期限需求"],
  },
  {
    baselineKey: "auth_social",
    name: "第三方社群登入（Google / LINE / Facebook）",
    description: "OAuth2 流程串接，含帳號綁定與衝突處理（以一個 provider 為準）",
    defaultComplexity: "standard",
    confidence: "high",
    riskBuffer: 0.15,
    baselineHours: {
      pm:       { min: 2,  max: 3  },
      uiux:     { min: 3,  max: 6  },
      frontend: { min: 6,  max: 10 },
      backend:  { min: 10, max: 16 },
      qa:       { min: 4,  max: 8  },
      devops:   { min: 2,  max: 3  },
    },
    assumptions: ["以 1 個 provider 為基準", "使用官方 OAuth2 SDK"],
    exclusions: ["每增加一個 provider 需再加 50% 工時"],
    missingInfo: ["需串接幾個 provider", "是否需要與現有帳號綁定/合併的邏輯"],
  },
  {
    baselineKey: "rbac",
    name: "角色權限管理（RBAC）",
    description: "角色定義、權限矩陣、API 和路由層防護，支援多角色",
    defaultComplexity: "standard",
    confidence: "medium",
    baselineHours: {
      pm:       { min: 4,  max: 8  },
      uiux:     { min: 6,  max: 10 },
      frontend: { min: 12, max: 20 },
      backend:  { min: 16, max: 28 },
      qa:       { min: 10, max: 16 },
      devops:   { min: 2,  max: 4  },
    },
    assumptions: ["3 個以內角色", "靜態行列式權限矩陣"],
    exclusions: ["動態權限 UI 設定介面", "超過 5 個角色", "資源層級細粒度權限"],
    missingInfo: ["角色數量與各角色的差異性", "是否需要管理員在後台動態調整權限", "是否有資源層級的行列控制需求"],
  },
  {
    baselineKey: "crud_module",
    name: "標準 CRUD 模組（單一資料實體）",
    description: "列表、新增、編輯、刪除、搜尋、分頁——以一個資料實體為計算單位",
    defaultComplexity: "simple",
    confidence: "high",
    baselineHours: {
      pm:       { min: 3,  max: 5  },
      uiux:     { min: 4,  max: 8  },
      frontend: { min: 10, max: 16 },
      backend:  { min: 10, max: 16 },
      qa:       { min: 4,  max: 8  },
      devops:   { min: 2,  max: 2  },
    },
    assumptions: ["單一資料實體", "基本篩選和排序", "無複雜關聯"],
    exclusions: ["複雜多表關聯查詢", "批次操作", "軟刪除需額外 2–4hr backend"],
    missingInfo: ["欄位數量與型別", "關聯資料的深度", "是否需要匯出功能"],
  },
  {
    baselineKey: "dashboard_analytics",
    name: "Dashboard / 圖表統計",
    description: "統計指標卡、折線/長條/圓餅圖、日期範圍篩選，選配資料匯出",
    defaultComplexity: "standard",
    confidence: "medium",
    baselineHours: {
      pm:       { min: 4,  max: 6  },
      uiux:     { min: 8,  max: 14 },
      frontend: { min: 16, max: 28 },
      backend:  { min: 12, max: 20 },
      qa:       { min: 6,  max: 10 },
      devops:   { min: 2,  max: 3  },
    },
    assumptions: ["使用現成圖表庫（Recharts / ECharts）", "資料已存在 DB 可直接查詢"],
    exclusions: ["即時更新（WebSocket）", "自訂報表產生器", "資料倉儲整合"],
    missingInfo: ["圖表類型與數量", "資料來源是否需要跨系統聚合", "是否需要鑽取（drill-down）功能"],
  },
  {
    baselineKey: "file_upload",
    name: "檔案上傳 / 圖片管理",
    description: "圖片 / 文件上傳至 S3 / GCS，含壓縮、預覽、刪除",
    defaultComplexity: "simple",
    confidence: "high",
    baselineHours: {
      pm:       { min: 2,  max: 3  },
      uiux:     { min: 3,  max: 6  },
      frontend: { min: 6,  max: 10 },
      backend:  { min: 10, max: 16 },
      qa:       { min: 4,  max: 6  },
      devops:   { min: 2,  max: 3  },
    },
    assumptions: ["S3 或 GCS presigned URL 上傳", "圖片壓縮在前端處理"],
    exclusions: ["影片轉檔", "CDN 設定", "媒體庫管理介面"],
    missingInfo: ["檔案類型（圖片 / 文件 / 影片）", "是否需要圖片裁切或縮圖", "上傳大小限制與並行上傳需求"],
  },
  // ─── Email 通知（分三層，依需求複雜度選擇） ─────────────────────────────────────
  {
    baselineKey: "email_basic",
    name: "Email 通知（基礎：聯絡表單寄信）",
    description: "聯絡表單或單一事件觸發的通知 Email，1 種模板，無佇列，無複雜整合",
    defaultComplexity: "simple",
    confidence: "high",
    riskBuffer: 0,
    baselineHours: {
      pm:      { min: 0, max: 1  },
      backend: { min: 2, max: 4  },
      qa:      { min: 1, max: 2  },
    },
    assumptions: ["SendGrid / Resend 等 SaaS 寄信服務", "1 種固定模板", "無 UI 需求"],
    exclusions: ["多種模板", "事件日誌", "重試邏輯", "行銷 Email"],
    missingInfo: ["收件人是管理員還是使用者", "是否需要模板客製化"],
  },
  {
    baselineKey: "email_transactional",
    name: "Email 通知（交易型：模板 + 事件）",
    description: "多種事件觸發的 Email（歡迎信、密碼重設、訂單通知等），含模板設計、SendGrid/SES 串接",
    defaultComplexity: "simple",
    confidence: "high",
    riskBuffer: 0.1,
    baselineHours: {
      pm:       { min: 2,  max: 4  },
      uiux:     { min: 2,  max: 4  },
      frontend: { min: 2,  max: 4  },
      backend:  { min: 6,  max: 14 },
      qa:       { min: 3,  max: 7  },
      devops:   { min: 1,  max: 3  },
    },
    assumptions: ["3–6 種 Email 模板", "SendGrid 或 AWS SES", "觸發點在後端事件"],
    exclusions: ["佇列與重試邏輯", "行銷 Email / 大量發送", "A/B 測試"],
    missingInfo: ["Email 模板數量", "是否需要客戶自訂模板", "事件觸發點清單"],
  },
  {
    baselineKey: "email_queue_advanced",
    name: "Email 通知（進階：佇列 + 重試 + 日誌）",
    description: "需要 queue 機制、重試策略、發送日誌、多模板管理的 Email 系統，適合高可靠性需求",
    defaultComplexity: "standard",
    confidence: "medium",
    riskBuffer: 0.2,
    baselineHours: {
      pm:       { min: 2,  max: 4  },
      uiux:     { min: 2,  max: 4  },
      frontend: { min: 4,  max: 8  },
      backend:  { min: 14, max: 26 },
      qa:       { min: 6,  max: 12 },
      devops:   { min: 4,  max: 8  },
    },
    assumptions: ["BullMQ / SQS 等 Queue 機制", "送達狀態追蹤", "多模板管理介面"],
    exclusions: ["行銷 Email / 大量發送", "取消訂閱管理介面"],
    missingInfo: ["預估每日發送量", "是否需要 UI 管理介面", "重試次數與策略", "是否需要客戶查看發送日誌"],
  },

  // ─── 舊版 email baseline（@deprecated，保留供歷史 snapshot 使用，AI prompt 不顯示） ─
  {
    baselineKey: "email_notification",
    deprecated: true,
    name: "Email 通知",
    description: "通知 Email 系統，含模板設計、SendGrid / SES 串接、發送佇列",
    defaultComplexity: "simple",
    confidence: "high",
    riskBuffer: 0.1,
    baselineHours: {
      pm:       { min: 1,  max: 2  },
      uiux:     { min: 2,  max: 4  },
      frontend: { min: 2,  max: 4  },
      backend:  { min: 8,  max: 14 },
      qa:       { min: 4,  max: 6  },
      devops:   { min: 2,  max: 3  },
    },
    assumptions: ["1–3 種 Email 模板", "使用 SendGrid 或 AWS SES"],
    exclusions: ["行銷 Email / 大量發送", "A/B 測試", "取消訂閱管理"],
    missingInfo: ["Email 模板數量與複雜度", "是否需要客戶自訂模板內容", "發送量與是否需要佇列"],
  },
  {
    baselineKey: "sms_notification",
    name: "簡訊通知（SMS）",
    description: "Twilio / AWS SNS / 台灣簡訊商串接，OTP 或系統通知",
    defaultComplexity: "simple",
    confidence: "high",
    riskBuffer: 0.1,
    baselineHours: {
      pm:       { min: 1,  max: 2  },
      uiux:     { min: 0,  max: 2  },
      frontend: { min: 2,  max: 4  },
      backend:  { min: 8,  max: 12 },
      qa:       { min: 4,  max: 6  },
      devops:   { min: 2,  max: 3  },
    },
    assumptions: ["1–2 種簡訊類型", "使用商業簡訊 API"],
    exclusions: ["行銷簡訊大量發送", "國際簡訊（費率另計）"],
    missingInfo: ["簡訊服務商偏好（台灣業者 vs 國際）", "OTP 還是通知型", "預估每月發送量"],
  },
  {
    baselineKey: "payment_integration",
    name: "金流串接",
    description: "綠界 / Stripe / 藍新信用卡、ATM、超商付款，含 webhook 與訂單狀態管理",
    defaultComplexity: "complex",
    confidence: "medium",
    riskBuffer: 0.2,
    baselineHours: {
      pm:       { min: 4,  max: 6  },
      uiux:     { min: 6,  max: 10 },
      frontend: { min: 10, max: 16 },
      backend:  { min: 20, max: 32 },
      qa:       { min: 12, max: 20 },
      devops:   { min: 4,  max: 6  },
    },
    assumptions: ["以 1 個金流商為準", "含沙箱測試環境", "信用卡為主要支付方式"],
    exclusions: ["退款自動化", "多幣別", "發票串接（另計）", "每增加一個付款方式需加估"],
    missingInfo: ["金流商選擇（影響串接複雜度）", "是否需要 ATM / 超商付款", "是否需要定期扣款（recurring）"],
  },
  {
    baselineKey: "subscription_credits",
    name: "訂閱制 / 點數制",
    description: "方案管理、帳單週期、點數購買、用量追蹤、到期通知",
    defaultComplexity: "complex",
    confidence: "medium",
    baselineHours: {
      pm:       { min: 6,  max: 10 },
      uiux:     { min: 8,  max: 14 },
      frontend: { min: 14, max: 24 },
      backend:  { min: 24, max: 36 },
      qa:       { min: 12, max: 20 },
      devops:   { min: 4,  max: 6  },
    },
    assumptions: ["3 個方案以內", "月結或年結", "含金流串接（另計）"],
    exclusions: ["用量計費（metered billing）", "發票自動化", "退款流程"],
    missingInfo: ["訂閱制還是點數制（設計完全不同）", "方案升降級邏輯", "免費試用期需求"],
  },
  {
    baselineKey: "ai_api_simple",
    name: "AI 功能（單次呼叫）",
    description: "呼叫 LLM API 做文字生成或分析，單次請求 → 顯示結果，無歷史記錄",
    defaultComplexity: "standard",
    confidence: "medium",
    baselineHours: {
      pm:       { min: 2,  max: 4  },
      uiux:     { min: 4,  max: 8  },
      frontend: { min: 8,  max: 12 },
      backend:  { min: 12, max: 20 },
      qa:       { min: 6,  max: 10 },
      devops:   { min: 2,  max: 4  },
    },
    assumptions: ["單一 LLM provider", "Prompt 固定不可自訂", "無 streaming 輸出"],
    exclusions: ["Streaming 輸出（另計前端）", "歷史紀錄", "用戶可編輯結果", "Fallback 機制"],
    missingInfo: ["AI 功能的互動複雜度", "是否需要 streaming", "用戶是否能調整 prompt 或參數"],
  },
  {
    baselineKey: "ai_feature_full",
    name: "AI 功能（完整：可編輯 + 歷史 + Fallback）",
    description: "LLM 整合含 streaming 輸出、可編輯結果、歷史紀錄、重試機制、provider fallback",
    defaultComplexity: "complex",
    confidence: "low",
    baselineHours: {
      pm:       { min: 6,  max: 10 },
      uiux:     { min: 10, max: 16 },
      frontend: { min: 16, max: 28 },
      backend:  { min: 24, max: 40 },
      qa:       { min: 12, max: 18 },
      devops:   { min: 4,  max: 8  },
    },
    assumptions: ["單一主要 provider", "DB 儲存歷史", "基本 fallback 邏輯"],
    exclusions: ["RAG / 向量資料庫", "自訂模型微調", "多 provider 路由策略"],
    missingInfo: ["AI 互動的深度（幾輪對話、幾種操作）", "是否需要 RAG", "歷史記錄的保存與查詢需求"],
  },
  {
    baselineKey: "share_link",
    name: "分享連結 / UUID Token / 公開頁",
    description: "產生可分享網址、公開瀏覽頁（不需登入）、可設定有效期限或存取控制",
    defaultComplexity: "simple",
    confidence: "high",
    baselineHours: {
      pm:       { min: 1,  max: 2  },
      uiux:     { min: 4,  max: 8  },
      frontend: { min: 8,  max: 14 },
      backend:  { min: 6,  max: 10 },
      qa:       { min: 4,  max: 6  },
      devops:   { min: 1,  max: 2  },
    },
    assumptions: ["UUID token 存 DB", "公開頁僅顯示，無互動"],
    exclusions: ["密碼保護", "客戶線上簽署", "浮水印"],
    missingInfo: ["公開頁的 UI 複雜度", "是否需要有效期限控制", "是否需要追蹤瀏覽記錄"],
  },
  {
    baselineKey: "status_tracking",
    name: "狀態追蹤（sent / viewed / accepted）",
    description: "物件狀態機、狀態變更歷史 log、瀏覽 / 開啟追蹤",
    defaultComplexity: "simple",
    confidence: "high",
    baselineHours: {
      pm:       { min: 2,  max: 3  },
      uiux:     { min: 3,  max: 6  },
      frontend: { min: 6,  max: 10 },
      backend:  { min: 8,  max: 14 },
      qa:       { min: 4,  max: 8  },
      devops:   { min: 1,  max: 2  },
    },
    assumptions: ["5 個以內狀態", "基本 audit log", "狀態只能單向流動"],
    exclusions: ["複雜業務流程自動化", "Email 觸發通知（另計）", "可撤回狀態"],
    missingInfo: ["狀態數量與轉換規則", "是否需要通知觸發", "是否需要手動與自動狀態混合"],
  },
  {
    baselineKey: "pdf_export",
    name: "PDF 匯出 / 列印版面",
    description: "由 HTML/模板產生 PDF 檔案，含版面設計、下載與預覽",
    defaultComplexity: "standard",
    confidence: "medium",
    baselineHours: {
      pm:       { min: 2,  max: 3  },
      uiux:     { min: 4,  max: 8  },
      frontend: { min: 8,  max: 14 },
      backend:  { min: 6,  max: 12 },
      qa:       { min: 4,  max: 8  },
      devops:   { min: 1,  max: 2  },
    },
    assumptions: ["A4 固定版面", "使用 Puppeteer 或 pdf-lib", "中文字型需嵌入"],
    exclusions: ["多語系版面", "動態分頁超過 10 頁的長文件", "數位簽章"],
    missingInfo: ["PDF 的頁面結構與資料複雜度", "是否需要中文字型自訂", "是否需要電子簽章或浮水印"],
  },
  {
    baselineKey: "third_party_api",
    name: "第三方 API 串接（通用）",
    description: "Google Maps、LINE Bot、物流、社群媒體等外部 API 串接（以一個為準）",
    defaultComplexity: "standard",
    confidence: "low",
    riskBuffer: 0.2,
    baselineHours: {
      pm:       { min: 3,  max: 5  },
      uiux:     { min: 2,  max: 4  },
      frontend: { min: 6,  max: 12 },
      backend:  { min: 16, max: 28 },
      qa:       { min: 8,  max: 12 },
      devops:   { min: 2,  max: 4  },
    },
    assumptions: ["以 1 個 API 為準", "有完整官方文件", "API 穩定無版本問題"],
    exclusions: ["每增加一個 API 需重新評估", "無官方 SDK 的自製協議"],
    missingInfo: ["API 是哪一個（文件品質差異很大）", "是否有 webhook / callback 需求", "API 速率限制是否影響設計"],
  },
  {
    baselineKey: "data_import_export",
    name: "資料匯入 / 匯出",
    description: "CSV / Excel 批次上傳含欄位驗證、背景匯入工作；匯出 CSV / Excel 下載",
    defaultComplexity: "standard",
    confidence: "high",
    baselineHours: {
      pm:       { min: 2,  max: 4  },
      uiux:     { min: 4,  max: 8  },
      frontend: { min: 8,  max: 14 },
      backend:  { min: 12, max: 20 },
      qa:       { min: 6,  max: 10 },
      devops:   { min: 1,  max: 2  },
    },
    assumptions: ["固定欄位格式", "資料量 < 10,000 筆（同步處理）"],
    exclusions: ["大量非同步匯入（> 10k 筆）需加 queue 架構", "資料轉換或清洗邏輯"],
    missingInfo: ["匯入格式是否固定或需要欄位對應", "資料量級", "是否需要錯誤回報與重試"],
  },
  {
    baselineKey: "admin_panel",
    name: "Admin 後台（完整含 RBAC）",
    description: "多角色後台管理介面、儀表板統計、完整資料管理、用戶與設定管理",
    defaultComplexity: "complex",
    confidence: "medium",
    baselineHours: {
      pm:       { min: 8,  max: 12 },
      uiux:     { min: 14, max: 22 },
      frontend: { min: 28, max: 44 },
      backend:  { min: 22, max: 36 },
      qa:       { min: 12, max: 20 },
      devops:   { min: 4,  max: 6  },
    },
    assumptions: ["3 個以內角色", "管理 5 個以內主要資料實體"],
    exclusions: ["AI 輔助功能", "審核工作流程", "多語系管理介面"],
    missingInfo: ["後台管理的資料實體數量", "角色與權限差異複雜度", "是否需要操作記錄（audit log）"],
  },
  {
    baselineKey: "devops_setup",
    name: "基礎 DevOps / 部署 / 環境設定",
    description: "Docker 化、GitHub Actions CI/CD、staging + production 環境、secrets 管理",
    defaultComplexity: "standard",
    confidence: "high",
    baselineHours: {
      pm:       { min: 2,  max: 3  },
      uiux:     { min: 0,  max: 0  },
      frontend: { min: 0,  max: 2  },
      backend:  { min: 4,  max: 8  },
      qa:       { min: 2,  max: 4  },
      devops:   { min: 14, max: 24 },
    },
    assumptions: ["Vercel / Railway / GCP Cloud Run 部署", "GitHub Actions", "不需要自建 server"],
    exclusions: ["Kubernetes", "多雲架構", "自建 infrastructure"],
    missingInfo: ["部署目標平台", "是否需要 staging 環境", "是否有特殊合規或安全需求"],
  },
  {
    baselineKey: "qa_regression",
    name: "QA / Regression 測試",
    description: "測試計畫撰寫、手動驗收測試、regression checklist，適合中大型專案加購",
    defaultComplexity: "standard",
    confidence: "medium",
    baselineHours: {
      pm:       { min: 2,  max: 4  },
      uiux:     { min: 0,  max: 0  },
      frontend: { min: 0,  max: 0  },
      backend:  { min: 0,  max: 0  },
      qa:       { min: 16, max: 32 },
      devops:   { min: 2,  max: 4  },
    },
    assumptions: ["手動測試為主", "含測試計畫文件與驗收報告"],
    exclusions: ["自動化 E2E（Playwright / Cypress）需另估", "壓力測試 / 效能測試"],
    missingInfo: ["系統規模（影響測試範圍）", "是否需要自動化測試", "驗收標準是否明確"],
  },
  {
    baselineKey: "pm_communication",
    name: "專案管理 / 溝通協調成本",
    description: "Kickoff、週會、需求確認、變更管理、驗收協調——以整個專案為單位",
    defaultComplexity: "standard",
    confidence: "medium",
    baselineHours: {
      pm:       { min: 12, max: 20 },
      uiux:     { min: 0,  max: 2  },
      frontend: { min: 0,  max: 2  },
      backend:  { min: 0,  max: 2  },
      qa:       { min: 2,  max: 4  },
      devops:   { min: 0,  max: 2  },
    },
    assumptions: ["6–12 週專案週期", "1–2 個主要 stakeholder", "需求相對穩定"],
    exclusions: ["超過 3 個月的長期專案需重新評估"],
    missingInfo: ["Stakeholder 數量（溝通成本差異大）", "需求變動頻率", "是否需要正式文件與簽核流程"],
  },
];

const BASELINE_MAP = new Map(DEFAULT_BASELINES.map((b) => [b.baselineKey, b]));

/**
 * Maps deprecated baselineKeys to their replacement(s) in the current baseline set.
 *
 * Rules:
 *   - NEVER auto-rewrite historical snapshot data — old keys stay in snapshots as-is.
 *   - Use this map ONLY for:
 *     a) calibration suggestion grouping (route old-key adjustments to new-key buckets)
 *     b) frontend "deprecated badge" + migration hint
 *   - suggestedKeys may be multiple (ambiguous splits); surface them to the user, don't pick automatically.
 */
export const DEPRECATED_MODULE_MAP = {
  landing_page: {
    suggestedKeys: ["landing_page_simple"],
    reason: "已拆分為四層官網類型，landing_page_simple 最接近原範圍",
  },
  multi_page_website: {
    suggestedKeys: ["corporate_site_static", "corporate_site_with_cms"],
    reason: "已拆分為四層官網類型，依是否需要 CMS 選擇",
  },
  email_notification: {
    suggestedKeys: ["email_basic", "email_transactional", "email_queue_advanced"],
    reason: "已拆分為三層 Email 類型，依複雜度與佇列需求選擇",
  },
};

/**
 * UI-friendly display names for baseline keys.
 * Used by the frontend to show human-readable module names instead of internal keys.
 * Keys that are not listed fall back to the baseline's `name` field.
 */
export const BASELINE_DISPLAY_NAMES = {
  // 官網分層
  landing_page_simple:        "單頁形象頁",
  corporate_site_static:      "多頁企業官網（無後台）",
  corporate_site_with_cms:    "企業官網＋內容管理後台",
  corporate_site_advanced:    "全功能企業官網",
  // Email
  email_basic:                "聯絡表單寄信",
  email_transactional:        "系統通知 Email",
  email_queue_advanced:       "高可靠度 Email 系統（Queue）",
  // 功能模組
  auth_standard:              "帳號系統（Email 登入）",
  auth_social:                "社群登入（Google / Line）",
  rbac:                       "權限管理系統（RBAC）",
  crud_module:                "資料管理模組（CRUD）",
  dashboard_analytics:        "數據後台與圖表",
  file_upload:                "檔案上傳 / 媒體管理",
  sms_notification:           "SMS 簡訊通知",
  payment_integration:        "金流串接（信用卡 / 街口 / LinePay）",
  subscription_credits:       "訂閱制 / 點數系統",
  ai_api_simple:              "AI 功能串接（基礎）",
  ai_feature_full:            "AI 功能（完整，含知識庫 / RAG）",
  share_link:                 "公開分享連結",
  status_tracking:            "進度追蹤頁面",
  pdf_export:                 "PDF 匯出",
  third_party_api:            "第三方 API 串接",
  data_import_export:         "資料匯入 / 匯出（CSV / Excel）",
  admin_panel:                "後台管理介面",
  cms_backend:                "CMS 後台",
  devops_setup:               "DevOps / 部署設定",
  qa_regression:              "QA 回歸測試",
  // 舊版（deprecated，不應出現在新報價，僅歷史顯示用）
  landing_page:               "形象官網（舊版）",
  multi_page_website:         "多頁企業官網（舊版）",
  email_notification:         "Email 通知（舊版）",
};

/**
 * Get estimation baselines for a workspace.
 * Merges defaults with workspace-level overrides from SystemSettings.estimationBaselines.
 *
 * @param {string} workspaceId
 * @returns {Promise<Array>}
 */
export async function getEstimationBaselines(workspaceId) {
  const settings = await prisma.systemSettings.findUnique({
    where: { workspaceId },
    select: { estimationBaselines: true },
  });

  const overrides = Array.isArray(settings?.estimationBaselines)
    ? settings.estimationBaselines
    : [];

  if (overrides.length === 0) return DEFAULT_BASELINES;

  const merged = new Map(BASELINE_MAP);
  for (const override of overrides) {
    if (!override?.baselineKey) continue;
    const existing = merged.get(override.baselineKey);
    if (existing) {
      merged.set(override.baselineKey, {
        ...existing,
        ...override,
        baselineHours: {
          ...existing.baselineHours,
          ...(override.baselineHours || {}),
        },
      });
    } else {
      merged.set(override.baselineKey, override);
    }
  }

  return Array.from(merged.values());
}

export async function getBaselineByKey(baselineKey, workspaceId) {
  const baselines = await getEstimationBaselines(workspaceId);
  return baselines.find((b) => b.baselineKey === baselineKey) ?? null;
}
