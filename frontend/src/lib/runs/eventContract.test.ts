import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeEvent, isKnownKind } from './eventContract'

const ALL_KINDS = [
  'phase_start', 'phase_end', 'agent_start',
  'tool_call', 'tool_result',
  'model_request', 'model_response',
  'approval_gate', 'user_intervention', 'error',
]

function makeFixture(kind: string): Record<string, unknown> {
  return {
    id: `evt-${kind}`,
    run_id: 'run-1',
    phase_id: 'phase-1',
    kind,
    summary: `Test ${kind}`,
    duration_ms: 100,
    tokens_in: 50,
    tokens_out: 25,
    cost_usd: 0.001,
    created_at: '2026-05-13T12:00:00Z',
  }
}

describe('normalizeEvent', () => {
  for (const kind of ALL_KINDS) {
    it(`parses ${kind} cleanly`, () => {
      const result = normalizeEvent(makeFixture(kind))
      assert.notEqual(result, null)
      assert.equal(result!.id, `evt-${kind}`)
      assert.equal(result!.kind, kind)
      assert.equal(result!.summary, `Test ${kind}`)
      assert.equal(result!.run_id, 'run-1')
      assert.equal(result!.phase_id, 'phase-1')
      assert.equal(result!.duration_ms, 100)
      assert.equal(result!.tokens_in, 50)
      assert.equal(result!.tokens_out, 25)
    })
  }

  it('returns null for missing id', () => {
    const result = normalizeEvent({ kind: 'error', summary: 'oops' })
    assert.equal(result, null)
  })

  it('returns null for missing kind', () => {
    const result = normalizeEvent({ id: 'x', summary: 'oops' })
    assert.equal(result, null)
  })

  it('returns null for null input', () => {
    const result = normalizeEvent(null as any)
    assert.equal(result, null)
  })

  it('accepts unknown kind without throwing', () => {
    const result = normalizeEvent({
      id: 'evt-mystery',
      kind: 'future_kind_v2',
      run_id: 'r1',
      summary: 'future event',
    })
    assert.notEqual(result, null)
    assert.equal(result!.kind, 'future_kind_v2')
  })

  it('handles missing optional fields gracefully', () => {
    const result = normalizeEvent({
      id: 'evt-minimal',
      kind: 'tool_call',
    })
    assert.notEqual(result, null)
    assert.equal(result!.summary, '')
    assert.equal(result!.phase_id, null)
    assert.equal(result!.duration_ms, null)
    assert.equal(result!.tokens_in, null)
    assert.equal(result!.cost_usd, null)
  })
})

describe('isKnownKind', () => {
  for (const kind of ALL_KINDS) {
    it(`recognizes ${kind}`, () => {
      assert.equal(isKnownKind(kind), true)
    })
  }

  it('rejects unknown kind', () => {
    assert.equal(isKnownKind('banana'), false)
  })
})

describe('breakpoints (pure logic)', () => {
  it('isWideLayout returns true at 1400', async () => {
    const { isWideLayout } = await import('./breakpoints')
    assert.equal(isWideLayout(1400), true)
  })

  it('isWideLayout returns false at 1399', async () => {
    const { isWideLayout } = await import('./breakpoints')
    assert.equal(isWideLayout(1399), false)
  })

  it('grid template constants are defined', async () => {
    const { RUN_VIEWER_GRID_WIDE, RUN_VIEWER_GRID_NARROW } = await import('./breakpoints')
    assert.ok(RUN_VIEWER_GRID_WIDE.includes('130px'))
    assert.ok(RUN_VIEWER_GRID_NARROW.includes('130px'))
    assert.ok(RUN_VIEWER_GRID_WIDE.includes('0.9fr'))
    assert.ok(!RUN_VIEWER_GRID_NARROW.includes('0.9fr'))
  })
})
