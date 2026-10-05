import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

/**
 * Run an Admin GraphQL request, retrying throttled and transient failures.
 *
 * Shopify answers a throttled request with HTTP 200, `data: null` and a
 * THROTTLED error in `errors`. Callers that only read `payload.data.<field>`
 * therefore see a throttled lookup as an empty result, which is how an import
 * in "update existing" mode ended up calling collectionCreate and failing with
 * "handle has already been taken". Retrying here means callers can trust that
 * a returned payload is a real answer.
 */
export async function graphqlRequest(
  admin: AdminApiContext,
  query: string,
  variables?: Record<string, unknown>,
  options: { attempts?: number; baseDelayMs?: number } = {}
): Promise<unknown> {
  const { attempts = 4, baseDelayMs = 1000 } = options;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await admin.graphql(query, variables ? { variables } : undefined);
      const payload = (await response.json()) as {
        errors?: Array<{ message?: string; extensions?: { code?: string } }>;
      };

      if (!isThrottled(payload)) return payload;
      lastError = new Error("Shopify throttled the request");
    } catch (err) {
      if (!isRetryable(err)) throw err;
      lastError = err;
    }

    if (attempt < attempts) await delay(baseDelayMs * 2 ** (attempt - 1));
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Shopify request failed after retries");
}

function isThrottled(payload: {
  errors?: Array<{ message?: string; extensions?: { code?: string } }>;
}): boolean {
  const errors = payload?.errors;
  if (!Array.isArray(errors)) return false;
  return errors.some(
    (e) => e.extensions?.code === "THROTTLED" || /throttled/i.test(e.message ?? "")
  );
}

/** Retry rate limits and server-side blips; fail fast on everything else. */
function isRetryable(err: unknown): boolean {
  const status = (err as { response?: { status?: number } })?.response?.status;
  if (status === 429 || (typeof status === "number" && status >= 500)) return true;

  const message = err instanceof Error ? err.message : String(err);
  return /throttle|rate limit|429|ETIMEDOUT|ECONNRESET|socket hang up|fetch failed/i.test(message);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
