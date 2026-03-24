/**
 * Buildium API Client — server-side only.
 *
 * Auth: x-buildium-client-id + x-buildium-client-secret headers (API key auth, no OAuth).
 * Base URL: https://api.buildium.com/v1 (production), https://apisandbox.buildium.com/v1 (sandbox).
 * Pagination: offset + limit (max 1000). Total count in X-Total-Count header.
 * Rate limit: 10 concurrent req/sec.
 *
 * Source: https://developer.buildium.com/
 */

export interface BuildiumCredentials {
  clientId: string;
  clientSecret: string;
  environment: "production" | "sandbox";
}

const BASE_URLS = {
  production: "https://api.buildium.com/v1",
  sandbox: "https://apisandbox.buildium.com/v1",
} as const;

export class BuildiumClient {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(creds: BuildiumCredentials) {
    this.baseUrl = BASE_URLS[creds.environment];
    this.headers = {
      "x-buildium-client-id": creds.clientId,
      "x-buildium-client-secret": creds.clientSecret,
      "Content-Type": "application/json",
    };
  }

  async get<T = unknown>(path: string, params?: Record<string, string>): Promise<{ data: T; totalCount: number | null }> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }

    const res = await fetch(url.toString(), { headers: this.headers });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Buildium API ${res.status}: ${body}`);
    }

    const data = await res.json() as T;
    const totalCount = res.headers.get("X-Total-Count");

    return { data, totalCount: totalCount ? parseInt(totalCount, 10) : null };
  }

  // Fetch a single entity by type + ID
  async getEntity(entityType: string, id: string) {
    const pathMap: Record<string, string> = {
      rental: `/rentals/${id}`,
      unit: `/rentals/units/${id}`,
      tenant: `/leases/tenants/${id}`,
      lease: `/leases/${id}`,
      workorder: `/workorders/${id}`,
      vendor: `/vendors/${id}`,
      association: `/associations/${id}`,
      task: `/tasks/${id}`,
    };

    const path = pathMap[entityType.toLowerCase()];
    if (!path) throw new Error(`Unknown entity type: ${entityType}`);

    return this.get(path);
  }

  // Paginated fetch helper
  async getAll<T = unknown>(path: string, params?: Record<string, string>): Promise<T[]> {
    const results: T[] = [];
    let offset = 0;
    const limit = 1000;

    while (true) {
      const { data, totalCount } = await this.get<T[]>(path, {
        ...params,
        offset: String(offset),
        limit: String(limit),
      });

      results.push(...data);

      if (totalCount === null || results.length >= totalCount || data.length < limit) {
        break;
      }
      offset += limit;
    }

    return results;
  }
}
