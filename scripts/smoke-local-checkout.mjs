/** Isolated signup, login, and Stripe test Checkout smoke test. No payment is made. */
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import Stripe from 'stripe';

const base = process.env.KLYP_LOCAL_URL || 'http://127.0.0.1:3135';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const stripeKey = process.env.STRIPE_SECRET_KEY;
const priceId = process.env.STRIPE_PRICE_PRO;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
if (!base.startsWith('http://127.0.0.1:') ||
    !supabaseUrl?.startsWith('http://127.0.0.1:') ||
    !anonKey || !serviceKey || !stripeKey?.startsWith('sk_test_') ||
    !priceId?.startsWith('price_') || !webhookSecret?.startsWith('whsec_')) {
  throw new Error('This smoke test requires loopback Klyp/Supabase URLs and a Stripe test key.');
}

const email = `klyp-launch-${randomBytes(8).toString('hex')}@example.com`;
const password = randomBytes(24).toString('base64url');
const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
const publicClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
const signup = await publicClient.auth.signUp({ email, password });
if (signup.error || !signup.data.user) throw signup.error || new Error('Signup did not return a user.');
await publicClient.auth.signOut();
const login = await publicClient.auth.signInWithPassword({ email, password });
if (login.error || login.data.user?.id !== signup.data.user.id) {
  throw login.error || new Error('Login did not return the signup user.');
}

const { data: profileBefore, error: profileError } = await admin.from('profiles')
  .select('tier,sparks').eq('id', signup.data.user.id).single();
if (profileError) throw profileError;

const cookies = new Map();
const ssr = createServerClient(supabaseUrl, anonKey, {
  cookies: {
    getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
    setAll: (items) => items.forEach(({ name, value }) => cookies.set(name, value)),
  },
});
const ssrLogin = await ssr.auth.signInWithPassword({ email, password });
if (ssrLogin.error) throw ssrLogin.error;
const cookieHeader = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
const response = await fetch(`${base}/api/stripe/checkout`, {
  method: 'POST', headers: { cookie: cookieHeader },
});
const body = await response.json();
if (!response.ok || !body.url) throw new Error(`Checkout request failed (${response.status}): ${body.error || 'no URL'}`);
const sessionId = new URL(body.url).pathname.split('/').pop()?.split('#')[0];
const stripe = new Stripe(stripeKey);
const session = await stripe.checkout.sessions.retrieve(sessionId);
if (session.livemode || session.mode !== 'subscription' ||
    session.client_reference_id !== signup.data.user.id ||
    session.payment_status !== 'unpaid') {
  throw new Error('Checkout session did not match the isolated user/test-mode expectations.');
}
const { data: profileAfter, error: afterError } = await admin.from('profiles')
  .select('tier,sparks').eq('id', signup.data.user.id).single();
if (afterError) throw afterError;
if (profileAfter.tier !== profileBefore.tier || profileAfter.sparks !== profileBefore.sparks) {
  throw new Error('Creating an unpaid Checkout session changed the plan or Sparks.');
}
console.log(JSON.stringify({ signup: 'pass', login: 'pass', checkout: 'test-mode session created',
  payment: 'unpaid', prematureGrant: false, initialTier: profileBefore.tier,
  initialSparks: profileBefore.sparks }));

// Stripe's test card creates a real test-mode paid invoice without moving money.
// The local webhook is signed with the configured test secret; no public endpoint is used.
const customer = await stripe.customers.create({ email });
const paymentMethod = await stripe.paymentMethods.create({ type: 'card', card: { token: 'tok_visa' } });
await stripe.paymentMethods.attach(paymentMethod.id, { customer: customer.id });
const subscription = await stripe.subscriptions.create({
  customer: customer.id,
  items: [{ price: priceId }],
  default_payment_method: paymentMethod.id,
  payment_behavior: 'error_if_incomplete',
  metadata: { user_id: signup.data.user.id },
  expand: ['latest_invoice'],
});
if (subscription.livemode || subscription.status !== 'active') {
  throw new Error('Test subscription was not active.');
}
const invoice = typeof subscription.latest_invoice === 'string'
  ? await stripe.invoices.retrieve(subscription.latest_invoice)
  : subscription.latest_invoice;
if (!invoice || invoice.status !== 'paid' ||
    invoice.parent?.subscription_details?.subscription !== subscription.id ||
    invoice.parent?.subscription_details?.metadata?.user_id !== signup.data.user.id) {
  throw new Error('Paid test invoice lacks the expected subscription/user details.');
}

const postEvent = async (event) => {
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
  const res = await fetch(`${base}/api/stripe/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signature },
    body: payload,
  });
  const result = await res.json();
  if (!res.ok) throw new Error(`Webhook failed (${res.status}): ${result.error || 'unknown'}`);
  return result;
};
const eventId = `evt_klyp_local_${randomBytes(12).toString('hex')}`;
const failedEvent = {
  id: `${eventId}_failed`, object: 'event', type: 'invoice.payment_failed',
  api_version: '2025-02-24.acacia', livemode: false,
  data: { object: { ...invoice, id: `${invoice.id}_failed`, status: 'open' } },
};
await postEvent(failedEvent);
const { data: afterFailure, error: failureError } = await admin.from('profiles')
  .select('tier,sparks').eq('id', signup.data.user.id).single();
if (failureError) throw failureError;
if (afterFailure.tier !== profileBefore.tier || afterFailure.sparks !== profileBefore.sparks) {
  throw new Error('Failed-payment event changed the plan or Sparks.');
}

const paidEvent = {
  id: eventId, object: 'event', type: 'invoice.paid',
  api_version: '2025-02-24.acacia', livemode: false, data: { object: invoice },
};
await postEvent(paidEvent);
const { data: afterPayment, error: paymentError } = await admin.from('profiles')
  .select('tier,sparks,stripe_subscription_id').eq('id', signup.data.user.id).single();
if (paymentError) throw paymentError;
if (afterPayment.tier !== 'pro' || afterPayment.sparks !== 500 ||
    afterPayment.stripe_subscription_id !== subscription.id) {
  throw new Error('Paid invoice did not grant Pro and exactly 500 Sparks.');
}

const charge = await admin.rpc('admin_consume_sparks', {
  target_user: signup.data.user.id, amount: 10, p_reference: `${eventId}_charge`,
});
if (charge.error || charge.data !== 490) throw charge.error || new Error('Sparks charge failed.');
const duplicate = await postEvent(paidEvent);
const { data: afterDuplicate, error: duplicateError } = await admin.from('profiles')
  .select('sparks').eq('id', signup.data.user.id).single();
if (duplicateError) throw duplicateError;
if (!duplicate.duplicate || afterDuplicate.sparks !== 490) {
  throw new Error('Duplicate invoice refilled spent Sparks.');
}
const { data: ledger, error: ledgerError } = await admin.from('spark_transactions')
  .select('reason,reference,delta,balance_after').eq('user_id', signup.data.user.id);
if (ledgerError) throw ledgerError;
if (ledger.filter((row) => row.reason === 'invoice_grant' && row.reference === invoice.id).length !== 1 ||
    ledger.filter((row) => row.reference === `${eventId}_charge`).length !== 1) {
  throw new Error('Sparks ledger does not contain exactly one grant and one charge.');
}
console.log(JSON.stringify({ failedPaymentNoGrant: 'pass', paidInvoiceGrant: '500 Sparks once',
  duplicateAfterCharge: 'balance stayed 490', ledger: 'one grant and one charge',
  delivery: 'locally signed test-mode webhook' }));

// Export an owned, saved clip from a tiny local fixture; no AI processing is invoked.
const fixture = await readFile('.tmp-smoke/launch-export-fixture.mp4');
const uploaded = await fetch(`${base}/api/upload`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${login.data.session.access_token}`,
    'x-file-name': 'launch-export-fixture.mp4' },
  body: fixture,
});
const uploadResult = await uploaded.json();
if (!uploaded.ok || !uploadResult.uploadId) {
  throw new Error(`Local fixture upload failed (${uploaded.status}): ${uploadResult.error || 'unknown'}`);
}
const clip = {
  user_id: signup.data.user.id, url: `upload:${uploadResult.uploadId}`,
  title: 'Local export smoke clip', clip_type: 'TEST', viral_score: 0,
  start_seconds: 0, end_seconds: Math.min(6, uploadResult.durationSeconds),
};
const { data: saved, error: saveError } = await publicClient.from('clips')
  .insert(clip).select('id,url,start_seconds,end_seconds').single();
if (saveError) throw saveError;
const { data: reopened, error: reopenError } = await publicClient.from('clips')
  .select('id,url,start_seconds,end_seconds').eq('id', saved.id).single();
if (reopenError || reopened.id !== saved.id) {
  throw reopenError || new Error('Saved clip could not be reopened.');
}
const mediaBody = { clip_id: saved.id, url: saved.url, title: clip.title,
  start_seconds: saved.start_seconds, end_seconds: saved.end_seconds,
  aspect_ratio: '9:16' };
for (const endpoint of ['preview', 'clip']) {
  const res = await fetch(`${base}/api/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json',
      Authorization: `Bearer ${login.data.session.access_token}` },
    body: JSON.stringify(mediaBody),
  });
  if (!res.ok) throw new Error(`${endpoint} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const bytes = await res.arrayBuffer();
  if (!res.headers.get('content-type')?.includes('video/mp4') || bytes.byteLength < 50_000) {
    throw new Error(`${endpoint} did not return a playable-sized MP4.`);
  }
  console.log(JSON.stringify({ endpoint, result: 'MP4 returned', bytes: bytes.byteLength }));
}
console.log(JSON.stringify({ libraryRowReopened: true, exportSource: 'isolated local fixture',
  paidAI: false, durableBackup: 'awaiting confirmation' }));
// A library row is provisional. Do not report a successful save until the
// processing worker has committed all three objects to private storage.
const archiveDeadline = Date.now() + 3 * 60_000;
let archiveStatus = 'pending';
while (Date.now() < archiveDeadline) {
  const { data: row, error: archiveError } = await admin.from('clips')
    .select('archive_status,master_path,proxy_path,poster_path')
    .eq('id', saved.id).single();
  if (archiveError) throw archiveError;
  archiveStatus = row.archive_status;
  if (archiveStatus === 'stored') {
    if (!row.master_path || !row.proxy_path || !row.poster_path) {
      throw new Error('Clip was marked stored without all backup paths.');
    }
    console.log(JSON.stringify({ durableBackup: 'stored', clipId: saved.id }));
    break;
  }
  if (archiveStatus === 'unavailable') throw new Error('Clip source disappeared before backup completed.');
  await new Promise(resolve => setTimeout(resolve, 5_000));
}
if (archiveStatus !== 'stored') {
  throw new Error(`Clip backup was not confirmed within three minutes (status: ${archiveStatus}).`);
}
