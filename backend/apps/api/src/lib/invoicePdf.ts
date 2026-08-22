import PDFDocument from "pdfkit";

export interface InvoicePdfData {
  number: string;
  issuedAt: Date;
  salonName: string;
  salonAddress?: string;
  customerName?: string;
  items: { description: string; qty: number; unitMinor: number; taxMinor: number; lineTotalMinor: number }[];
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  paidMinor: number;
  currency?: string;
}

const money = (minor: number, cur = "INR") =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: cur }).format(minor / 100);

/** Render a branded invoice PDF to a Buffer (for storage + email attachment). */
export function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const cur = data.currency ?? "INR";

    doc.fontSize(20).text(data.salonName, { continued: false });
    if (data.salonAddress) doc.fontSize(9).fillColor("#666").text(data.salonAddress);
    doc.moveDown();

    doc.fillColor("#000").fontSize(12).text(`Invoice ${data.number}`);
    doc.fontSize(9).fillColor("#666").text(`Date: ${data.issuedAt.toLocaleDateString("en-IN")}`);
    if (data.customerName) doc.text(`Customer: ${data.customerName}`);
    doc.moveDown().fillColor("#000");

    // table header
    const top = doc.y;
    doc.fontSize(10);
    doc.text("Item", 50, top);
    doc.text("Qty", 300, top);
    doc.text("Rate", 350, top);
    doc.text("Total", 450, top);
    doc.moveTo(50, doc.y + 2).lineTo(545, doc.y + 2).stroke();
    doc.moveDown(0.5);

    for (const it of data.items) {
      const y = doc.y;
      doc.text(it.description, 50, y, { width: 240 });
      doc.text(String(it.qty), 300, y);
      doc.text(money(it.unitMinor, cur), 350, y);
      doc.text(money(it.lineTotalMinor, cur), 450, y);
      doc.moveDown(0.5);
    }

    doc.moveDown();
    const label = (t: string, v: number) => doc.text(`${t}: ${money(v, cur)}`, { align: "right" });
    label("Subtotal", data.subtotalMinor);
    if (data.discountMinor) label("Discount", -data.discountMinor);
    label("Tax", data.taxMinor);
    doc.fontSize(12);
    label("Total", data.totalMinor);
    doc.fontSize(10).fillColor("#0a7").text(`Paid: ${money(data.paidMinor, cur)}`, { align: "right" });
    const due = data.totalMinor - data.paidMinor;
    if (due > 0) doc.fillColor("#c00").text(`Balance due: ${money(due, cur)}`, { align: "right" });

    doc.end();
  });
}
