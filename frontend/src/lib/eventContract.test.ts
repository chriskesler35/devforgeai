import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveEventType } from './eventContract'

test('resolveEventType maps canonical values for shared aliases', () => {
  assert.equal(resolveEventType({ canonical_type: 'system.info', type: 'legacy_info' }), 'info')
  assert.equal(resolveEventType({ canonical_type: 'phase.failed', type: 'legacy_phase_failed' }), 'phase_failed')
  assert.equal(resolveEventType({ canonical_type: 'pipeline.done', type: 'legacy_pipeline_done' }), 'pipeline_done')
  assert.equal(resolveEventType({ canonical_type: 'artifact.files_written', type: 'legacy_files_written' }), 'files_written')
  assert.equal(resolveEventType({ canonical_type: 'session.killed', type: 'legacy_killed' }), 'session_killed')
  assert.equal(resolveEventType({ canonical_type: 'run.alternative_selected', type: 'legacy_alt' }), 'alternative_selected')
})

test('resolveEventType honors explicit overrides before defaults', () => {
  const evt = { canonical_type: 'run.done', type: 'done' }
  assert.equal(resolveEventType(evt, { 'run.done': 'pipeline_done' }), 'pipeline_done')
})

test('resolveEventType falls back to raw type for unknown canonical values', () => {
  const evt = { canonical_type: 'custom.event', type: 'custom_legacy' }
  assert.equal(resolveEventType(evt), 'custom_legacy')
})

test('resolveEventType returns empty string when no canonical type and no type', () => {
  assert.equal(resolveEventType({}), '')
})
