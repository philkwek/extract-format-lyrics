import { describe, expect, it } from 'vitest'
import { resolveExtractionModel } from '../src/extractionModel.js'

const serverDefault = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite'

describe('resolveExtractionModel', () => {
  it('ignores the requested model when the caller supplies no API key', () => {
    expect(resolveExtractionModel('caller-model', undefined)).toBe(serverDefault)
    expect(resolveExtractionModel('caller-model', '')).toBe(serverDefault)
    expect(resolveExtractionModel('caller-model', '   ')).toBe(serverDefault)
  })

  it('uses the requested model when the caller supplies an API key', () => {
    expect(resolveExtractionModel('caller-model', 'caller-key')).toBe('caller-model')
  })

  it('falls back to the server default when no model is requested', () => {
    expect(resolveExtractionModel(undefined, 'caller-key')).toBe(serverDefault)
  })
})
