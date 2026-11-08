import type { ElementValue } from '../indi/index.ts'
import type { WireBody } from '../stream/entry.ts'

export interface Reading {
  readonly state: string | undefined
  readonly elements: Readonly<Record<string, ElementValue>>
}

export interface Replayed {
  readonly key: string
  readonly changed: boolean
  readonly known: boolean
  readonly current: Reading | undefined
}

export function makeReplay() {
  const devices = new Map<string, Map<string, Reading>>()

  function same(before: Reading, after: Reading) {
    const names = Object.keys(after.elements)

    return before.state === after.state && names.length === Object.keys(before.elements).length && names.every(name => before.elements[name] === after.elements[name])
  }

  return {
    apply(body: WireBody): Replayed | undefined {
      const { indiDevice, property, type } = body

      if (indiDevice === undefined || (type !== 'def' && type !== 'set' && type !== 'del')) return undefined

      const properties = devices.get(indiDevice) ?? new Map<string, Reading>()

      if (type === 'del') {
        const gone = property === undefined ? [...properties.keys()] : properties.has(property) ? [property] : []

        for (const name of gone) properties.delete(name)
        if (property === undefined) devices.delete(indiDevice)

        return property === undefined ? undefined : { key: `${indiDevice}.${property}`, changed: gone.length > 0, known: gone.length > 0, current: undefined }
      }

      if (property === undefined) return undefined

      const before = properties.get(property)
      const given = body.elements ?? {}
      const after: Reading = {
        state: body.state ?? before?.state,
        elements: type === 'def' || before === undefined ? given : { ...before.elements, ...given },
      }

      properties.set(property, after)
      devices.set(indiDevice, properties)

      return { key: `${indiDevice}.${property}`, changed: before === undefined || !same(before, after), known: before !== undefined, current: after }
    },

    reset() {
      devices.clear()
    },
  }
}
