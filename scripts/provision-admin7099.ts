import { createClient } from "@supabase/supabase-js";
import { ADMIN_AUTH_EMAIL, ADMIN_LOGIN_ID } from "../src/lib/auth/admin-login";

// One-off provisioning. Supply NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// and ADMIN7099_PASSWORD through the process environment, never a CLI argument.
async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const password = process.env.ADMIN7099_PASSWORD;
  const checkOnly = process.argv.includes("--check");

  if (!url || !serviceKey) throw new Error("Supabase admin connection is missing");
  if (!checkOnly && (!password || password.length < 8)) throw new Error("ADMIN7099_PASSWORD must be at least 8 characters");

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: membership, error: lookupError } = await admin.from("super_admins")
    .select("id").eq("email", ADMIN_AUTH_EMAIL).maybeSingle();
  if (lookupError) throw new Error(`super_admins lookup failed: ${lookupError.message}`);

  if (checkOnly) {
    if (!membership) {
      console.log(`${ADMIN_LOGIN_ID}: not provisioned`);
    } else {
      const { data, error } = await admin.auth.admin.getUserById(membership.id);
      if (error || data.user?.email?.toLowerCase() !== ADMIN_AUTH_EMAIL) {
        throw new Error("Admin Auth user and super_admins membership do not match");
      }
      console.log(`${ADMIN_LOGIN_ID}: Auth user and super_admins membership verified`);
    }
    return;
  }

  if (membership) throw new Error(`${ADMIN_LOGIN_ID} is already provisioned; no existing password was changed`);
  const { data, error: createError } = await admin.auth.admin.createUser({
    email: ADMIN_AUTH_EMAIL,
    password: password!,
    email_confirm: true,
    user_metadata: { display_name: "AYWA 슈퍼관리자" },
  });
  if (createError || !data.user) throw new Error(`Auth user creation failed: ${createError?.message ?? "missing user"}`);

  const { error: grantError } = await admin.from("super_admins").insert({
    id: data.user.id,
    email: ADMIN_AUTH_EMAIL,
    display_name: "AYWA 슈퍼관리자",
  });
  if (grantError) {
    const { error: rollbackError } = await admin.auth.admin.deleteUser(data.user.id);
    throw new Error(`Membership grant failed: ${grantError.message}; Auth rollback ${rollbackError ? "failed" : "completed"}`);
  }
  console.log(`${ADMIN_LOGIN_ID}: Auth user and super_admins membership created`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Provisioning failed");
  process.exitCode = 1;
});
