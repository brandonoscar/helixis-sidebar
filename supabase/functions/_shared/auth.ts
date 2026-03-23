import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface AuthContext {
  userId: string;
  businessId: string;
  role: string;
}

/**
 * Validates the JWT from the request and resolves the user's business membership.
 * Returns the authenticated context or throws an error.
 */
export async function authenticateRequest(
  req: Request,
  options?: { requireAdmin?: boolean }
): Promise<{ auth: AuthContext; supabaseClient: ReturnType<typeof createClient> }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new AuthError("Missing or invalid Authorization header", 401);
  }

  const token = authHeader.replace("Bearer ", "");

  // Create a client authenticated as the requesting user
  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
    }
  );

  // Verify the token and get the user
  const {
    data: { user },
    error: userError,
  } = await supabaseClient.auth.getUser();

  if (userError || !user) {
    throw new AuthError("Invalid or expired token", 401);
  }

  // Look up the user's business membership
  // If a specific business_id is provided in the request body, use it;
  // otherwise, use their first/primary membership.
  let businessId: string | undefined;

  try {
    const body = await req.clone().json();
    businessId = body.business_id;
  } catch {
    // No body or not JSON — that's fine
  }

  let memberQuery = supabaseClient
    .from("business_members")
    .select("business_id, role")
    .eq("user_id", user.id);

  if (businessId) {
    memberQuery = memberQuery.eq("business_id", businessId);
  }

  const { data: members, error: memberError } = await memberQuery.limit(1).single();

  if (memberError || !members) {
    throw new AuthError("User is not a member of any business", 403);
  }

  if (options?.requireAdmin && !["owner", "admin"].includes(members.role)) {
    throw new AuthError("Insufficient permissions. Admin role required.", 403);
  }

  return {
    auth: {
      userId: user.id,
      businessId: members.business_id,
      role: members.role,
    },
    supabaseClient,
  };
}

/**
 * Creates a Supabase client using the service_role key.
 * Use this for operations that bypass RLS (e.g., writing audit logs,
 * reading integration_secrets).
 */
export function createServiceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}
