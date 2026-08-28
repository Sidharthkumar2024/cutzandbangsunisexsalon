import PDFDocument from "pdfkit";

export interface InvoicePdfData {
  number: string;
  issuedAt: Date;
  salonName: string;
  salonAddress?: string;
  customerName?: string;
  items: {
    description: string;
    qty: number;
    unitMinor: number;
    discountMinor?: number;
    taxMinor: number;
    lineTotalMinor: number;
    servedFor?: string | null;
  }[];
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  paidMinor: number;
  currency?: string;
}

const BRAND = {
  ink: "#211d1a",
  wine: "#6b3032",
  wineDark: "#4f2527",
  muted: "#766c64",
  line: "#ded4ca",
  sand: "#f4ede6",
  sandAlt: "#fbf8f5",
  green: "#56805a",
  white: "#ffffff",
};

const PAGE = {
  width: 595.28,
  left: 42,
  right: 553.28,
  footerTop: 802,
};

const COLUMNS = {
  description: { x: 50, width: 205 },
  qty: { x: 260, width: 34 },
  list: { x: 299, width: 76 },
  covered: { x: 380, width: 76 },
  payable: { x: 461, width: 84 },
};

const money = (minor: number, cur = "INR") => {
  const value = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
  // PDFKit's built-in Helvetica font does not include the Indian rupee glyph;
  // "Rs" stays readable in print, browser previews, and email attachments.
  return cur === "INR" ? `Rs ${value}` : `${cur} ${value}`;
};

function drawBrandHeader(doc: PDFKit.PDFDocument, data: InvoicePdfData) {
  doc.rect(0, 0, PAGE.width, 122).fill(BRAND.ink);
  doc.fillColor(BRAND.white).font("Times-Bold").fontSize(25).text("CUTZ & BANGS", PAGE.left, 34, {
    width: 250,
    characterSpacing: 2,
  });
  doc.font("Helvetica").fontSize(8.5).fillColor("#dbcfc4").text("UNISEX SALON · SECTOR 15 DWARKA", PAGE.left, 72, {
    width: 270,
    characterSpacing: 1.25,
  });
  doc.font("Helvetica-Bold").fontSize(10).fillColor(BRAND.white).text(data.salonName, 320, 32, {
    width: 233,
    align: "right",
  });
  if (data.salonAddress) {
    doc.font("Helvetica").fontSize(8).fillColor("#dbcfc4").text(data.salonAddress, 318, 51, {
      width: 235,
      height: 48,
      align: "right",
      lineGap: 1,
      ellipsis: true,
    });
  }
}

function drawContinuationHeader(doc: PDFKit.PDFDocument, data: InvoicePdfData) {
  doc.fillColor(BRAND.wine).font("Times-Bold").fontSize(13).text("CUTZ & BANGS", PAGE.left, 35, { width: 210 });
  doc.fillColor(BRAND.muted).font("Helvetica").fontSize(8).text(`Invoice ${data.number} · continued`, 300, 39, {
    width: PAGE.right - 300,
    align: "right",
  });
  doc.moveTo(PAGE.left, 58).lineTo(PAGE.right, 58).lineWidth(0.75).strokeColor(BRAND.line).stroke();
}

function drawInvoiceMeta(doc: PDFKit.PDFDocument, data: InvoicePdfData) {
  const y = 146;
  doc.roundedRect(PAGE.left, y, PAGE.right - PAGE.left, 67, 5).fillAndStroke(BRAND.sandAlt, BRAND.line);
  doc.fillColor(BRAND.wine).font("Times-Bold").fontSize(19).text(`Invoice ${data.number}`, 55, y + 13, {
    width: 300,
  });
  doc.fillColor(BRAND.muted).font("Helvetica").fontSize(8.5).text(
    `Issued ${data.issuedAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`,
    55,
    y + 40,
    { width: 245 },
  );
  doc.fillColor(BRAND.muted).font("Helvetica").fontSize(8).text("BILLED TO", 365, y + 13, {
    width: 174,
    align: "right",
    characterSpacing: 0.8,
  });
  doc.fillColor(BRAND.ink).font("Helvetica-Bold").fontSize(10).text(data.customerName?.trim() || "Walk-in customer", 345, y + 31, {
    width: 194,
    align: "right",
    height: 25,
    ellipsis: true,
  });
}

function drawTableHeader(doc: PDFKit.PDFDocument, y: number) {
  doc.rect(PAGE.left, y, PAGE.right - PAGE.left, 29).fill(BRAND.sand);
  doc.fillColor(BRAND.wineDark).font("Helvetica-Bold").fontSize(8.2);
  doc.text("SERVICE / PRODUCT", COLUMNS.description.x, y + 10, { width: COLUMNS.description.width });
  doc.text("QTY", COLUMNS.qty.x, y + 10, { width: COLUMNS.qty.width, align: "center" });
  doc.text("LIST AMOUNT", COLUMNS.list.x, y + 10, { width: COLUMNS.list.width, align: "right" });
  doc.text("COVERED", COLUMNS.covered.x, y + 10, { width: COLUMNS.covered.width, align: "right" });
  doc.text("PAYABLE", COLUMNS.payable.x, y + 10, { width: COLUMNS.payable.width, align: "right" });
  return y + 29;
}

function drawSummaryRow(doc: PDFKit.PDFDocument, y: number, label: string, value: string, options?: { strong?: boolean; color?: string }) {
  const font = options?.strong ? "Helvetica-Bold" : "Helvetica";
  const size = options?.strong ? 11.5 : 9.5;
  const color = options?.color ?? BRAND.ink;
  doc.fillColor(color).font(font).fontSize(size).text(label, 350, y, { width: 88, align: "right" });
  doc.text(value, 446, y, { width: 99, align: "right" });
  return y + (options?.strong ? 20 : 16);
}

/** Render a branded invoice PDF to a Buffer (for storage + email attachment). */
export function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: PAGE.left, right: PAGE.left, bottom: 18, left: PAGE.left },
      bufferPages: true,
      autoFirstPage: true,
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const cur = data.currency ?? "INR";
    drawBrandHeader(doc, data);
    drawInvoiceMeta(doc, data);

    let y = drawTableHeader(doc, 231);
    data.items.forEach((item, index) => {
      doc.font("Helvetica-Bold").fontSize(9.5);
      const descriptionHeight = doc.heightOfString(item.description, { width: COLUMNS.description.width, lineGap: 1 });
      doc.font("Helvetica").fontSize(7.5);
      const servedForHeight = item.servedFor
        ? doc.heightOfString(`For: ${item.servedFor}`, { width: COLUMNS.description.width, lineGap: 1 })
        : 0;
      const rowHeight = Math.max(38, 14 + descriptionHeight + (servedForHeight ? servedForHeight + 4 : 0));

      if (y + rowHeight > PAGE.footerTop - 24) {
        doc.addPage();
        drawContinuationHeader(doc, data);
        y = drawTableHeader(doc, 70);
      }

      if (index % 2 === 1) doc.rect(PAGE.left, y, PAGE.right - PAGE.left, rowHeight).fill(BRAND.sandAlt);
      doc.moveTo(PAGE.left, y + rowHeight).lineTo(PAGE.right, y + rowHeight).lineWidth(0.45).strokeColor(BRAND.line).stroke();

      const textY = y + 9;
      doc.fillColor(BRAND.ink).font("Helvetica-Bold").fontSize(9.5).text(item.description, COLUMNS.description.x, textY, {
        width: COLUMNS.description.width,
        lineGap: 1,
      });
      if (item.servedFor) {
        doc.fillColor(BRAND.muted).font("Helvetica").fontSize(7.5).text(`For: ${item.servedFor}`, COLUMNS.description.x, textY + descriptionHeight + 3, {
          width: COLUMNS.description.width,
          lineGap: 1,
        });
      }
      doc.fillColor(BRAND.ink).font("Helvetica").fontSize(8.5);
      doc.text(String(item.qty), COLUMNS.qty.x, textY, { width: COLUMNS.qty.width, align: "center" });
      doc.text(money(item.qty * item.unitMinor, cur), COLUMNS.list.x, textY, { width: COLUMNS.list.width, align: "right" });
      doc.fillColor(BRAND.green).text(item.discountMinor ? `-${money(item.discountMinor, cur)}` : "—", COLUMNS.covered.x, textY, {
        width: COLUMNS.covered.width,
        align: "right",
      });
      doc.fillColor(BRAND.ink).font("Helvetica-Bold").text(money(item.lineTotalMinor, cur), COLUMNS.payable.x, textY, {
        width: COLUMNS.payable.width,
        align: "right",
      });
      y += rowHeight;
    });

    const summaryHeight = data.discountMinor ? 150 : 134;
    if (y + summaryHeight > PAGE.footerTop - 16) {
      doc.addPage();
      drawContinuationHeader(doc, data);
      y = 78;
    } else {
      y += 17;
    }

    doc.moveTo(340, y).lineTo(PAGE.right, y).lineWidth(0.75).strokeColor(BRAND.line).stroke();
    y += 13;
    y = drawSummaryRow(doc, y, "Subtotal", money(data.subtotalMinor, cur));
    if (data.discountMinor) y = drawSummaryRow(doc, y, "Discount", `-${money(data.discountMinor, cur)}`, { color: BRAND.green });
    y = drawSummaryRow(doc, y + 2, "Total", money(data.totalMinor, cur), { strong: true });
    y = drawSummaryRow(doc, y, "Paid", money(data.paidMinor, cur), { color: BRAND.green });
    const due = Math.max(0, data.totalMinor - data.paidMinor);
    y = drawSummaryRow(doc, y, "Balance due", money(due, cur), { strong: due > 0, color: due > 0 ? BRAND.wine : BRAND.muted });

    const noteY = Math.max(y + 12, 642);
    if (noteY + 80 > PAGE.footerTop) {
      doc.addPage();
      drawContinuationHeader(doc, data);
      y = 80;
    } else {
      y = noteY;
    }
    doc.roundedRect(PAGE.left, y, PAGE.right - PAGE.left, 58, 5).fillAndStroke(BRAND.sandAlt, BRAND.line);
    doc.fillColor(BRAND.wineDark).font("Helvetica-Bold").fontSize(9).text("THANK YOU FOR VISITING CUTZ & BANGS", 56, y + 12, {
      width: PAGE.right - 68,
      align: "center",
    });
    doc.fillColor(BRAND.muted).font("Helvetica").fontSize(8).text(
      "Package-covered services retain their full list amount above. Only the covered amount is deducted from the payable bill.",
      70,
      y + 31,
      { width: PAGE.right - 98, align: "center", lineGap: 1 },
    );

    const pages = doc.bufferedPageRange();
    for (let pageIndex = pages.start; pageIndex < pages.start + pages.count; pageIndex += 1) {
      doc.switchToPage(pageIndex);
      doc.moveTo(PAGE.left, PAGE.footerTop).lineTo(PAGE.right, PAGE.footerTop).lineWidth(0.5).strokeColor(BRAND.line).stroke();
      doc.fillColor(BRAND.muted).font("Helvetica").fontSize(7.5).text(
        "Cutz & Bangs Unisex Salon · Sector 15 Dwarka, New Delhi",
        PAGE.left,
        PAGE.footerTop + 10,
        { width: 350 },
      );
      doc.text(`Page ${pageIndex - pages.start + 1} of ${pages.count}`, 430, PAGE.footerTop + 10, {
        width: PAGE.right - 430,
        align: "right",
      });
    }

    doc.end();
  });
}
