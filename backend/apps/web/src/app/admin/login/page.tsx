"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, setToken } from "@/lib/api";

export default function AdminLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("owner@cutzbangs.local");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await api<{ token: string }>("/auth/login", { method: "POST", body: { email, password } });
      setToken(res.token);
      router.push("/admin/dashboard");
    } catch {
      setError("Invalid email or password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="container" style={{ padding: "64px 20px", maxWidth: 400 }}>
      <h1>Admin sign in</h1>
      <form onSubmit={login} className="card">
        <label>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="err">{error}</p>}
        <button className="btn" style={{ marginTop: 16, width: "100%" }} disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
