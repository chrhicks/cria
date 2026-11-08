import { describe, expect, it } from 'vitest'
import { requestUrl } from './url.ts'

describe('the URL of a request', () => {
  it('reads the path and the query', () => {
    expect(requestUrl('/events?since=5&problems')?.pathname).toBe('/events')
    expect(requestUrl('/events?since=5&problems')?.searchParams.get('since')).toBe('5')
    expect(requestUrl(undefined)?.pathname).toBe('/')
  })

  it('is nothing for a target that is not a URL, which the server answers with 400 instead of throwing', () => {
    expect(requestUrl('//')).toBeUndefined()
    expect(requestUrl('http://')).toBeUndefined()
  })
})
