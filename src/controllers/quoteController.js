import prisma from "../lib/prisma.js";

function formatDate(value) {
  if (!value) return "";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function toSafeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatAmount(value) {
  const numeric = toSafeNumber(value);
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2);
}

function escapeCsvCell(value) {
  const stringValue = value === null || value === undefined ? "" : String(value);
  const escapedValue = stringValue.replace(/"/g, '""');
  return /[",\n]/.test(escapedValue) ? `"${escapedValue}"` : escapedValue;
}

function buildCsvRow(values) {
  return values.map(escapeCsvCell).join(",");
}

function sanitizeFilenamePart(value) {
  return String(value || "quote")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "quote";
}

const EXPORT_LABELS = {
  "zh-TW": {
    sheetName: "報價單",
    title: "報價單",
    no: "報價單編號",
    date: "報價日期",
    validUntil: "報價有效期限",
    partyA: "甲方（報價方／供應商）",
    partyB: "乙方（客戶）",
    company: "公司名稱",
    contact: "聯絡人",
    email: "電話／Email",
    taxId: "統編",
    projectBreakdown: "專案報價明細",
    projectName: "專案名稱",
    projectType: "專案類型",
    expectedDays: "預計天數",
    services: "服務項目",
    materials: "材料項目",
    noCol: "No.",
    phase: "專案階段／模組",
    desc: "服務內容簡述",
    hours: "預計工時",
    unitPrice: "單位單價",
    subtotal: "小計",
    quantity: "數量",
    unit: "單位",
    itemRole: "項目／角色",
    termsTitle: "交易條款",
    tax: "稅額 5%",
    grandTotal: "報價總金額",
    pm: "專案經理",
    defaultTerms: (days) => [
      "付款條件：",
      "- 簽約時：30% 訂金",
      "- 設計完成：30% 期中款",
      "- 驗收上線：40% 尾款",
      "",
      `專案時程：預計 ${days} 天內完成。`,
      "後續維護：此報價不包含上線後第 1 個月起的維護費用，維護方案將另行報價。",
      "所有權：軟體程式碼版權於結清尾款後歸乙方所有。",
    ],
  },
  "zh-CN": {
    sheetName: "报价单",
    title: "报价单",
    no: "报价单编号",
    date: "报价日期",
    validUntil: "报价有效期",
    partyA: "甲方（报价方／供应商）",
    partyB: "乙方（客户）",
    company: "公司名称",
    contact: "联系人",
    email: "电话／Email",
    taxId: "税号",
    projectBreakdown: "项目报价明细",
    projectName: "项目名称",
    projectType: "项目类型",
    expectedDays: "预计天数",
    services: "服务项目",
    materials: "材料项目",
    noCol: "No.",
    phase: "项目阶段／模块",
    desc: "服务内容简述",
    hours: "预计工时",
    unitPrice: "单位单价",
    subtotal: "小计",
    quantity: "数量",
    unit: "单位",
    itemRole: "项目／角色",
    termsTitle: "交易条款",
    tax: "税额 5%",
    grandTotal: "报价总金额",
    pm: "项目经理",
    defaultTerms: (days) => [
      "付款条件：",
      "- 签约时：30% 订金",
      "- 设计完成：30% 中期款",
      "- 验收上线：40% 尾款",
      "",
      `项目周期：预计 ${days} 天内完成。`,
      "后续维护：本报价不包含上线后第 1 个月起的维护费用，维护方案将另行报价。",
      "所有权：软件源代码版权于结清尾款后归乙方所有。",
    ],
  },
  en: {
    sheetName: "Quotation",
    title: "Quotation",
    no: "Quotation No.",
    date: "Date",
    validUntil: "Valid Until",
    partyA: "Provider",
    partyB: "Client",
    company: "Company",
    contact: "Contact",
    email: "Phone/Email",
    taxId: "Tax ID",
    projectBreakdown: "Project Breakdown",
    projectName: "Project Name",
    projectType: "Project Type",
    expectedDays: "Expected Days",
    services: "Services",
    materials: "Materials",
    noCol: "No.",
    phase: "Phase/Module",
    desc: "Service Description",
    hours: "Hrs",
    unitPrice: "Unit Price",
    subtotal: "Subtotal",
    quantity: "Quantity",
    unit: "Unit",
    itemRole: "Item/Role",
    termsTitle: "Terms & Conditions",
    tax: "Tax 5%",
    grandTotal: "Grand Total",
    pm: "Project Manager",
    defaultTerms: (days) => [
      "Payment Terms:",
      "- 30% deposit upon signing",
      "- 30% milestone payment after design completion",
      "- 40% final payment upon acceptance and launch",
      "",
      `Project Timeline: Estimated completion within ${days} days.`,
      "Maintenance: This quote does not include maintenance fees from the first month after launch; maintenance plans will be quoted separately.",
      "Ownership: Source code ownership transfers to the client after the final balance is fully settled.",
    ],
  },
  ja: {
    sheetName: "見積書",
    title: "見積書",
    no: "見積番号",
    date: "発行日",
    validUntil: "有効期限",
    partyA: "甲（提供者）",
    partyB: "乙（顧客）",
    company: "会社名",
    contact: "担当者",
    email: "電話／メール",
    taxId: "税番号",
    projectBreakdown: "見積明細",
    projectName: "案件名",
    projectType: "案件タイプ",
    expectedDays: "予定日数",
    services: "サービス項目",
    materials: "材料項目",
    noCol: "No.",
    phase: "工程／モジュール",
    desc: "サービス内容",
    hours: "予定工数",
    unitPrice: "単価",
    subtotal: "小計",
    quantity: "数量",
    unit: "単位",
    itemRole: "項目／役割",
    termsTitle: "取引条件",
    tax: "税額 5%",
    grandTotal: "合計金額",
    pm: "プロジェクトマネージャー",
    defaultTerms: (days) => [
      "支払条件：",
      "- 契約時：30% 前金",
      "- 設計完了時：30% 中間金",
      "- 検収・公開時：40% 残金",
      "",
      `納期：予定期間は ${days} 日です。`,
      "保守：本見積には公開後 1 か月目以降の保守費用は含まれておらず、別途見積となります。",
      "権利帰属：ソフトウェアのソースコードの権利は、最終支払い完了後に乙へ移転します。",
    ],
  },
  ko: {
    sheetName: "견적서",
    title: "견적서",
    no: "견적 번호",
    date: "발행일",
    validUntil: "유효 기간",
    partyA: "갑（제공사）",
    partyB: "을（고객）",
    company: "회사명",
    contact: "담당자",
    email: "전화／이메일",
    taxId: "사업자번호",
    projectBreakdown: "프로젝트 견적 상세",
    projectName: "프로젝트명",
    projectType: "프로젝트 유형",
    expectedDays: "예상 일수",
    services: "서비스 항목",
    materials: "자재 항목",
    noCol: "No.",
    phase: "단계／모듈",
    desc: "서비스 설명",
    hours: "예상 시간",
    unitPrice: "단가",
    subtotal: "소계",
    quantity: "수량",
    unit: "단위",
    itemRole: "항목／역할",
    termsTitle: "거래 조건",
    tax: "세금 5%",
    grandTotal: "총 견적 금액",
    pm: "프로젝트 매니저",
    defaultTerms: (days) => [
      "결제 조건:",
      "- 계약 시: 30% 계약금",
      "- 디자인 완료 시: 30% 중도금",
      "- 검수 및 배포 시: 40% 잔금",
      "",
      `프로젝트 일정: 예상 완료 기간은 ${days}일입니다.`,
      "유지보수: 본 견적에는 런칭 후 1개월 이후의 유지보수 비용이 포함되어 있지 않으며, 별도 견적이 제공됩니다.",
      "소유권: 소프트웨어 소스코드의 권리는 최종 잔금 정산 후 고객에게 이전됩니다.",
    ],
  },
};

function countRegexMatches(text, regex) {
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

function normalizeExportLanguage(documentLanguage) {
  if (!documentLanguage) return null;

  const normalized = String(documentLanguage).trim().toLowerCase();

  if (normalized === "en") return "en";
  if (normalized === "ja") return "ja";
  if (normalized === "ko") return "ko";
  if (
    normalized === "zh-cn" ||
    normalized === "zh_cn" ||
    normalized === "zh-hans"
  ) {
    return "zh-CN";
  }
  if (normalized === "zh-tw" || normalized === "zh_tw" || normalized === "zh-hant") {
    return "zh-TW";
  }

  return null;
}

function inferExportLanguageFromQuote({ quote, paymentTerms }) {
  const sampleText = [
    quote?.projectName,
    quote?.description,
    paymentTerms,
    ...(Array.isArray(quote?.items)
      ? quote.items.map((item) => item?.description || "")
      : []),
  ]
    .filter(Boolean)
    .join(" ");

  if (!sampleText) {
    return "en";
  }

  const japaneseCount = countRegexMatches(sampleText, /[\u3040-\u30ff]/g);
  if (japaneseCount > 0) return "ja";

  const koreanCount = countRegexMatches(sampleText, /[\uac00-\ud7af]/g);
  if (koreanCount > 0) return "ko";

  const simplifiedChineseCount = countRegexMatches(
    sampleText,
    /[们这为发开后网务项总额报订户线页务师类选轻沟项协简体]/g,
  );
  const traditionalChineseCount = countRegexMatches(
    sampleText,
    /[們這為發開後網務項總額報訂戶線頁務師類選輕溝項協繁體]/g,
  );
  if (simplifiedChineseCount > traditionalChineseCount && simplifiedChineseCount >= 2) {
    return "zh-CN";
  }

  const latinCount = countRegexMatches(sampleText, /[A-Za-z]/g);
  const cjkCount = countRegexMatches(sampleText, /[\u3400-\u9fff]/g);
  if (latinCount >= 24 && latinCount > cjkCount * 1.5) {
    return "en";
  }
  if (cjkCount > 0) {
    return "zh-TW";
  }

  return "en";
}

function formatCurrencyDisplay(value) {
  const numeric = toSafeNumber(value);
  return `$${numeric.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(numeric) ? 0 : 2,
    maximumFractionDigits: Number.isInteger(numeric) ? 0 : 2,
  })}`;
}

function formatHoursDisplay(value) {
  const numeric = toSafeNumber(value);
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2);
}

function formatRoleLabel(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (normalized.toLowerCase() === "pm") return "PM";
  return normalized
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function formatProjectTypeLabel(projectType, projectTypes) {
  const normalized = String(projectType || "").trim();
  if (!normalized) return "-";

  if (Array.isArray(projectTypes)) {
    const matched = projectTypes.find((option) => {
      if (!option || typeof option !== "object") return false;
      return option.value === normalized || option.label === normalized;
    });
    if (matched?.label) {
      return matched.label;
    }
  }

  return normalized
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function splitMultilineText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd());
}

function getQuotationNo(id, issueDate) {
  const shortId = String(id || "DRAFT")
    .replace("quote_", "")
    .substring(0, 8)
    .toUpperCase();
  return `QTE-${issueDate.getFullYear()}-${shortId}`;
}

function buildQuoteExportModel({ quote, settings, documentLanguage }) {
  const items = Array.isArray(quote.items) ? quote.items : [];
  const services = items.filter((item) => !item.type || item.type === "service");
  const materials = items.filter((item) => item.type === "material");
  const issueDate = quote.createdAt ? new Date(quote.createdAt) : new Date();
  const validityDays =
    Number.isFinite(Number(quote.validityDays)) && Number(quote.validityDays) > 0
      ? Number(quote.validityDays)
      : Number(settings?.quoteValidityDays) > 0
        ? Number(settings.quoteValidityDays)
        : 30;
  const validUntil = new Date(issueDate.getTime() + validityDays * 86400000);
  const paymentTerms = quote.paymentTerms || "";
  const languageKey =
    normalizeExportLanguage(documentLanguage) ||
    inferExportLanguageFromQuote({ quote, paymentTerms });
  const labels = EXPORT_LABELS[languageKey] || EXPORT_LABELS.en;
  const totalAmount = items.reduce((sum, item) => sum + toSafeNumber(item.amount), 0);
  const taxAmount = Math.round(totalAmount * 0.05);
  const grandTotal = totalAmount + taxAmount;
  const termsLines = paymentTerms
    ? splitMultilineText(paymentTerms)
    : labels.defaultTerms(quote.expectedDays || 30);
  const providerName = settings?.companyName || "";
  const providerEmail = settings?.contactEmail || "";
  const providerTaxId = settings?.taxId || "";
  const customerName = quote.customerName || "";
  const customerEmail = quote.customer?.email || "";
  const customerTaxId = quote.customer?.taxId || "";
  const quotationNo = getQuotationNo(quote.id, issueDate);

  return {
    labels,
    languageKey,
    quotationNo,
    issueDateText: formatDate(issueDate),
    validUntilText: formatDate(validUntil),
    projectName: quote.projectName || "",
    projectType: formatProjectTypeLabel(
      quote.projectType,
      settings?.projectTypes,
    ),
    expectedDaysText: quote.expectedDays ? String(quote.expectedDays) : "-",
    providerName,
    providerContact: labels.pm,
    providerEmail,
    providerTaxId,
    customerName,
    customerContact: "-",
    customerEmail: customerEmail || "-",
    customerTaxId: customerTaxId || "-",
    description: quote.description || "",
    services: services.map((item, index) => ({
      no: String(index + 1),
      phase: formatRoleLabel(item.suggestedRole),
      description: item.description || "",
      hours: formatHoursDisplay(item.estimatedHours),
      unitPrice: formatCurrencyDisplay(item.hourlyRate),
      subtotal: formatCurrencyDisplay(item.amount),
    })),
    materials: materials.map((item, index) => ({
      no: String(index + 1),
      role: formatRoleLabel(item.suggestedRole),
      description: item.description || "",
      quantity: formatHoursDisplay(item.estimatedHours),
      unit: item.unit || "",
      unitPrice: formatCurrencyDisplay(item.hourlyRate),
      subtotal: formatCurrencyDisplay(item.amount),
    })),
    subtotalText: formatCurrencyDisplay(totalAmount),
    taxText: formatCurrencyDisplay(taxAmount),
    grandTotalText: formatCurrencyDisplay(grandTotal),
    termsLines,
    filenameBase: `${sanitizeFilenamePart(
      quote.projectName || quote.customerName || quote.id,
    )}-quotation`,
  };
}

function buildQuoteExportCsv(model) {
  const rows = [
    buildCsvRow([model.labels.title, model.projectName]),
    buildCsvRow([model.labels.no, model.quotationNo]),
    buildCsvRow([model.labels.date, model.issueDateText]),
    buildCsvRow([model.labels.validUntil, model.validUntilText]),
    buildCsvRow([model.labels.company, model.customerName]),
    buildCsvRow([model.labels.projectType, model.projectType]),
    buildCsvRow([model.labels.expectedDays, model.expectedDaysText]),
    buildCsvRow([model.labels.partyA, model.providerName]),
    buildCsvRow([model.labels.email, model.providerEmail]),
    buildCsvRow([model.labels.taxId, model.providerTaxId]),
    buildCsvRow([model.labels.projectName, model.projectName]),
    buildCsvRow([]),
    buildCsvRow([model.labels.services]),
    buildCsvRow([
      model.labels.noCol,
      model.labels.phase,
      model.labels.desc,
      model.labels.hours,
      model.labels.unitPrice,
      model.labels.subtotal,
    ]),
    ...model.services.map((item) =>
      buildCsvRow([
        item.no,
        item.phase,
        item.description,
        item.hours,
        item.unitPrice,
        item.subtotal,
      ]),
    ),
  ];

  if (model.materials.length > 0) {
    rows.push(buildCsvRow([]));
    rows.push(buildCsvRow([model.labels.materials]));
    rows.push(
      buildCsvRow([
        model.labels.noCol,
        model.labels.itemRole,
        model.labels.desc,
        model.labels.quantity,
        model.labels.unit,
        model.labels.unitPrice,
        model.labels.subtotal,
      ]),
    );
    rows.push(
      ...model.materials.map((item) =>
        buildCsvRow([
          item.no,
          item.role,
          item.description,
          item.quantity,
          item.unit,
          item.unitPrice,
          item.subtotal,
        ]),
      ),
    );
  }

  rows.push(buildCsvRow([]));
  rows.push(buildCsvRow([model.labels.subtotal, model.subtotalText]));
  rows.push(buildCsvRow([model.labels.tax, model.taxText]));
  rows.push(buildCsvRow([model.labels.grandTotal, model.grandTotalText]));
  rows.push(buildCsvRow([]));
  rows.push(buildCsvRow([model.labels.termsTitle]));
  rows.push(...model.termsLines.map((line) => buildCsvRow([line])));

  return `\uFEFF${rows.join("\n")}`;
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getExcelColumnName(index) {
  let column = "";
  let value = index;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    column = String.fromCharCode(65 + remainder) + column;
    value = Math.floor((value - 1) / 26);
  }
  return column;
}

function createTextCell(value, style = 0) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return {
    value: String(value),
    style,
  };
}

function buildQuoteExportRows(model) {
  const rows = [];
  const merges = [];
  const pushRow = (cells, mergeRanges = []) => {
    rows.push(cells);
    const rowNumber = rows.length;
    mergeRanges.forEach(([start, end]) => {
      merges.push(`${start}${rowNumber}:${end}${rowNumber}`);
    });
  };

  pushRow([createTextCell(model.labels.title, 1), null, null, null, null, null], [
    ["A", "F"],
  ]);
  pushRow([null, null, null, null, null, null]);
  pushRow([
    createTextCell(model.labels.no, 2),
    createTextCell(model.quotationNo, 6),
    null,
    null,
    createTextCell(model.labels.date, 2),
    createTextCell(model.issueDateText, 6),
  ]);
  pushRow([
    createTextCell(model.labels.validUntil, 2),
    createTextCell(model.validUntilText, 6),
    null,
    null,
    createTextCell(model.labels.projectType, 2),
    createTextCell(model.projectType, 6),
  ]);
  pushRow([
    createTextCell(model.labels.expectedDays, 2),
    createTextCell(model.expectedDaysText, 6),
    null,
    null,
    null,
    null,
  ]);
  pushRow([null, null, null, null, null, null]);
  pushRow([
    createTextCell(model.labels.partyA, 4),
    null,
    null,
    createTextCell(model.labels.partyB, 4),
    null,
    null,
  ], [
    ["A", "C"],
    ["D", "F"],
  ]);
  pushRow([
    createTextCell(model.labels.company, 6),
    createTextCell(model.providerName, 6),
    null,
    createTextCell(model.labels.company, 6),
    createTextCell(model.customerName, 6),
    null,
  ], [
    ["B", "C"],
    ["E", "F"],
  ]);
  pushRow([
    createTextCell(model.labels.contact, 6),
    createTextCell(model.providerContact, 6),
    null,
    createTextCell(model.labels.contact, 6),
    createTextCell(model.customerContact, 6),
    null,
  ], [
    ["B", "C"],
    ["E", "F"],
  ]);
  pushRow([
    createTextCell(model.labels.email, 6),
    createTextCell(model.providerEmail, 6),
    null,
    createTextCell(model.labels.email, 6),
    createTextCell(model.customerEmail, 6),
    null,
  ], [
    ["B", "C"],
    ["E", "F"],
  ]);
  pushRow([
    createTextCell(model.labels.taxId, 6),
    createTextCell(model.providerTaxId, 6),
    null,
    createTextCell(model.labels.taxId, 6),
    createTextCell(model.customerTaxId, 6),
    null,
  ], [
    ["B", "C"],
    ["E", "F"],
  ]);
  pushRow([null, null, null, null, null, null]);
  pushRow([createTextCell(model.labels.projectBreakdown, 3), null, null, null, null, null], [
    ["A", "F"],
  ]);
  pushRow([
    createTextCell(model.labels.projectName, 2),
    createTextCell(model.projectName, 6),
    null,
    null,
    null,
    null,
  ], [["B", "F"]]);
  pushRow([
    createTextCell(model.labels.projectType, 2),
    createTextCell(model.projectType, 6),
    null,
    createTextCell(model.labels.expectedDays, 2),
    createTextCell(model.expectedDaysText, 6),
    null,
  ], [
    ["B", "C"],
    ["E", "F"],
  ]);
  pushRow([null, null, null, null, null, null]);
  pushRow([createTextCell(model.labels.services, 3), null, null, null, null, null], [
    ["A", "F"],
  ]);
  pushRow([
    createTextCell(model.labels.noCol, 5),
    createTextCell(model.labels.phase, 5),
    createTextCell(model.labels.desc, 5),
    createTextCell(model.labels.hours, 5),
    createTextCell(model.labels.unitPrice, 5),
    createTextCell(model.labels.subtotal, 5),
  ]);
  model.services.forEach((item) => {
    pushRow([
      createTextCell(item.no, 6),
      createTextCell(item.phase, 6),
      createTextCell(item.description, 6),
      createTextCell(item.hours, 6),
      createTextCell(item.unitPrice, 6),
      createTextCell(item.subtotal, 6),
    ]);
  });

  if (model.materials.length > 0) {
    pushRow([null, null, null, null, null, null]);
    pushRow([createTextCell(model.labels.materials, 3), null, null, null, null, null], [
      ["A", "F"],
    ]);
    pushRow([
      createTextCell(model.labels.noCol, 5),
      createTextCell(model.labels.itemRole, 5),
      createTextCell(model.labels.desc, 5),
      createTextCell(model.labels.quantity, 5),
      createTextCell(model.labels.unitPrice, 5),
      createTextCell(model.labels.subtotal, 5),
    ]);
    model.materials.forEach((item) => {
      pushRow([
        createTextCell(item.no, 6),
        createTextCell(item.role, 6),
        createTextCell(`${item.description}${item.unit ? ` (${item.unit})` : ""}`, 6),
        createTextCell(item.quantity, 6),
        createTextCell(item.unitPrice, 6),
        createTextCell(item.subtotal, 6),
      ]);
    });
  }

  pushRow([null, null, null, null, null, null]);
  pushRow([
    null,
    null,
    null,
    createTextCell(model.labels.subtotal, 7),
    null,
    createTextCell(model.subtotalText, 8),
  ], [["D", "E"]]);
  pushRow([
    null,
    null,
    null,
    createTextCell(model.labels.tax, 7),
    null,
    createTextCell(model.taxText, 8),
  ], [["D", "E"]]);
  pushRow([
    null,
    null,
    null,
    createTextCell(model.labels.grandTotal, 7),
    null,
    createTextCell(model.grandTotalText, 8),
  ], [["D", "E"]]);
  pushRow([null, null, null, null, null, null]);
  pushRow([createTextCell(model.labels.termsTitle, 3), null, null, null, null, null], [
    ["A", "F"],
  ]);
  model.termsLines.forEach((line) => {
    pushRow([createTextCell(line || " ", 6), null, null, null, null, null], [
      ["A", "F"],
    ]);
  });

  return { rows, merges };
}

function buildWorksheetXml(model) {
  const { rows, merges } = buildQuoteExportRows(model);
  const columnWidths = [10, 22, 58, 12, 14, 16];
  const colsXml = columnWidths
    .map(
      (width, index) =>
        `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
    )
    .join("");
  const rowsXml = rows
    .map((cells, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const cellXml = cells
        .map((cell, columnIndex) => {
          if (!cell) return "";
          const ref = `${getExcelColumnName(columnIndex + 1)}${rowNumber}`;
          return `<c r="${ref}" s="${cell.style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(
            cell.value,
          )}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowNumber}">${cellXml}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:F${rows.length}" />
  <sheetViews><sheetView workbookViewId="0" /></sheetViews>
  <sheetFormatPr defaultRowHeight="18" />
  <cols>${colsXml}</cols>
  <sheetData>${rowsXml}</sheetData>
  ${merges.length ? `<mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}" />`).join("")}</mergeCells>` : ""}
</worksheet>`;
}

function buildStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font><sz val="11" /><name val="Calibri" /></font>
    <font><b /><sz val="11" /><name val="Calibri" /></font>
    <font><b /><sz val="20" /><name val="Calibri" /></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none" /></fill>
    <fill><patternFill patternType="gray125" /></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF3F4F6" /><bgColor indexed="64" /></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left /><right /><top /><bottom /><diagonal /></border>
    <border>
      <left style="thin"><color auto="1" /></left>
      <right style="thin"><color auto="1" /></right>
      <top style="thin"><color auto="1" /></top>
      <bottom style="thin"><color auto="1" /></bottom>
      <diagonal />
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" />
  </cellStyleXfs>
  <cellXfs count="9">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" />
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center" /></xf>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" />
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" />
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" />
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1" /></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1" /></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" /></xf>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" /></xf>
  </cellXfs>
</styleSheet>`;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let current = index;
    for (let bit = 0; bit < 8; bit += 1) {
      current =
        (current & 1) === 1
          ? 0xedb88320 ^ (current >>> 1)
          : current >>> 1;
    }
    table[index] = current >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function getDosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  return {
    dosDate: ((year - 1980) << 9) | (month << 5) | day,
    dosTime: (hours << 11) | (minutes << 5) | seconds,
  };
}

function createStoredZip(entries) {
  const localParts = [];
  const centralDirectoryParts = [];
  let offset = 0;
  const { dosDate, dosTime } = getDosDateTime();

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name);
    const dataBuffer = Buffer.isBuffer(entry.data)
      ? entry.data
      : Buffer.from(entry.data);
    const entryCrc32 = crc32(dataBuffer);

    const localHeader = Buffer.alloc(30 + nameBuffer.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(entryCrc32, 14);
    localHeader.writeUInt32LE(dataBuffer.length, 18);
    localHeader.writeUInt32LE(dataBuffer.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuffer.copy(localHeader, 30);

    localParts.push(localHeader, dataBuffer);

    const centralHeader = Buffer.alloc(46 + nameBuffer.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(entryCrc32, 16);
    centralHeader.writeUInt32LE(dataBuffer.length, 20);
    centralHeader.writeUInt32LE(dataBuffer.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBuffer.copy(centralHeader, 46);
    centralDirectoryParts.push(centralHeader);

    offset += localHeader.length + dataBuffer.length;
  }

  const centralDirectorySize = centralDirectoryParts.reduce(
    (sum, part) => sum + part.length,
    0,
  );
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4);
  endOfCentralDirectory.writeUInt16LE(0, 6);
  endOfCentralDirectory.writeUInt16LE(entries.length, 8);
  endOfCentralDirectory.writeUInt16LE(entries.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectorySize, 12);
  endOfCentralDirectory.writeUInt32LE(offset, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20);

  return Buffer.concat([
    ...localParts,
    ...centralDirectoryParts,
    endOfCentralDirectory,
  ]);
}

function buildQuoteExportWorkbook(model) {
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${xmlEscape(model.labels.sheetName)}" sheetId="1" r:id="rId1" />
  </sheets>
</workbook>`;
  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml" />
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml" />
</Relationships>`;
  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml" />
</Relationships>`;
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="xml" ContentType="application/xml" />
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" />
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" />
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml" />
</Types>`;

  return createStoredZip([
    { name: "[Content_Types].xml", data: contentTypesXml },
    { name: "_rels/.rels", data: rootRelsXml },
    { name: "xl/workbook.xml", data: workbookXml },
    { name: "xl/_rels/workbook.xml.rels", data: workbookRelsXml },
    { name: "xl/worksheets/sheet1.xml", data: buildWorksheetXml(model) },
    { name: "xl/styles.xml", data: buildStylesXml() },
  ]);
}

/**
 * Create a new quote with items
 * POST /api/quotes
 */
export async function createQuote(req, res) {
  try {
    const {
      customerName,
      customerId,
      projectName,
      projectType,
      createdAt,
      expectedDays,
      description,
      items,
      paymentTerms, // Add
      validityDays, // Add
      wonAmount, // Add - actual deal amount
      roleRates, // Add
      materials, // Add
    } = req.body;

    const workspaceId = req.workspace?.id;

    // Calculate total amount
    const totalAmount = items.reduce(
      (sum, item) => sum + (item.amount || 0),
      0,
    );
    // Calculate total cost (assuming hourlyRate is cost for now, or we need a separate cost field)
    // For now, let's assume margin is calculated elsewhere or we need more inputs.
    // But based on schema, we have totalMargin and totalCost.
    // Let's just save what we have.

    const quote = await prisma.quote.create({
      data: {
        customerName,
        customerId,
        projectName,
        projectType,
        createdAt: createdAt ? new Date(createdAt) : undefined,
        expectedDays: expectedDays ? parseInt(expectedDays) : null,
        description,
        status: "DRAFT",
        totalAmount,
        wonAmount: wonAmount ? parseFloat(wonAmount) : null, // Add
        paymentTerms, // Add
        validityDays: validityDays ? parseInt(validityDays) : 30, // Add with default
        workspaceId,
        roleRates: roleRates || null,
        materials: materials || null,
        items: {
          create: items.map((item) => ({
            description: item.description,
            type: item.type || "service", // Add
            estimatedHours: parseFloat(item.estimatedHours || 0),
            suggestedRole: item.suggestedRole,
            unit: item.unit || null, // Add
            hourlyRate: parseFloat(item.hourlyRate || 0),
            amount: parseFloat(item.amount || 0),
          })),
        },
      },
      include: {
        items: true,
        customer: true,
      },
    });

    return res.status(201).json(quote);
  } catch (error) {
    console.error("Create quote error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create quote",
      error: error.message,
    });
  }
}

/**
 * Get all quotes for the current user
 * GET /api/quotes
 */
export async function getQuotes(req, res) {
  try {
    console.log("getQuotes called. Workspace:", req.workspace);
    const workspaceId = req.workspace?.id;

    if (!workspaceId) {
      console.error("Workspace ID missing in request");
      return res.status(400).json({ message: "Workspace ID missing" });
    }

    const quotes = await prisma.quote.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      include: {
        customer: {
          select: { name: true },
        },
        _count: {
          select: { items: true },
        },
      },
    });

    return res.json(quotes);
  } catch (error) {
    console.error("Get quotes error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch quotes",
      error: error.message, // Include error message for debugging
    });
  }
}

/**
 * Get a single quote by ID
 * GET /api/quotes/:id
 */
export async function getQuoteById(req, res) {
  try {
    const { id } = req.params;
    const workspaceId = req.workspace?.id;

    const quote = await prisma.quote.findUnique({
      where: { id },
      include: {
        items: true,
        customer: true,
      },
    });

    if (!quote) {
      return res.status(404).json({ message: "Quote not found" });
    }

    if (quote.workspaceId !== workspaceId) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    return res.json(quote);
  } catch (error) {
    console.error("Get quote error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch quote",
    });
  }
}

/**
 * Update a quote
 * PUT /api/quotes/:id
 */
export async function updateQuote(req, res) {
  try {
    const { id } = req.params;
    const {
      customerName,
      customerId,
      projectName,
      projectType,
      createdAt,
      expectedDays,
      description,
      status,
      items,
      paymentTerms, // Add
      validityDays, // Add
      wonAmount, // Add - actual deal amount
      roleRates, // Add
      materials, // Add
    } = req.body;

    const workspaceId = req.workspace?.id;

    // Verify ownership
    const existingQuote = await prisma.quote.findUnique({
      where: { id },
    });

    if (!existingQuote || existingQuote.workspaceId !== workspaceId) {
      return res.status(404).json({ message: "Quote not found" });
    }

    // Calculate total amount
    const totalAmount = items
      ? items.reduce((sum, item) => sum + (item.amount || 0), 0)
      : existingQuote.totalAmount;

    // Transaction to update quote and replace items
    const updatedQuote = await prisma.$transaction(async (prisma) => {
      // 1. Update Quote details
      const quote = await prisma.quote.update({
        where: { id },
        data: {
          customerName,
          customerId,
          projectName,
          projectType,
          createdAt: createdAt ? new Date(createdAt) : undefined,
          expectedDays: expectedDays ? parseInt(expectedDays) : undefined,
          description,
          status,
          totalAmount,
          wonAmount:
            wonAmount !== undefined
              ? wonAmount
                ? parseFloat(wonAmount)
                : null
              : undefined, // Add
          paymentTerms, // Add
          validityDays: validityDays ? parseInt(validityDays) : undefined, // Add
          roleRates: roleRates !== undefined ? roleRates : undefined, // Add
          materials: materials !== undefined ? materials : undefined, // Add
        },
      });

      // 2. If items provided, replace them
      if (items && Array.isArray(items) && items.length > 0) {
        // Delete existing items
        await prisma.quoteItem.deleteMany({
          where: { quoteId: id },
        });

        // Create new items - only extract necessary fields
        await prisma.quoteItem.createMany({
          data: items.map((item) => ({
            quoteId: id,
            description: item.description || "",
            type: item.type || "service", // Add
            estimatedHours: item.estimatedHours
              ? parseFloat(item.estimatedHours)
              : 0,
            suggestedRole: item.suggestedRole || "",
            unit: item.unit || null, // Add
            hourlyRate: item.hourlyRate ? parseFloat(item.hourlyRate) : 0,
            amount: item.amount ? parseFloat(item.amount) : 0,
          })),
        });
      }

      return quote;
    });

    // Fetch complete result
    const result = await prisma.quote.findUnique({
      where: { id },
      include: {
        items: true,
        customer: true,
      },
    });

    return res.json(result);
  } catch (error) {
    console.error("Update quote error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update quote",
      error: error.message,
    });
  }
}

/**
 * Delete a quote
 * DELETE /api/quotes/:id
 */
export async function deleteQuote(req, res) {
  try {
    const { id } = req.params;
    const workspaceId = req.workspace?.id;

    // Verify ownership
    const existingQuote = await prisma.quote.findUnique({
      where: { id },
    });

    if (!existingQuote || existingQuote.workspaceId !== workspaceId) {
      return res.status(404).json({ message: "Quote not found" });
    }

    await prisma.quote.delete({
      where: { id },
    });

    return res.json({ success: true, message: "Quote deleted" });
  } catch (error) {
    console.error("Delete quote error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete quote",
    });
  }
}

/**
 * Export quote as a spreadsheet-friendly CSV file
 * POST /api/quotes/:id/export
 */
export async function exportQuote(req, res) {
  try {
    const { id } = req.params;
    const workspaceId = req.workspace?.id;
    const format = String(req.body?.format || "excel").trim().toLowerCase();
    const documentLanguage = req.body?.documentLanguage;

    if (!workspaceId) {
      return res
        .status(401)
        .json({ success: false, message: "Workspace not found" });
    }

    if (format !== "excel" && format !== "csv") {
      return res.status(400).json({
        success: false,
        message: "Unsupported export format",
      });
    }

    const quote = await prisma.quote.findUnique({
      where: { id },
      include: {
        items: true,
        customer: true,
      },
    });

    if (!quote || quote.workspaceId !== workspaceId) {
      return res
        .status(404)
        .json({ success: false, message: "Quote not found" });
    }

    const settings = await prisma.systemSettings.findUnique({
      where: { workspaceId },
    });

    const exportModel = buildQuoteExportModel({
      quote,
      settings,
      documentLanguage,
    });
    const filenameBase = exportModel.filenameBase;

    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

    if (format === "csv") {
      const csv = buildQuoteExportCsv(exportModel);
      const filename = `${filenameBase}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      );
      return res.status(200).send(csv);
    }

    const workbookBuffer = buildQuoteExportWorkbook(exportModel);
    const filename = `${filenameBase}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );

    return res.status(200).send(workbookBuffer);
  } catch (error) {
    console.error("Export quote error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to export quote",
      error: error.message,
    });
  }
}

/**
 * Generate quote document (PDF) — deducts credits
 * POST /api/quotes/:id/generate
 */
export async function generateQuote(req, res) {
  try {
    const { id } = req.params;
    const workspaceId = req.workspace?.id;
    const creditCost = 10;

    if (!workspaceId) {
      return res
        .status(401)
        .json({ success: false, message: "Workspace not found" });
    }

    // Verify quote belongs to this workspace
    const quote = await prisma.quote.findUnique({
      where: { id },
    });

    if (!quote || quote.workspaceId !== workspaceId) {
      return res
        .status(404)
        .json({ success: false, message: "Quote not found" });
    }

    // Check credit balance
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { creditBalance: true },
    });

    if (!workspace) {
      return res
        .status(404)
        .json({ success: false, message: "Workspace does not exist" });
    }

    if (workspace.creditBalance < creditCost) {
      return res.status(403).json({
        success: false,
        message: "Insufficient credits. Please top up your account.",
        errorCode: "INSUFFICIENT_CREDITS",
      });
    }

    // Deduct credits
    const updatedWorkspace = await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        creditBalance: {
          decrement: creditCost,
        },
      },
    });

    return res.json({
      success: true,
      remainingBalance: updatedWorkspace.creditBalance,
    });
  } catch (error) {
    console.error("Generate quote error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to generate quote",
      error: error.message,
    });
  }
}
