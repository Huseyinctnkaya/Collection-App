import dns from "node:dns/promises";
import { isPrivateAddress, validateFetchUrl } from "./url-safety";

const MAX_REDIRECTS = 3;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // same ceiling as an in-app upload

/**
 * Fetch a file from a URL supplied by an API caller.
 *
 * Every hop is re-checked, because a public URL is free to redirect to
 * localhost or to instance metadata, and the first check would never see it.
 * The body is counted as it arrives so an endless response cannot exhaust
 * memory — a plain `arrayBuffer()` on an attacker-chosen URL has no ceiling.
 *
 * Known limit: the host is resolved, checked, and then resolved again by
 * fetch, so a DNS entry that changes in between could still slip through
 * (DNS rebinding). Closing that needs the connection pinned to the address we
 * checked, which Node's fetch does not expose.
 */
export async function fetchRemoteFile(
  rawUrl: string,
  { maxBytes = DEFAULT_MAX_BYTES }: { maxBytes?: number } = {}
): Promise<Buffer> {
  let target = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const check = validateFetchUrl(target);
    if (!check.ok) throw new Error(check.error);

    await assertPublicHost(check.url.hostname);

    const response = await fetch(check.url, {
      redirect: "manual",
      headers: { "User-Agent": "collection-studio-importer/1.0" },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`Redirect from ${check.url.hostname} had no destination`);
      target = new URL(location, check.url).toString();
      continue;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await readCapped(response, maxBytes);
  }

  throw new Error(`Gave up after ${MAX_REDIRECTS} redirects`);
}

async function assertPublicHost(hostname: string): Promise<void> {
  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new Error(`Could not resolve ${hostname}`);
  }

  // Every address, not just the first: a host that resolves to one public and
  // one private address would otherwise be a way straight in.
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error(`${hostname} resolves to an address that is not public`);
  }
}

async function readCapped(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`File is larger than ${Math.floor(maxBytes / 1024 / 1024)}MB`);
  }

  if (!response.body) return Buffer.alloc(0);

  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new Error(`File is larger than ${Math.floor(maxBytes / 1024 / 1024)}MB`);
    }
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}
