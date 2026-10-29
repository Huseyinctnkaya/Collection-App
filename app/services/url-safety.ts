/**
 * Deciding whether a URL supplied by an API caller is safe for the server to
 * fetch.
 *
 * The webhook import endpoint fetches whatever `fileUrl` it is given. Without
 * these checks that is a server-side request forgery primitive: the caller
 * cannot see the response body, but it can aim the server at addresses only
 * the server can reach — cloud instance metadata on 169.254.169.254, services
 * bound to localhost, other machines on the private network.
 *
 * Pure module: unit tested with bare `node --test`.
 */

export type UrlCheck = { ok: true; url: URL } | { ok: false; error: string };

/** Ports a public file would be served on. Anything else is someone probing. */
const ALLOWED_PORTS = new Set(["", "443"]);

export function validateFetchUrl(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "fileUrl is not a valid URL" };
  }

  // Plain http would also let a redirect downgrade the connection, and a
  // public file URL has no reason to be unencrypted.
  if (url.protocol !== "https:") {
    return { ok: false, error: "fileUrl must use https" };
  }

  if (!ALLOWED_PORTS.has(url.port)) {
    return { ok: false, error: "fileUrl must use the standard https port" };
  }

  if (!url.hostname || url.hostname.endsWith(".localhost") || url.hostname === "localhost") {
    return { ok: false, error: "fileUrl must point at a public host" };
  }

  return { ok: true, url };
}

/**
 * Addresses the server can reach but the public internet cannot.
 *
 * Covers loopback, private and carrier-grade NAT ranges, link-local — which is
 * where cloud instance metadata lives — plus multicast and reserved space.
 */
export function isPrivateAddress(address: string): boolean {
  const ip = address.trim().toLowerCase();
  if (!ip) return true;

  if (ip.includes(":")) return isPrivateIPv6(ip);
  return isPrivateIPv4(ip);
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return true;

  const octets = parts.map((p) => Number(p));
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return true;

  const [a, b] = octets;

  if (a === 0) return true; // "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast and reserved

  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, "");

  if (bare === "::" || bare === "::1") return true;

  // ::ffff:127.0.0.1 and friends are IPv4 wearing an IPv6 hat.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(bare);
  if (mapped) return isPrivateIPv4(mapped[1]);

  const first = bare.split(":")[0];
  if (!first) return true;

  const block = parseInt(first.padEnd(4, "0"), 16);
  if (Number.isNaN(block)) return true;

  if ((block & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((block & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((block & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local

  return false;
}
