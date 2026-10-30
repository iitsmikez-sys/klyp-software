# Consolidated Klyp Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the approved analysis recovery work and the existing discovery release on one committed development branch without changing pricing, models, or production.

**Architecture:** Keep migrations 024–027 intact. Add durable analysis jobs in migration 028 and compose the job state machine around the existing default and feature-flagged VOD pipelines. Store uploads on an optional persistent mount and make browser recovery fetch the job result by ID.

**Tech Stack:** Next.js, React, Supabase Postgres/RPC, PGLite, Playwright, Node tests.

**Spec:** User approval in this chat, 2026-10-29.

## Global constraints

- No production changes, deployment, paid AI calls, price/model/plan changes.
- Preserve current VOD duration preflight, V2 discovery flag, clip quality checks, editor, and billing logic.
- Existing migrations 024–027 stay byte-for-byte intact; new migration is 028.

## Review focus

- An SSE disconnect after paid ASR cannot lose the transcript or stop a healthy job.
- A retry after AI completes cannot invoke providers or charge twice.
- A zero-clip result is durable and does not charge twice on a lost response.
- A sampled transcript is not reused as full coverage.
- A missing uploaded source is reported honestly instead of yielding unusable clips.

## Tasks

### 1. Durable database and checkpoints

- [ ] Port the tested job migration as `028_analysis_jobs.sql`, preserving 024–027.
- [ ] Port job and SSE helpers, then extend SQL tests for exact-once charging, active dedupe, retry, and migration order.
- [ ] Port transcript checkpoint read/write with user and coverage scoping.

### 2. Route and browser integration

- [ ] Add job ID, safe SSE writes, status endpoint, and retry claim around both existing pipelines.
- [ ] Persist the final analysis before accounting; commit result and Sparks together.
- [ ] Add browser reconnect/result recovery and focused no-provider-call tests.

### 3. Upload persistence and release verification

- [ ] Add configurable persistent upload directory with old-cache read fallback and restart tests.
- [ ] Run focused tests, full tests, typecheck, and clean production build if environment permits.
- [ ] Verify isolated Supabase workflow if isolated credentials/runtime are available; otherwise record the exact blocker.
- [ ] Review diff and commit one final development branch, recording its SHA.
