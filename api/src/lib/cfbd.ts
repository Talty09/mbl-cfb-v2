/**
 * College Football Data API client.
 *
 * Used only by the ingest. There is no passthrough proxy: if a view could reach
 * CFBD, every page load would depend on a third party being up and fast, which
 * is the weakness this rearchitecture set out to remove.
 *
 * Every response is validated with zod at this boundary. CFBD's shapes have
 * shifted between seasons, and a silent shape change would corrupt scoring — far
 * worse than a loud failure in the cron log.
 */

import type { ZodType } from 'zod';
import type { Env } from '../types';

const BASE_URL = 'https://api.collegefootballdata.com';

export class CfbdError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'CfbdError';
  }
}

export type QueryParams = Record<string, string | number | boolean | undefined>;

/**
 * GET a CFBD endpoint and validate the body.
 *
 * Throws CfbdError on transport failure, a non-2xx status, or a schema mismatch —
 * the caller records it in `sync_state.last_error` so it surfaces in the UI
 * rather than vanishing.
 */
export async function cfbdGet<T>(
  env: Env,
  path: string,
  params: QueryParams,
  schema: ZodType<T>,
): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${env.CFBD_API_KEY}`,
        Accept: 'application/json',
      },
    });
  } catch (cause) {
    throw new CfbdError(`CFBD request to ${path} failed: ${String(cause)}`);
  }

  if (!response.ok) {
    throw new CfbdError(
      `CFBD ${path} returned ${response.status} ${response.statusText}`,
      response.status,
    );
  }

  const body: unknown = await response.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    // Include the first few issues; the full tree is too large for a log line
    // and the first mismatch is almost always the informative one.
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new CfbdError(`CFBD ${path} response did not match the expected shape — ${issues}`);
  }

  return parsed.data;
}
