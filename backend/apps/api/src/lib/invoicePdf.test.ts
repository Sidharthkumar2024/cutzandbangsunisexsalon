import { describe, expect, it } from "vitest";
import { renderInvoicePdf, type InvoicePdfData } from "./invoicePdf.js";

function fixture(items: InvoicePdfData["items"]): InvoicePdfData {
  const subtotalMinor = items.reduce((sum, item) => sum + item.qty * item.unitMinor, 0);
  const discountMinor = items.reduce((sum, item) => sum + (item.discountMinor ?? 0), 0);
  const taxMinor = items.reduce((sum, item) => sum + item.taxMinor, 0);
  return {
    number: "CB-2026-000042",
    issuedAt: new Date("2026-08-24T12:00:00.000Z"),
    salonName: "Cutz & Bangs - Sector 15 Dwarka",
    salonAddress: "First Floor, Plot No. 118, Main Kakrola Road, Patel Garden, Sector 15 Dwarka, New Delhi 110059",
    customerName: "A customer with a deliberately long display name",
    items,
    subtotalMinor,
    discountMinor,
    taxMinor,
    totalMinor: subtotalMinor - discountMinor + taxMinor,
    paidMinor: subtotalMinor - discountMinor + taxMinor,
    currency: "INR",
  };
}

function pageCount(buffer: Buffer) {
  return buffer.toString("latin1").match(/\/Type\s*\/Page\b/g)?.length ?? 0;
}

describe("invoice PDF", () => {
  it("renders a valid, branded single-page invoice with explicit summary space", async () => {
    const pdf = await renderInvoicePdf(fixture([
      {
        description: "Men Lotus Facial",
        qty: 1,
        unitMinor: 150_000,
        discountMinor: 0,
        taxMinor: 27_000,
        lineTotalMinor: 177_000,
        servedFor: "Walk-in",
      },
    ]));

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(2_500);
    expect(pageCount(pdf)).toBe(1);
  });

  it("paginates long descriptions and large carts without overflowing a page", async () => {
    const items = Array.from({ length: 36 }, (_, index) => ({
      description: `Premium colour correction and restorative treatment number ${index + 1} with an intentionally long service description`,
      qty: index % 3 === 0 ? 2 : 1,
      unitMinor: 249_900,
      discountMinor: index % 4 === 0 ? 49_900 : 0,
      taxMinor: 36_000,
      lineTotalMinor: index % 3 === 0 ? 485_900 : 286_000,
      servedFor: index % 2 === 0 ? "Primary customer" : "Family member with a long name",
    }));

    const pdf = await renderInvoicePdf(fixture(items));

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(10_000);
    expect(pageCount(pdf)).toBeGreaterThanOrEqual(3);
  });
});
