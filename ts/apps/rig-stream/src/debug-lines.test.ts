import { describe, expect, it } from 'vitest'
import { makeDebugChangeFilter } from './debug-lines.js'

const debug = (kind: string, value: string, second = 1) =>
  `<message device="ZWO AM5" timestamp="2026-11-05T12:00:0${second}" message="[DEBUG] ${kind} &lt;${value}&gt;"/>\n`

describe('makeDebugChangeFilter', () => {
  it('passes a command and reply the first time, drops repeats, and passes the pair again when the reply changes', () => {
    const filter = makeDebugChangeFilter()

    expect(filter.pass(debug('CMD', ':GU#'))).toEqual([])
    expect(filter.pass(debug('RES', 'nNGM0#'))).toEqual([debug('CMD', ':GU#'), debug('RES', 'nNGM0#')])

    expect(filter.pass(debug('CMD', ':GU#', 2))).toEqual([])
    expect(filter.pass(debug('RES', 'nNGM0#', 2))).toEqual([])

    expect(filter.pass(debug('CMD', ':GU#', 3))).toEqual([])
    expect(filter.pass(debug('RES', 'nGM9#', 3))).toEqual([debug('CMD', ':GU#', 3), debug('RES', 'nGM9#', 3)])
  })

  it('tracks each command separately', () => {
    const filter = makeDebugChangeFilter()

    filter.pass(debug('CMD', ':GU#'))
    filter.pass(debug('RES', 'same#'))
    filter.pass(debug('CMD', ':Gm#'))

    expect(filter.pass(debug('RES', 'same#'))).toEqual([debug('CMD', ':Gm#'), debug('RES', 'same#')])
  })

  it('keeps a command that gets no reply, and everything that is not a command or reply', () => {
    const filter = makeDebugChangeFilter()
    const other = '<setNumberVector device="ZWO AM5" name="EQUATORIAL_EOD_COORD"/>\n'

    filter.pass(debug('CMD', ':hC#'))

    expect(filter.pass(debug('CMD', ':GU#'))).toEqual([debug('CMD', ':hC#')])
    expect(filter.pass(other)).toEqual([debug('CMD', ':GU#'), other])
    expect(filter.pass('<message device="ZWO AM5" message="[INFO] Arrived at home."/>\n')).toEqual(['<message device="ZWO AM5" message="[INFO] Arrived at home."/>\n'])
  })

  it('passes the reply again after forgetting, as after a lost connection', () => {
    const filter = makeDebugChangeFilter()

    filter.pass(debug('CMD', ':GU#'))
    filter.pass(debug('RES', 'nNGM0#'))
    filter.forget()
    filter.pass(debug('CMD', ':GU#', 2))

    expect(filter.pass(debug('RES', 'nNGM0#', 2))).toEqual([debug('CMD', ':GU#', 2), debug('RES', 'nNGM0#', 2)])
  })
})
