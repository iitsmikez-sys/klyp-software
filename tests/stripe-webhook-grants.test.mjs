import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../app/api/stripe/webhook/route.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
}}).outputText;

function harness({missingTable = false, failGrantOnce = false, currentSubscriptionStatus = 'active', interval = undefined} = {}) {
  const claimed = new Set();
  const grants = [];
  const profile = {id: 'user', tier: 'free', stripe_customer_id: 'cus', stripe_subscription_id: null};
  const grantReferences = new Set();
  let balance = 150;
  let grantFailures = failGrantOnce ? 1 : 0;
  let subscriptionStatus = currentSubscriptionStatus;
  let latestInvoiceId = null;
  let pinLatestInvoice = false;
  let paused = false;
  class NextResponse extends Response {
    static json(body, init) { return new NextResponse(JSON.stringify(body), init); }
  }
  const admin = {
    from(table) {
      if (table === 'profiles') return {update: changes => {
        const filters = {};
        const query = {select: () => query, eq: (column, value) => {filters[column] = value; return query;},
          then: (resolve, reject) => Promise.resolve().then(() => {
            const matches = Object.entries(filters).every(([column, value]) => profile[column] === value);
            if (matches) Object.assign(profile, changes);
            return {data: matches ? [{id: 'user'}] : [], error: null};
          }).then(resolve, reject)};
        return query;
      }};
      if (table !== 'stripe_events') throw Error(`unexpected ${table}`);
      return {
        async insert(row) {
          if (missingTable) return {error: {code: '42P01', message: 'missing table'}};
          if (claimed.has(row.id)) return {error: {code: '23505', message: 'duplicate'}};
          claimed.add(row.id); return {error: null};
        },
        delete() { return {eq: async (_col, id) => {claimed.delete(id); return {error: null};}}; },
      };
    },
    async rpc(name, args) {
      assert.equal(name, 'grant_tier_sparks');
      if (grantFailures-- > 0) return {error: {message: 'temporary database failure'}};
      if (grantReferences.has(args.p_event_id)) return {error: {code: '23505', message: 'duplicate grant reference'}};
      grantReferences.add(args.p_event_id);
      grants.push(args);
      balance = args.p_balance;
      profile.tier = args.p_tier;
      profile.stripe_subscription_id = args.p_subscription_id;
      return {error: null};
    },
  };
  const modules = {
    'next/server': {NextResponse},
    '@/lib/stripe': {getStripe: () => ({webhooks: {constructEvent: payload => JSON.parse(payload)},
      subscriptions: {retrieve: async id => ({id, status: subscriptionStatus, latest_invoice: latestInvoiceId,
        pause_collection: paused ? {behavior: 'void', resumes_at: 1} : null,
        ...(interval ? {items: {data: [{price: {recurring: {interval}}}]}} : {})})}})},
    '@/lib/supabase/admin': {createAdminClient: () => admin},
    '@/lib/tier': {SPARKS_ALLOWANCE: {free: 150, pro: 500}},
  };
  const exports = {};
  vm.runInNewContext(code, {exports, require: name => modules[name],
    process: {env: {STRIPE_WEBHOOK_SECRET: 'local-fixture'}}, console, Response, Date, Error,
    Object, String});
  async function send(event) {
    if (event.type === 'invoice.paid' && !pinLatestInvoice) latestInvoiceId = event.data.object.id;
    const res = await exports.POST({text: async () => JSON.stringify(event),
      headers: {get: () => 'local-fixture-signature'}});
    return {status: res.status, body: await res.json()};
  }
  return {send, grants, profile, setSubscriptionStatus(status) {subscriptionStatus = status;},
    setPaused(value) {paused = value;},
    setLatestInvoice(id) {latestInvoiceId = id; pinLatestInvoice = true;},
    spend(amount) {balance -= amount;}, get balance() {return balance;}};
}
const checkout = (id, payment_status = 'paid') => ({id, type: 'checkout.session.completed',
  data: {object: {mode: 'subscription', payment_status, metadata: {user_id: 'user'},
    customer: 'cus', subscription: 'sub'}}});
const invoice = (id, billing_reason, invoiceId = id, subscription = 'sub') => ({id, type: 'invoice.paid', data: {object: {
  id: invoiceId,
  billing_reason, customer: 'cus', parent: {subscription_details: {
    subscription, metadata: {user_id: 'user'},
  }},
}}});

test('checkout and first paid invoice grant exactly one allotment even after spending', async () => {
  const h = harness();
  assert.equal((await h.send(checkout('evt-checkout'))).status, 200);
  assert.equal(h.grants.length, 0, 'checkout alone does not prove invoice payment');
  assert.equal((await h.send(invoice('evt-first-invoice', 'subscription_create'))).status, 200);
  h.spend(400);
  assert.equal((await h.send(checkout('evt-checkout'))).status, 200);
  assert.equal((await h.send(invoice('evt-first-invoice', 'subscription_create'))).status, 200);
  assert.equal(h.grants.length, 1);
  assert.equal(h.balance, 100);
});

test('first invoice arriving before checkout still grants only once', async () => {
  const h = harness();
  assert.equal((await h.send(invoice('evt-first', 'subscription_create'))).status, 200);
  h.spend(400);
  assert.equal((await h.send(checkout('evt-later'))).status, 200);
  assert.equal(h.grants.length, 1);
  assert.equal(h.balance, 100);
});

test('delayed checkout grants only after its first paid invoice', async () => {
  const h = harness();
  await h.send(checkout('evt-unpaid', 'unpaid'));
  assert.equal(h.grants.length, 0);
  assert.equal((await h.send(invoice('evt-paid-later', 'subscription_create'))).status, 200);
  assert.equal(h.grants.length, 1);
});

test('a paid renewal grants once, while a duplicate delivery grants nothing', async () => {
  const h = harness();
  assert.equal((await h.send(invoice('evt-renewal', 'subscription_cycle'))).status, 200);
  h.spend(400);
  assert.equal((await h.send(invoice('evt-renewal', 'subscription_cycle'))).status, 200);
  assert.equal(h.grants.length, 1);
  assert.equal(h.balance, 100);
});

test('an unpaid checkout and failed invoice grant nothing', async () => {
  const h = harness();
  assert.equal((await h.send(checkout('evt-unpaid', 'unpaid'))).status, 200);
  assert.equal((await h.send({id: 'evt-failed', type: 'invoice.payment_failed', data: {object: {}}})).status, 200);
  assert.equal(h.grants.length, 0);
});

test('a failed first subscription payment does not activate Pro access', async () => {
  for (const status of ['active', 'trialing', 'past_due']) {
    const h = harness();
    const event = {id: `evt-${status}`, type: 'customer.subscription.updated', data: {object: {
      id: 'sub', status, metadata: {user_id: 'user'}, customer: 'cus',
    }}};
    assert.equal((await h.send(event)).status, 200);
    assert.equal(h.profile.tier, 'free', `${status} without a paid invoice must not activate Pro`);
    assert.equal(h.profile.stripe_subscription_id, null);
    assert.equal(h.grants.length, 0);
  }
});

test('cancelling an unpaid subscription cannot refill spent Free Sparks', async () => {
  const h = harness();
  h.spend(100);
  assert.equal((await h.send({id: 'evt-delete', type: 'customer.subscription.deleted', data: {object: {
    id: 'sub', metadata: {user_id: 'user'}, customer: 'cus',
  }}})).status, 200);
  assert.equal(h.profile.tier, 'free');
  assert.equal(h.grants.length, 0);
  assert.equal(h.balance, 50);
});

test('a paid subscription stays Pro when active, then cancellation removes Pro without a refill', async () => {
  const h = harness();
  assert.equal((await h.send(invoice('evt-paid', 'subscription_create'))).status, 200);
  h.spend(200);
  assert.equal((await h.send({id: 'evt-active', type: 'customer.subscription.updated', data: {object: {
    id: 'sub', status: 'active', metadata: {user_id: 'user'}, customer: 'cus',
  }}})).status, 200);
  assert.equal(h.profile.tier, 'pro');
  assert.equal(h.balance, 300);
  assert.equal((await h.send({id: 'evt-cancel', type: 'customer.subscription.deleted', data: {object: {
    id: 'sub', metadata: {user_id: 'user'}, customer: 'cus',
  }}})).status, 200);
  assert.equal(h.profile.tier, 'free');
  assert.equal(h.profile.stripe_subscription_id, null);
  assert.equal(h.balance, 300);
  assert.equal(h.grants.length, 1);
});

test('a delayed unpaid-status update cannot revoke a currently paid subscription', async () => {
  const h = harness();
  assert.equal((await h.send(invoice('evt-paid-first', 'subscription_create'))).status, 200);
  assert.equal((await h.send({id: 'evt-stale-past-due', type: 'customer.subscription.updated', data: {object: {
    id: 'sub', status: 'past_due', metadata: {user_id: 'user'}, customer: 'cus',
  }}})).status, 200);
  assert.equal(h.profile.tier, 'pro');
  assert.equal(h.profile.stripe_subscription_id, 'sub');
  assert.equal(h.grants.length, 1);
});

test('an old subscription deletion cannot revoke a newer paid subscription', async () => {
  const h = harness();
  assert.equal((await h.send(invoice('evt-old-paid', 'subscription_create', 'in_old', 'sub_old'))).status, 200);
  assert.equal((await h.send(invoice('evt-new-paid', 'subscription_create', 'in_new', 'sub_new'))).status, 200);
  assert.equal(h.profile.stripe_subscription_id, 'sub_new');
  assert.equal((await h.send({id: 'evt-old-deleted', type: 'customer.subscription.deleted', data: {object: {
    id: 'sub_old', metadata: {user_id: 'user'}, customer: 'cus',
  }}})).status, 200);
  assert.equal(h.profile.tier, 'pro');
  assert.equal(h.profile.stripe_subscription_id, 'sub_new');
});

test('a delayed paid invoice cannot reactivate a subscription already cancelled in Stripe', async () => {
  const h = harness();
  assert.equal((await h.send(invoice('evt-initial-paid', 'subscription_create', 'in_initial'))).status, 200);
  h.setSubscriptionStatus('canceled');
  assert.equal((await h.send({id: 'evt-deleted', type: 'customer.subscription.deleted', data: {object: {
    id: 'sub', metadata: {user_id: 'user'}, customer: 'cus',
  }}})).status, 200);
  assert.equal((await h.send(invoice('evt-late-paid', 'subscription_cycle', 'in_late'))).status, 200);
  assert.equal(h.profile.tier, 'free');
  assert.equal(h.grants.length, 1);
});

test('an older paid invoice delivered after a newer cycle cannot refill Sparks', async () => {
  const h = harness();
  assert.equal((await h.send(invoice('evt-new-cycle', 'subscription_cycle', 'in_new_cycle'))).status, 200);
  h.spend(100);
  h.setLatestInvoice('in_new_cycle');
  assert.equal((await h.send(invoice('evt-old-cycle', 'subscription_cycle', 'in_old_cycle'))).status, 200);
  assert.equal(h.grants.length, 1);
  assert.equal(h.balance, 400);
});

test('missing idempotency table fails closed so Stripe can retry', async () => {
  const h = harness({missingTable: true});
  assert.equal((await h.send(invoice('evt-invoice', 'subscription_create'))).status, 500);
  assert.equal(h.grants.length, 0);
});

test('failed grant releases event claim so a retry can grant exactly once', async () => {
  const h = harness({failGrantOnce: true});
  const event = invoice('evt-retry', 'subscription_create');
  assert.equal((await h.send(event)).status, 500);
  assert.equal(h.grants.length, 0);
  assert.equal((await h.send(event)).status, 200);
  assert.equal((await h.send(event)).status, 200);
  assert.equal(h.grants.length, 1);
});
test('two Stripe event IDs for the same paid invoice never refill twice', async () => {
  const h = harness();
  assert.equal((await h.send(invoice('evt-a', 'subscription_cycle', 'in_same'))).status, 200);
  h.spend(400);
  assert.equal((await h.send(invoice('evt-b', 'subscription_cycle', 'in_same'))).status, 200);
  assert.equal(h.grants.length, 1);
  assert.equal(h.balance, 100);
});

const voided = (id, billing_reason = 'subscription_cycle', subscription = 'sub') => ({id, type: 'invoice.voided', data: {object: {
  id: 'in_' + id, billing_reason, customer: 'cus', parent: {subscription_details: {subscription, metadata: {user_id: 'user'}}},
}}});

test('a paused subscription whose renewal invoice is voided moves to Free, keeps its subscription id, then resumes with a fresh allotment', async () => {
  const h = harness();
  await h.send(invoice('evt_first', 'subscription_create'));
  assert.equal(h.profile.tier, 'pro');
  h.setPaused(true);
  const res = await h.send(voided('evt_void'));
  assert.equal(res.status, 200);
  assert.equal(h.profile.tier, 'free');
  assert.equal(h.profile.stripe_subscription_id, 'sub'); // kept so the person can still manage or cancel
  assert.equal(h.grants.length, 1); // nothing is granted while paused
  h.setPaused(false); // billing resumes and the next invoice is paid
  await h.send(invoice('evt_resume', 'subscription_cycle'));
  assert.equal(h.profile.tier, 'pro');
  assert.equal(h.grants.length, 2);
  assert.equal(h.balance, 500);
});

test('a voided invoice does NOT downgrade a subscription that is not paused, or a non-renewal invoice', async () => {
  const h = harness();
  await h.send(invoice('evt_first', 'subscription_create'));
  await h.send(voided('evt_void_unpaused'));
  assert.equal(h.profile.tier, 'pro');
  h.setPaused(true);
  await h.send(voided('evt_void_other', 'manual'));
  assert.equal(h.profile.tier, 'pro');
});

test('a paid yearly subscription is recorded as yearly (so its Sparks are refilled monthly); a monthly one stays monthly', async () => {
  const yearly = harness({interval: 'year'});
  await yearly.send(invoice('evt_year', 'subscription_create'));
  assert.equal(yearly.profile.tier, 'pro');
  assert.equal(yearly.profile.billing_interval, 'year');
  assert.equal(yearly.grants.length, 1);
  const monthly = harness({interval: 'month'});
  await monthly.send(invoice('evt_month', 'subscription_create'));
  assert.equal(monthly.profile.billing_interval, 'month');
  const unknown = harness(); // price not visible on the object: treated as monthly, never as yearly
  await unknown.send(invoice('evt_unknown', 'subscription_create'));
  assert.equal(unknown.profile.billing_interval, 'month');
});

test('the yearly renewal a year later grants a fresh allotment once, like any paid cycle', async () => {
  const h = harness({interval: 'year'});
  await h.send(invoice('evt_y1', 'subscription_create'));
  h.spend(400);
  await h.send(invoice('evt_y2', 'subscription_cycle'));
  assert.equal(h.balance, 500);
  assert.equal(h.grants.length, 2);
  await h.send(invoice('evt_y2_again', 'subscription_cycle', 'evt_y2')); // same invoice, new event id
  assert.equal(h.grants.length, 2);
});
