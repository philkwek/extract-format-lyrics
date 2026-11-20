/// <reference types="node" />
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const html = readFileSync(path.join(process.cwd(), 'index.html'), 'utf8')

describe('index.html', () => {
  it('applies the saved theme in an inline script before the first stylesheet', () => {
    const scriptIndex = html.indexOf('app_theme')
    const stylesheetIndex = html.search(/<link[^>]+rel="stylesheet"/)
    const headStart = html.indexOf('<head>')
    const headEnd = html.indexOf('</head>')

    expect(scriptIndex).toBeGreaterThan(headStart)
    expect(scriptIndex).toBeLessThan(headEnd)
    expect(stylesheetIndex).toBeGreaterThan(scriptIndex)
  })
})
