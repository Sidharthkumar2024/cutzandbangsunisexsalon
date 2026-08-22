import { API_BASE, money } from "@/lib/api";
import Link from "next/link";

interface Service { id: string; name: string; durationMin: number; priceMinor: number; }
interface Category { id: string; name: string; gender: string | null; services: Service[]; }

async function getServices(): Promise<Category[]> {
  try {
    const res = await fetch(`${API_BASE}/services`, { cache: "no-store" });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export default async function ServicesPage() {
  const categories = await getServices();
  return (
    <main className="container" style={{ padding: "40px 20px" }}>
      <h1>Services &amp; Pricing</h1>
      {categories.length === 0 && <p className="muted">No services published yet.</p>}
      {categories.map((cat) => (
        <div key={cat.id} style={{ marginTop: 28 }}>
          <h3>{cat.name} {cat.gender && <span className="tag">{cat.gender}</span>}</h3>
          <div className="card" style={{ padding: 0 }}>
            <table>
              <tbody>
                {cat.services.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td className="muted">{s.durationMin} min</td>
                    <td style={{ fontWeight: 600 }}>{money(s.priceMinor)}</td>
                    <td style={{ textAlign: "right" }}>
                      <Link href={`/book?service=${s.id}`} className="btn secondary">Book</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </main>
  );
}
