import { describe, expect, it } from "vitest";
import { assertHistoricalCsvRowCounts, assertHistoricalImportSize, expenseImportLineKey, normalizeBusinessDate, parseHistoricalCsv, parseHistoricalCsvPair } from "./historical-import.js";

describe("historical register import", () => {
  it("normalizes Indian register dates", () => {
    expect(normalizeBusinessDate("8/Jul/26".replace("Jul", "07"))).toBe("2026-07-08");
    expect(normalizeBusinessDate("2026-08-22")).toBe("2026-08-22");
  });

  it("groups repeated CSV dates and converts rupees to minor units", () => {
    const days = parseHistoricalCsv([
      { date: "22/08/26", opening_cash: "1990", cash: "50", upi: "8000", total_sale: "8050", expense: "Milk", amount: "36" },
      { date: "22/08/26", expense: "Tissue paper", amount: "280" },
    ]);
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ openingCashMinor: 199_000, totalSalesMinor: 805_000 });
    expect(days[0].expenses.map((expense) => expense.amountMinor)).toEqual([3_600, 28_000]);
  });

  it("generates stable fallback line keys", () => {
    const expense = { category: "Daily", description: "Milk", amountMinor: 3600, paymentMethod: "CASH" as const };
    expect(expenseImportLineKey(expense, 0)).toBe(expenseImportLineKey(expense, 0));
    expect(expenseImportLineKey(expense, 0)).not.toBe(expenseImportLineKey(expense, 1));
  });

  it("joins the exported daily and expense CSV shapes", () => {
    const days = parseHistoricalCsvPair(
      [{ date: "2026-08-22", opening_cash_reported: "1990", cash_sales: "50", upi_sales: "8000", total_sales_reported: "8050", available_cash_reported: "1494", source_file: "page.jpg", review_required: "false" }],
      [{ date: "2026-08-22", description: "Milk", amount: "36", payment_method: "cash", source_file: "page.jpg", review_required: "false" }],
    );
    expect(days[0]).toMatchObject({ openingCashMinor: 199000, totalSalesMinor: 805000, availableCashMinor: 149400, sourceRef: "page.jpg" });
    expect(days[0].expenses[0]).toMatchObject({ description: "Milk", amountMinor: 3600, paymentMethod: "CASH" });
  });

  it("skips rows that still require human review and rejects missing amounts", () => {
    expect(parseHistoricalCsvPair([{ date: "2026-08-22", review_required: "true" }], [])).toEqual([]);
    expect(() => parseHistoricalCsvPair([{ date: "2026-08-22", review_required: "false" }], [{ date: "2026-08-22", description: "Unknown", review_required: "false" }])).toThrow("expense_row_2_amount_required");
  });

  it("keeps a verified expense without manufacturing sales for a flagged day", () => {
    const days = parseHistoricalCsvPair(
      [{ date: "2026-08-22", total_sales_reported: "8050", review_required: "true", review_note: "unclear total" }],
      [{ date: "2026-08-22", description: "Milk", amount: "36", payment_method: "cash", review_required: "false" }],
    );
    expect(days[0]).toMatchObject({ businessDate: "2026-08-22", reviewRequired: true });
    expect(days[0]).not.toHaveProperty("totalSalesMinor");
    expect(days[0].expenses[0]).toMatchObject({ description: "Milk", amountMinor: 3600, reviewRequired: false });
  });

  it("caps CSV-derived days and expenses before a transaction", () => {
    const day = { businessDate: "2026-08-22", expenses: [] };
    expect(() => assertHistoricalImportSize(Array.from({ length: 501 }, () => day))).toThrow("historical_import_day_limit_500");
    expect(() => assertHistoricalImportSize([{ ...day, expenses: Array.from({ length: 201 }, (_, index) => ({ category: "Daily", description: `Expense ${index}`, amountMinor: 100, paymentMethod: "CASH" as const })) }])).toThrow("historical_import_expenses_per_day_limit_200");
    expect(() => assertHistoricalCsvRowCounts(501, 0)).toThrow("historical_import_daily_csv_row_limit_500");
    expect(() => assertHistoricalCsvRowCounts(500, 5001)).toThrow("historical_import_expense_csv_row_limit_5000");
  });
});
