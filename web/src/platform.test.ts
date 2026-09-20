import { describe, expect, it } from 'vitest'
import { classifyTvKey } from './platform'

describe('tv key classifier', () => {
  it('maps arrows and LG D-pad codes to directions', () => {
    expect(classifyTvKey({ key: 'ArrowLeft' })).toBe('left')
    expect(classifyTvKey({ keyCode: 37 })).toBe('left')
    expect(classifyTvKey({ keyCode: 39 })).toBe('right')
    expect(classifyTvKey({ keyCode: 38 })).toBe('up')
    expect(classifyTvKey({ keyCode: 40 })).toBe('down')
  })

  it('maps LG return keys to back', () => {
    expect(classifyTvKey({ key: 'Escape' })).toBe('back')
    expect(classifyTvKey({ key: 'BrowserBack' })).toBe('back')
    expect(classifyTvKey({ keyCode: 461 })).toBe('back')
    expect(classifyTvKey({ keyCode: 10009 })).toBe('back')
  })

  it('maps media keys without stealing directional input', () => {
    expect(classifyTvKey({ keyCode: 415 })).toBe('media-play')
    expect(classifyTvKey({ keyCode: 412 })).toBe('media-rewind')
    expect(classifyTvKey({ key: 'a', keyCode: 65 })).toBeUndefined()
  })
})
