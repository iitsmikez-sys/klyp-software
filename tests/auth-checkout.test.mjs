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

function checkoutHarness({signedIn = true, subscribed = false, validPrice = true} = {}) {
  let created;
  const stripe = {
    prices: {retrieve: async () => ({id: 'price_test'})},
    checkout: {sessions: {create: async args => {created = args; return {url: 'https://checkout.stripe.com/test-session'};}}},
  };
  const modules = {
    'next/server': {NextResponse},
    '@/lib/stripe': {getStripe: () => stripe, PRO_PRICE_CENTS: 2800},
    '@/lib/supabase/server': {createClient: async () => ({auth: {getUser: async () => ({data: {user: signedIn ? {id: 'user-1', email: 'test@example.com'} : null}})}})},
    '@/lib/profile': {getProfile: async () => ({stripe_customer_id: null, stripe_subscription_id: null})},
    '@/lib/stripe-billing': {resolveBillingState: async () => ({checkoutCustomerId: null, portalCustomerId: subscribed ? 'cus_existing' : null})},
    '@/lib/checkout-price': {validateProPrice: () => validPrice},
  };
  const exports = {};
  vm.runInNewContext(checkoutCode, {exports, require: name => modules[name],
    process: {env: {STRIPE_PRICE_PRO: 'price_test'}}, Response, Date, Error, console});
  return {post: () => exports.POST({nextUrl: {origin: 'http://localhost:3000'}}), get created() {return created;}};
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
