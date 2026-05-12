// Tests for runtime-readiness predicates that gate model selectors.
//
// Both Bug 1 (chat-dropdown sends inactive UUID) and Bug 2 (Copilot static-
// catalog models surface as if live) reduce to one question: "is this model
// usable at runtime right now?" These tests pin down that contract.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isModelRuntimeUsable,
  validateModelOverride,
  decorateOptionLabel,
  type ModelRuntimeView,
} from './modelRuntimeReadiness'

const LIVE: ModelRuntimeView = {
  id: 'uuid-live',
  model_id: 'claude-3-5-sonnet',
  provider_name: 'anthropic',
  is_active: true,
}

const INACTIVE: ModelRuntimeView = {
  id: 'uuid-inactive',
  model_id: 'old-model',
  provider_name: 'anthropic',
  is_active: false,
}

const STATIC_ONLY: ModelRuntimeView = {
  id: 'uuid-static',
  model_id: 'gpt-4-static',
  provider_name: 'github-copilot',
  is_active: true,
  _from_static_catalog: true,
}

// ─── isModelRuntimeUsable ────────────────────────────────────────────────────

test('isModelRuntimeUsable: active live model is usable', () => {
  const r = isModelRuntimeUsable(LIVE)
  assert.equal(r.usable, true)
})

test('isModelRuntimeUsable: inactive model is NOT usable with deactivated reason', () => {
  const r = isModelRuntimeUsable(INACTIVE)
  assert.equal(r.usable, false)
  assert.equal(r.reason, 'deactivated')
})

test('isModelRuntimeUsable: static-only model is NOT usable with catalog-only reason', () => {
  const r = isModelRuntimeUsable(STATIC_ONLY)
  assert.equal(r.usable, false)
  assert.equal(r.reason, 'catalog-only')
})

test('isModelRuntimeUsable: null/undefined model is NOT usable with missing reason', () => {
  const r1 = isModelRuntimeUsable(null)
  assert.equal(r1.usable, false)
  assert.equal(r1.reason, 'missing')
  const r2 = isModelRuntimeUsable(undefined)
  assert.equal(r2.usable, false)
  assert.equal(r2.reason, 'missing')
})

// ─── validateModelOverride ───────────────────────────────────────────────────

test('validateModelOverride: empty selection is valid (persona default)', () => {
  const r = validateModelOverride('', [LIVE])
  assert.equal(r.valid, true)
})

test('validateModelOverride: selection matching a live model by provider/model_id is valid', () => {
  const r = validateModelOverride('anthropic/claude-3-5-sonnet', [LIVE])
  assert.equal(r.valid, true)
})

test('validateModelOverride: selection matching no model is invalid (no-longer-listed)', () => {
  // Model was deactivated and removed from dropdown's fetch result.
  const r = validateModelOverride('anthropic/missing-model', [LIVE])
  assert.equal(r.valid, false)
  assert.equal(r.reason, 'no-longer-listed')
})

test('validateModelOverride: selection matching an inactive model is invalid (deactivated)', () => {
  // Stale dropdown state — model became inactive after dropdown was fetched.
  const r = validateModelOverride('anthropic/old-model', [LIVE, INACTIVE])
  assert.equal(r.valid, false)
  assert.equal(r.reason, 'deactivated')
})

test('validateModelOverride: selection matching a static-only model is invalid (catalog-only)', () => {
  // Bug 2: Copilot static-only models in dropdowns trap users.
  const r = validateModelOverride('github-copilot/gpt-4-static', [LIVE, STATIC_ONLY])
  assert.equal(r.valid, false)
  assert.equal(r.reason, 'catalog-only')
})

test('validateModelOverride: UUID selection format also resolves correctly', () => {
  // Slash command `/model <uuid>` would pass the UUID directly.
  const r = validateModelOverride('uuid-live', [LIVE])
  assert.equal(r.valid, true)
})

// ─── decorateOptionLabel ─────────────────────────────────────────────────────

test('decorateOptionLabel: live model returns unadorned label', () => {
  assert.equal(decorateOptionLabel(LIVE), 'claude-3-5-sonnet')
})

test('decorateOptionLabel: live model with display_name uses display_name', () => {
  const m: ModelRuntimeView = { ...LIVE, display_name: 'Claude 3.5 Sonnet' }
  assert.equal(decorateOptionLabel(m), 'Claude 3.5 Sonnet')
})

test('decorateOptionLabel: catalog-only model gets explanatory suffix', () => {
  assert.match(decorateOptionLabel(STATIC_ONLY), /catalog-only/i)
})

test('decorateOptionLabel: deactivated model gets deactivated suffix', () => {
  assert.match(decorateOptionLabel(INACTIVE), /deactivated/i)
})
