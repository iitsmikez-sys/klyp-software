import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const transpile = file => ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'),
  {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText;
const checkoutCode = transpile('../app/api/stripe/checkout/route.ts');
const callbackCode = transpile('../app/auth/callback/route.ts');
class NextResponse extends Response {
  static json(body, init) { return new NextResponse(JSON.stringify(body), init); }
  static redirect(url) { return new NextResponse(null, {status: 307, headers: {location: url}}); }
}

function checkoutHarness({signedIn = true, subscribed = false, validPrice = true, offer = false, link = true, newCustomer = true, env = {STRIPE_PRICE_PRO: 'price_test'}} = {}) {
  let created;
  const validated = [];
  const stripe = {
    prices: {retrieve: async () => ({id: 'price_test'})},
    checkout: {sessions: {create: async args => {created = args; return {url: 'https://checkout.stripe.com/test-session'};}}},
  };
  const modules = {
    'next/server': {NextResponse},
    '@/lib/stripe': {getStripe: () => stripe, PRO_PRICE_CENTS: 2800, PRO_YEARLY_PRICE_CENTS: 27600},
    '@/lib/supabase/server': {createClient: async () => ({auth: {getUser: async () => ({data: {user: signedIn ? {id: 'user-1', email: 'test@example.com'} : null}})}})},
    '@/lib/profile': {getProfile: async () => ({stripe_customer_id: null, stripe_subscription_id: null})},
    '@/lib/stripe-billing': {resolveBillingState: async () => ({checkoutCustomerId: null, portalCustomerId: subscribed ? 'cus_existing' : null})},
    '@/lib/offer-cookie': {OFFER_COOKIE: 'klyp_offer', OFFER_VALUE: '17', offerCookieActive: value => value === '17'},
    '@/lib/first-month-offer': {firstMonthOfferAvailable: (_profile, _env, fromLink) => offer && fromLink === true, isNewCustomer: () => newCustomer, ensureFirstMonthCoupon: async () => 'coupon_test', FIRST_MONTH_PRICE_CENTS: 1700},
    '@/lib/checkout-price': {validateProPrice: (...args) => { validated.push(args.slice(1)); return validPrice; }},
  };
  const exports = {};
  vm.runInNewContext(checkoutCode, {exports, require: name => modules[name],
    process: {env}, Response, Date, Error, console});
  return {post: (body = {}) => exports.POST({nextUrl: {origin: 'http://localhost:3000'}, json: async () => body,
    cookies: {get: name => (link && name === 'klyp_offer' ? {value: '17'} : undefined)}}), get created() {return created;}, validated};
}

test('mocked signed-in checkout uses the advertised price and user identity without granting Sparks', async () => {
  const h = checkoutHarness();
  const response = await h.post();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).url, 'https://checkout.stripe.com/test-session');
  assert.equal(h.created.mode, 'subscription');
  assert.equal(h.created.client_reference_id, 'user-1');
  assert.equal(h.created.metadata.user_id, 'user-1');
  assert.equal(h.created.subscription_data.metadata.user_id, 'user-1');
  assert.equal(h.created.line_items[0].price, 'price_test');
});

test('a new monthly subscriber gets the $17 first-month coupon; yearly and non-qualifying people do not', async () => {
  const monthly = checkoutHarness({offer: true});
  assert.equal((await monthly.post({interval: 'month'})).status, 200);
  assert.equal(JSON.stringify(monthly.created.discounts), '[{"coupon":"coupon_test"}]');
  const yearly = checkoutHarness({offer: true});
  await yearly.post({interval: 'year'});
  assert.equal(yearly.created.discounts, undefined);
  const noLink = checkoutHarness({offer: true, link: false});
  await noLink.post({interval: 'month'});
  assert.equal(noLink.created.discounts, undefined, 'no ad link, no discount');
  const returning = checkoutHarness({offer: false});
  await returning.post({interval: 'month'});
  assert.equal(returning.created.discounts, undefined);
});

test('new monthly subscribers without the ad offer get the promo code box; nobody else does', async () => {
  const plain = checkoutHarness({offer: false});
  await plain.post({interval: 'month'});
  assert.equal(plain.created.allow_promotion_codes, true);
  assert.equal(plain.created.discounts, undefined);
  const fromLink = checkoutHarness({offer: true});
  await fromLink.post({interval: 'month'});
  assert.equal(fromLink.created.allow_promotion_codes, undefined, 'a preset discount and the code box cannot be combined');
  assert.ok(fromLink.created.discounts);
  const yearly = checkoutHarness({offer: false});
  await yearly.post({interval: 'year'});
  assert.equal(yearly.created.allow_promotion_codes, undefined);
  const returning = checkoutHarness({offer: false, newCustomer: false});
  await returning.post({interval: 'month'});
  assert.equal(returning.created.allow_promotion_codes, undefined);
});

test('mocked checkout rejects guests, existing subscribers and mismatched price', async () => {
  for (const [options, expected] of [
    [{signedIn: false}, 401], [{subscribed: true}, 400], [{validPrice: false}, 500],
  ]) {
    const h = checkoutHarness(options);
    assert.equal((await h.post()).status, expected);
    assert.equal(h.created, undefined);
  }
});

function callbackHarness({exchangeError = false} = {}) {
  let exchanged;
  const modules = {
    'next/server': {NextResponse},
    'next/headers': {cookies: async () => ({getAll: () => [], set: () => {}})},
    '@supabase/ssr': {createServerClient: () => ({auth: {exchangeCodeForSession: async code => {
      exchanged = code; return {error: exchangeError ? new Error('bad code') : null};
    }}})},
  };
  const exports = {};
  vm.runInNewContext(callbackCode, {exports, require: name => modules[name],
    process: {env: {NEXT_PUBLIC_SUPABASE_URL: 'https://mock.local', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-fixture'}},
    Response, URL, Error, console});
  return {get: url => exports.GET({url}), get exchanged() {return exchanged;}};
}

test('mocked confirmation/login callback exchanges the code then redirects to dashboard', async () => {
  const h = callbackHarness();
  const response = await h.get('http://localhost:3000/auth/callback?code=mock-code');
  assert.equal(h.exchanged, 'mock-code');
  assert.equal(response.headers.get('location'), 'http://localhost:3000/dashboard');
});

test('mocked failed confirmation callback returns to login', async () => {
  const h = callbackHarness({exchangeError: true});
  const response = await h.get('http://localhost:3000/auth/callback?code=bad-code');
  assert.equal(response.headers.get('location'), 'http://localhost:3000/login?error=auth_callback_failed');
});

test('yearly checkout charges $276 once a year, with no configured price needed', async () => {
  const h = checkoutHarness({env: {}});
  const response = await h.post({interval: 'year'});
  assert.equal(response.status, 200);
  const item = h.created.line_items[0].price_data;
  assert.deepEqual([item.unit_amount, item.recurring.interval], [27600, 'year']);
  assert.equal(h.created.metadata.billing_interval, 'year');
  assert.equal(h.created.subscription_data.metadata.billing_interval, 'year');
  assert.equal(h.created.mode, 'subscription');
});

test('monthly is the default: no body, an unknown interval, or "month" all charge $28 a month', async () => {
  for (const body of [{}, {interval: 'weekly'}, {interval: 'month'}, {interval: 12}]) {
    const h = checkoutHarness({env: {}});
    await h.post(body);
    const item = h.created.line_items[0].price_data;
    assert.deepEqual([item.unit_amount, item.recurring.interval], [2800, 'month'], JSON.stringify(body));
    assert.equal(h.created.metadata.billing_interval, 'month');
  }
});

test('a configured yearly Stripe price is used and validated against $276 a year (never the monthly one)', async () => {
  const h = checkoutHarness({env: {STRIPE_PRICE_PRO: 'price_monthly', STRIPE_PRICE_PRO_YEARLY: 'price_yearly'}});
  await h.post({interval: 'year'});
  assert.equal(h.created.line_items[0].price, 'price_yearly');
  assert.deepEqual(h.validated, [[27600, 'year']]);
  const m = checkoutHarness({env: {STRIPE_PRICE_PRO: 'price_monthly', STRIPE_PRICE_PRO_YEARLY: 'price_yearly'}});
  await m.post({interval: 'month'});
  assert.equal(m.created.line_items[0].price, 'price_monthly');
  assert.deepEqual(m.validated, [[2800, 'month']]);
});

test('a yearly price that does not match $276 a year refuses to open checkout', async () => {
  const h = checkoutHarness({env: {STRIPE_PRICE_PRO_YEARLY: 'price_yearly'}, validPrice: false});
  const response = await h.post({interval: 'year'});
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /\$276 USD\/year/);
  assert.equal(h.created, undefined);
});
