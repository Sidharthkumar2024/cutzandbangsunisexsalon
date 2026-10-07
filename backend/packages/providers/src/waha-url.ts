import { isIP } from "node:net";

const LOCAL_WAHA_ORIGIN = "http://127.0.0.1:3000";

type WahaUrlValidation =
  | { ok: true; url: string }
  | { ok: false; error: string };

function parseOrigin(value: string): URL | undefined {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return undefined;
    if (url.username || url.password || url.hash || url.search) return undefined;
    if (url.pathname !== '/' && url.pathname !== '') return undefined;
    return url;
  } catch {
    return undefined;
  }
}

function ipv4Number(value: string) {
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return undefined;
  return (((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!) >>> 0;
}

function inIpv4Cidr(value: number, network: string, prefix: number) {
  const base = ipv4Number(network);
  if (base === undefined) return false;
  const mask = prefix === 0 ? 0 : (0xffff_ffff << (32 - prefix)) >>> 0;
  return (value & mask) === (base & mask);
}

/** True for addresses that must never be reached unless their exact origin is trusted. */
export function isRestrictedWahaHost(hostnameValue: string): boolean {
  const hostname = hostnameValue.toLowerCase().replace(/^\[|\]$/gu, '').replace(/\.$/u, '');
  if (
    hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
    || hostname.endsWith('.lan')
    || hostname === 'metadata.google.internal'
  ) return true;

  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    const value = ipv4Number(hostname)!;
    return [
      ['0.0.0.0', 8],
      ['10.0.0.0', 8],
      ['100.64.0.0', 10],
      ['127.0.0.0', 8],
      ['169.254.0.0', 16],
      ['172.16.0.0', 12],
      ['192.0.0.0', 24],
      ['192.0.2.0', 24],
      ['192.168.0.0', 16],
      ['198.18.0.0', 15],
      ['198.51.100.0', 24],
      ['203.0.113.0', 24],
      ['224.0.0.0', 4],
      ['240.0.0.0', 4],
    ].some(([network, prefix]) => inIpv4Cidr(value, String(network), Number(prefix)))
      || hostname === '100.100.100.200'
      || hostname === '168.63.129.16';
  }

  if (ipVersion === 6) {
    const normalized = hostname.toLowerCase();
    if (normalized === '::' || normalized === '::1' || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
    if (/^f[cd]/u.test(normalized) || normalized.startsWith('ff') || normalized.startsWith('2001:db8:') || normalized === 'fd00:ec2::254') return true;
    const mapped = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/u)?.[1];
    return mapped ? isRestrictedWahaHost(mapped) : false;
  }

  return false;
}

function configuredAllowedOrigins(env: NodeJS.ProcessEnv) {
  const raw = [LOCAL_WAHA_ORIGIN, env.WA_UNOFFICIAL_URL, ...(env.WAHA_ALLOWED_ORIGINS ?? '').split(',')];
  return new Set(raw.flatMap((entry) => {
    const url = entry?.trim() ? parseOrigin(entry.trim()) : undefined;
    return url ? [url.origin] : [];
  }));
}

/**
 * WAHA API receives the API key on every request, so an origin is usable only when
 * it is explicitly trusted. The local host endpoint is the sole built-in
 * development exception; deployments extend the exact-origin allowlist with
 * WAHA_ALLOWED_ORIGINS (or their trusted WA_UNOFFICIAL_URL).
 */
export function validateWahaBaseUrl(value: string, env: NodeJS.ProcessEnv = process.env): WahaUrlValidation {
  const url = parseOrigin(value.trim());
  if (!url) return { ok: false, error: 'waha_base_url_invalid' };

  const allowedOrigins = configuredAllowedOrigins(env);
  if (allowedOrigins.has(url.origin)) return { ok: true, url: url.origin };

  if (isRestrictedWahaHost(url.hostname)) {
    return { ok: false, error: 'waha_base_url_private_address_not_allowlisted' };
  }
  return { ok: false, error: 'waha_base_url_not_allowlisted' };
}

export function normalizeWahaBaseUrl(value: string, env: NodeJS.ProcessEnv = process.env) {
  const result = validateWahaBaseUrl(value, env);
  if (!result.ok) throw new Error(result.error);
  return result.url;
}
