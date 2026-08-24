import { createHash } from "node:crypto";
import { parseMoneyMinor } from "../workforce/import.js";

export type HistoricalExpenseInput = {
  lineKey?: string;
  category: string;
  description: string;
  amountMinor: number;
  paymentMethod: "CASH" | "UPI" | "CARD";
  vendorName?: string;
  notes?: string;
  reviewRequired?: boolean;
  reviewNote?: string;
};

export type HistoricalDayInput = {
  businessDate: string;
  openingCashMinor?: number;
  cashSalesMinor?: number;
  upiSalesMinor?: number;
  cardSalesMinor?: number;
  totalSalesMinor?: number;
  availableCashMinor?: number;
  cashAdjustmentMinor?: number;
  reviewRequired?: boolean;
  reviewNote?: string;
  notes?: string;
  sourceRef?: string;
  expenses: HistoricalExpenseInput[];
};

export const HISTORICAL_IMPORT_MAX_DAYS = 500;
export const HISTORICAL_IMPORT_MAX_EXPENSES = 5_000;
export const HISTORICAL_IMPORT_MAX_EXPENSES_PER_DAY = 200;

export function assertHistoricalCsvRowCounts(dailyRows: number, expenseRows = 0, combined = false) {
  if (combined) {
    if (dailyRows > HISTORICAL_IMPORT_MAX_DAYS + HISTORICAL_IMPORT_MAX_EXPENSES) {
      throw new Error(`historical_import_csv_row_limit_${HISTORICAL_IMPORT_MAX_DAYS + HISTORICAL_IMPORT_MAX_EXPENSES}`);
    }
    return;
  }
  if (dailyRows > HISTORICAL_IMPORT_MAX_DAYS) throw new Error(`historical_import_daily_csv_row_limit_${HISTORICAL_IMPORT_MAX_DAYS}`);
  if (expenseRows > HISTORICAL_IMPORT_MAX_EXPENSES) throw new Error(`historical_import_expense_csv_row_limit_${HISTORICAL_IMPORT_MAX_EXPENSES}`);
}

export function assertHistoricalImportSize(days: HistoricalDayInput[]) {
  if (days.length > HISTORICAL_IMPORT_MAX_DAYS) throw new Error(`historical_import_day_limit_${HISTORICAL_IMPORT_MAX_DAYS}`);
  const expenseCount = days.reduce((sum, day) => sum + day.expenses.length, 0);
  if (expenseCount > HISTORICAL_IMPORT_MAX_EXPENSES) throw new Error(`historical_import_expense_limit_${HISTORICAL_IMPORT_MAX_EXPENSES}`);
  if (days.some((day) => day.expenses.length > HISTORICAL_IMPORT_MAX_EXPENSES_PER_DAY)) {
    throw new Error(`historical_import_expenses_per_day_limit_${HISTORICAL_IMPORT_MAX_EXPENSES_PER_DAY}`);
  }
}

const cleanKey = (value: string) => value.toLowerCase().replace(/[\s_-]+/g, "");
const rowValue = (row: Record<string, string>, ...keys: string[]) => {
  const normalized = Object.fromEntries(Object.entries(row).map(([key, value]) => [cleanKey(key), value]));
  for (const key of keys) {
    const value = normalized[cleanKey(key)]?.trim();
    if (value) return value;
  }
  return undefined;
};

function truthyCsv(value: string | undefined) {
  return Boolean(value && ["1", "true", "yes", "y"].includes(value.trim().toLowerCase()));
}

function assertReviewedRow(row: Record<string, string>, rowNumber: number, kind: string) {
  if (truthyCsv(rowValue(row, "reviewRequired"))) throw new Error(`${kind}_row_${rowNumber}_requires_review`);
}

export function normalizeBusinessDate(value: string) {
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/u.test(text)) {
    const date = new Date(`${text}T00:00:00Z`);
    if (date.toISOString().slice(0, 10) === text) return text;
  }
  const match = text.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/u);
  if (!match) throw new Error("invalid_business_date");
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  const month = Number(match[2]);
  const day = Number(match[1]);
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (parsed.toISOString().slice(0, 10) !== iso) throw new Error("invalid_business_date");
  return iso;
}

function minorFromCsv(row: Record<string, string>, minorKeys: string[], rupeeKeys: string[]) {
  const minor = rowValue(row, ...minorKeys);
  if (minor !== undefined) return parseMoneyMinor(minor, true);
  return parseMoneyMinor(rowValue(row, ...rupeeKeys));
}

export function expenseImportLineKey(expense: HistoricalExpenseInput, index: number) {
  if (expense.lineKey?.trim()) return expense.lineKey.trim();
  return createHash("sha256").update(JSON.stringify({
    category: expense.category.trim().toLowerCase(),
    description: expense.description.trim().toLowerCase(),
    amountMinor: expense.amountMinor,
    paymentMethod: expense.paymentMethod,
    vendorName: expense.vendorName?.trim().toLowerCase() ?? "",
    index,
  })).digest("hex").slice(0, 32);
}

/**
 * CSV format: one or more rows per business date. Daily total columns may be
 * repeated or only populated on the first row; each populated expense column
 * creates one expense line for that date.
 */
export function parseHistoricalCsv(rows: Record<string, string>[]): HistoricalDayInput[] {
  const byDate = new Map<string, HistoricalDayInput>();
  for (const [rowIndex, row] of rows.entries()) {
    assertReviewedRow(row, rowIndex + 2, "historical");
    const rawDate = rowValue(row, "businessDate", "date");
    if (!rawDate) throw new Error("business_date_required");
    const businessDate = normalizeBusinessDate(rawDate);
    const existing = byDate.get(businessDate) ?? {
      businessDate,
      expenses: [],
    };
    const assignWhenPresent = (field: "openingCashMinor" | "cashSalesMinor" | "upiSalesMinor" | "cardSalesMinor" | "totalSalesMinor" | "availableCashMinor" | "cashAdjustmentMinor", minorKeys: string[], rupeeKeys: string[]) => {
      if (rowValue(row, ...minorKeys, ...rupeeKeys) !== undefined) existing[field] = minorFromCsv(row, minorKeys, rupeeKeys);
    };
    assignWhenPresent("openingCashMinor", ["openingCashMinor"], ["openingCash", "openingBalance", "openingCashReported"]);
    assignWhenPresent("cashSalesMinor", ["cashSalesMinor"], ["cashSales", "cash"]);
    assignWhenPresent("upiSalesMinor", ["upiSalesMinor"], ["upiSales", "upi"]);
    assignWhenPresent("cardSalesMinor", ["cardSalesMinor"], ["cardSales", "card"]);
    assignWhenPresent("totalSalesMinor", ["totalSalesMinor"], ["totalSales", "totalSale", "totalSalesReported"]);
    assignWhenPresent("availableCashMinor", ["availableCashMinor"], ["availableCash", "availableBalance", "availableCashReported"]);
    assignWhenPresent("cashAdjustmentMinor", ["cashAdjustmentMinor"], ["cashAdjustment"]);
    existing.notes = rowValue(row, "notes", "dailyNotes", "reviewNote") ?? existing.notes;
    existing.sourceRef = rowValue(row, "sourceRef", "image", "page", "sourceFile") ?? existing.sourceRef;

    const description = rowValue(row, "expenseDescription", "expense", "description");
    const expenseAmount = rowValue(row, "expenseAmountMinor", "expenseAmount", "amount");
    if (description || expenseAmount) {
      if (!description || !expenseAmount) throw new Error("expense_description_and_amount_required_together");
      const rawMethod = (rowValue(row, "expensePaymentMethod", "paymentMethod") ?? "CASH").toUpperCase();
      if (!(["CASH", "UPI", "CARD"] as string[]).includes(rawMethod)) throw new Error("invalid_expense_payment_method");
      existing.expenses.push({
        lineKey: rowValue(row, "expenseLineKey", "lineKey"),
        category: rowValue(row, "expenseCategory", "category") ?? "Daily expense",
        description,
        amountMinor: rowValue(row, "expenseAmountMinor") ? parseMoneyMinor(expenseAmount, true) : parseMoneyMinor(expenseAmount),
        paymentMethod: rawMethod as HistoricalExpenseInput["paymentMethod"],
        vendorName: rowValue(row, "vendorName", "vendor", "givenBy"),
        notes: rowValue(row, "expenseNotes"),
      });
    }
    byDate.set(businessDate, existing);
  }
  return [...byDate.values()].sort((a, b) => a.businessDate.localeCompare(b.businessDate));
}

/** Strict two-file format used by the verified register workbook exporter. */
export function parseHistoricalCsvPair(dailyRows: Record<string, string>[], expenseRows: Record<string, string>[]) {
  const reviewedDailyRows = dailyRows.filter((row) => !truthyCsv(rowValue(row, "reviewRequired")));
  const days = parseHistoricalCsv(reviewedDailyRows);
  const byDate = new Map(days.map((day) => [day.businessDate, day]));
  expenseRows.forEach((row, index) => {
    if (truthyCsv(rowValue(row, "reviewRequired"))) return;
    const rawDate = rowValue(row, "businessDate", "date");
    if (!rawDate) throw new Error(`expense_row_${index + 2}_business_date_required`);
    const businessDate = normalizeBusinessDate(rawDate);
    let day = byDate.get(businessDate);
    if (!day) {
      const dailySource = dailyRows.find((candidate) => rowValue(candidate, "date", "businessDate") === rawDate);
      day = {
        businessDate,
        sourceRef: rowValue(dailySource ?? row, "sourceFile"),
        reviewRequired: true,
        reviewNote: rowValue(dailySource ?? row, "reviewNote") ?? "Daily totals were not verified; only verified expense lines were imported.",
        expenses: [],
      };
      byDate.set(businessDate, day);
      days.push(day);
    }
    const description = rowValue(row, "description", "expenseDescription", "expense");
    const rawAmount = rowValue(row, "amount", "expenseAmount");
    const rawAmountMinor = rowValue(row, "amountMinor", "expenseAmountMinor");
    if (!description) throw new Error(`expense_row_${index + 2}_description_required`);
    if (rawAmount === undefined && rawAmountMinor === undefined) throw new Error(`expense_row_${index + 2}_amount_required`);
    const methodValue = rowValue(row, "paymentMethod", "expensePaymentMethod");
    const rawMethod = (methodValue ?? "CASH").toUpperCase();
    const paymentMethod = (["CASH", "UPI", "CARD"] as string[]).includes(rawMethod) ? rawMethod as HistoricalExpenseInput["paymentMethod"] : "CASH";
    day.expenses.push({
      lineKey: rowValue(row, "lineKey", "expenseLineKey") ?? `${businessDate}:${index + 2}`,
      category: rowValue(row, "category", "expenseCategory") ?? "Daily expense",
      description,
      amountMinor: rawAmountMinor !== undefined ? parseMoneyMinor(rawAmountMinor, true) : parseMoneyMinor(rawAmount),
      paymentMethod,
      vendorName: rowValue(row, "vendorName", "vendor", "givenBy") ?? (methodValue && paymentMethod === "CASH" && rawMethod !== "CASH" ? methodValue.replace(/^given by\s*/iu, "").trim() : undefined),
      notes: [rowValue(row, "reviewNote"), rowValue(row, "sourceFile"), methodValue && rawMethod !== paymentMethod ? `Register note: ${methodValue}` : undefined].filter(Boolean).join(" · ") || undefined,
      reviewRequired: false,
      reviewNote: rowValue(row, "reviewNote"),
    });
  });
  return days.sort((a, b) => a.businessDate.localeCompare(b.businessDate));
}
