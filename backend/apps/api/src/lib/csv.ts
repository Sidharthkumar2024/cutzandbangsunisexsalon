// Minimal RFC-4180-ish CSV parser (no dependency) for customer import.
// Handles quoted fields, embedded commas, and escaped quotes.

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      if (field !== "" || row.length) { row.push(field); rows.push(row); row = []; field = ""; }
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }

  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => (obj[h] = (r[idx] ?? "").trim()));
    return obj;
  });
}

/** Normalize a phone to a dedupe key (digits only, last 10). */
export function phoneKey(phone?: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits || null;
}
