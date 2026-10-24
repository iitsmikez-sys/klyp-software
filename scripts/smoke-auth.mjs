/** Obtain a test-user session without logging or storing its access token. */
import { createClient } from "@supabase/supabase-js";

export async function loginExistingTestAccount(email) {
  if (!email?.endsWith("@example.com")) throw new Error("Use an existing example.com test account.");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const adminKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !adminKey || !anonKey) throw new Error("Supabase credentials are required.");
  const admin = createClient(url, adminKey, { auth: { persistSession: false } });
  let user;
  for (let page = 1; page <= 20 && !user; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    user = data.users.find((item) => item.email === email);
    if (data.users.length < 1000) break;
  }
  if (!user) throw new Error("Existing test account not found.");
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkError) throw linkError;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data: auth, error: authError } = await client.auth.verifyOtp({
    token_hash: link.properties.hashed_token, type: "magiclink",
  });
  if (authError) throw authError;
  const token = auth.session?.access_token;
  if (!token || auth.user?.id !== user.id) throw new Error("Test account login failed.");
  return { admin, client, user, token };
}
