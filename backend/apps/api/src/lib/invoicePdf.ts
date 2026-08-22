import PDFDocument from "pdfkit";

export interface InvoicePdfData {
  number: string;
  issuedAt: Date;
  salonName: string;
  salonAddress?: string;
  customerName?: string;
  items: { description: string; qty: number; unitMinor: number; discountMinor?: number; taxMinor: number; lineTotalMinor: number; servedFor?: string | null }[];
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

    doc.rect(0, 0, 595, 125).fill("#211d1a");
    doc.fillColor("#ffffff").font("Times-Bold").fontSize(25).text("CUTZ & BANGS", 50, 38, { characterSpacing: 2 });
    doc.font("Helvetica").fontSize(9).fillColor("#dbcfc4").text("UNISEX SALON · SECTOR 15 DWARKA", 50, 74, { characterSpacing: 1.5 });
    doc.fontSize(9).fillColor("#ffffff").text(data.salonName, 365, 38, { width: 180, align: "right" });
    if (data.salonAddress) doc.fontSize(8).fillColor("#dbcfc4").text(data.salonAddress, 325, 55, { width: 220, align: "right" });
    doc.y = 150;
    doc.moveDown();

    doc.fillColor("#6b3032").font("Times-Bold").fontSize(19).text(`Invoice ${data.number}`);
    doc.font("Helvetica");
    doc.fontSize(9).fillColor("#666").text(`Date: ${data.issuedAt.toLocaleDateString("en-IN")}`);
    if (data.customerName) doc.text(`Customer: ${data.customerName}`);
    doc.moveDown().fillColor("#000");

    // table header
    const top = doc.y;
    doc.fontSize(10);
    doc.rect(50, top - 6, 495, 25).fill("#f4ede6");
    doc.fillColor("#4f2527").text("Service / product", 58, top);
    doc.text("Qty", 285, top);
    doc.text("List price", 330, top);
    doc.text("Covered", 410, top);
    doc.text("Payable", 475, top);
    doc.moveDown(0.5);

    for (const it of data.items) {
      const y = doc.y;
      doc.fillColor("#28231f").font("Helvetica-Bold").text(it.description, 58, y, { width: 215 });
      if (it.servedFor) doc.font("Helvetica").fontSize(8).fillColor("#766c64").text(`For: ${it.servedFor}`, 58, y + 13, { width: 215 });
      doc.font("Helvetica").fontSize(9).fillColor("#28231f").text(String(it.qty), 285, y);
      doc.text(money(it.unitMinor, cur), 330, y);
      doc.fillColor("#56805a").text(it.discountMinor ? `−${money(it.discountMinor, cur)}` : "—", 410, y);
      doc.fillColor("#28231f").text(money(it.lineTotalMinor, cur), 475, y);
      doc.y = Math.max(doc.y, y + (it.servedFor ? 30 : 22));
    }

    doc.moveDown();
    const label = (t: string, v: number) => doc.text(`${t}: ${money(v, cur)}`, { align: "right" });
    label("Subtotal", data.subtotalMinor);
    if (data.discountMinor) label("Discount", -data.discountMinor);
    label("Tax", data.taxMinor);
    doc.fontSize(12);
    label("Total", data.totalMinor);
    doc.fontSize(10).fillColor("#56805a").text(`Paid: ${money(data.paidMinor, cur)}`, { align: "right" });
    const due = data.totalMinor - data.paidMinor;
    if (due > 0) doc.fillColor("#c00").text(`Balance due: ${money(due, cur)}`, { align: "right" });

    doc.moveDown(2).fillColor("#766c64").fontSize(9).text("Thank you for choosing Cutz & Bangs. Package-covered services retain their full list price above; only the covered amount is deducted from the payable bill.", { align: "center" });
    doc.end();
  });
}
