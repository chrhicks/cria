import { describe, expect, it } from 'vitest'
import { RepeatCounter } from './repeats.js'

describe('a driver repeating a definition within one answer', () => {
  it('counts identical definitions in a row as copies', () => {
    const counter = new RepeatCounter()

    counter.ask(undefined, undefined)
    for (const signature of ['a', 'a', 'a']) counter.define('Sim', 'ACTIVE_DEVICES', signature)
    counter.define('Sim', 'DEBUG', 'x')

    expect(counter.repeats()).toEqual(new Map([['Sim.ACTIVE_DEVICES', 3]]))
  })

  it('does not count a definition that changed, or two answers to two asks', () => {
    const counter = new RepeatCounter()

    counter.ask('Sim', undefined)
    counter.define('Sim', 'CCD_INFO', 'before')
    counter.define('Sim', 'CCD_INFO', 'after')
    counter.define('Sim', 'DEBUG', 'x')
    counter.ask('Sim', undefined)
    counter.define('Sim', 'DEBUG', 'x')
    counter.ask('Sim', 'DEBUG')
    counter.define('Sim', 'DEBUG', 'x')

    expect(counter.repeats()).toEqual(new Map())
  })

  it('does not count copies on either side of an update or a deletion of the property', () => {
    const counter = new RepeatCounter()

    counter.define('Sim', 'FPS', 'x')
    counter.changed('Sim', 'FPS')
    counter.define('Sim', 'FPS', 'x')
    counter.changed('Sim', undefined)
    counter.define('Sim', 'FPS', 'x')

    expect(counter.repeats()).toEqual(new Map())
  })

  it('keeps the longest run seen, and keeps devices apart', () => {
    const counter = new RepeatCounter()

    counter.define('A', 'P', 'x')
    counter.define('A', 'P', 'x')
    counter.ask(undefined, undefined)
    counter.define('A', 'P', 'x')
    counter.define('B', 'P', 'x')

    expect(counter.repeats()).toEqual(new Map([['A.P', 2]]))
  })

  it('does not count the same list sent twice in a row, as when a connection brings definitions and an answer follows, but keeps a copy inside a list', () => {
    const counter = new RepeatCounter()

    for (const [name, signature] of [['CONNECTION', 'c'], ['ACTIVE_DEVICES', 'a'], ['ACTIVE_DEVICES', 'a'], ['MOUNT_TYPE', 'm'], ['CONNECTION', 'c'], ['ACTIVE_DEVICES', 'a'], ['ACTIVE_DEVICES', 'a'], ['MOUNT_TYPE', 'm']] as const) counter.define('Sim', name, signature)

    expect(counter.repeats()).toEqual(new Map([['Sim.ACTIVE_DEVICES', 2]]))
  })
})
