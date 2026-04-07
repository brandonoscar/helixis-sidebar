/**
 * AppFolio Property Manager API Client — server-side only.
 *
 * Auth: HTTP Basic Authentication (base64-encoded client_id:client_secret).
 * Base URL: https://{subdomain}.appfolio.com/api/v1
 * Pagination: Cursor-based via `next_url` field in responses.
 * Plan gating: Plus plan = read-only, Max plan = read/write + webhooks.
 *
 * Source: https://developer.appfolio.com
 */

export interface AppFolioCredentials {
  clientId: string;
  clientSecret: string;
  subdomain: string;
}

export class AppFolioClient {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(creds: AppFolioCredentials) {
    this.baseUrl = `https://${creds.subdomain}.appfolio.com/api/v1`;

    // AppFolio uses HTTP Basic Auth
    const encoded = btoa(`${creds.clientId}:${creds.clientSecret}`);
    this.headers = {
      Authorization: `Basic ${encoded}`,
      "Content-Type": "application/json",
    };
  }

  async get<T = unknown>(path: string, params?: Record<string, string>): Promise<{ data: T }> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }

    const res = await fetch(url.toString(), { headers: this.headers });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`AppFolio API ${res.status}: ${body}`);
    }

    const data = (await res.json()) as T;
    return { data };
  }

  // Fetch a single entity by type + ID
  async getEntity(entityType: string, id: string) {
    const pathMap: Record<string, string> = {
      property: `/properties/${id}`,
      unit: `/units/${id}`,
      tenant: `/tenants/${id}`,
      listing: `/listings/${id}`,
      owner: `/owners/${id}`,
      vendor: `/vendors/${id}`,
      lead: `/leads/${id}`,
      workorder: `/work_orders/${id}`,
    };

    const path = pathMap[entityType.toLowerCase()];
    if (!path) throw new Error(`Unknown AppFolio entity type: ${entityType}`);

    return this.get(path);
  }

  // Paginated fetch helper — follows cursor-based next_url pagination
  async getAll<T = unknown>(path: string, params?: Record<string, string>): Promise<T[]> {
    const results: T[] = [];
    let url: string | null = `${this.baseUrl}${path}`;

    if (params) {
      const u = new URL(url);
      for (const [k, v] of Object.entries(params)) {
        u.searchParams.set(k, v);
      }
      url = u.toString();
    }

    while (url) {
      const res = await fetch(url, { headers: this.headers });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`AppFolio API ${res.status}: ${body}`);
      }

      const json = await res.json();
      const items = json.results || json.data || [];
      results.push(...items);
      url = json.next_url || null;
    }

    return results;
  }

  // Write operations (Max plan only)

  async post<T = unknown>(path: string, body: Record<string, unknown>): Promise<{ data: T }> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AppFolio API POST ${res.status}: ${text}`);
    }

    const data = (await res.json()) as T;
    return { data };
  }

  async put<T = unknown>(path: string, body: Record<string, unknown>): Promise<{ data: T }> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "PUT",
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AppFolio API PUT ${res.status}: ${text}`);
    }

    const data = (await res.json()) as T;
    return { data };
  }
}
