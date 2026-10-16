/**
 * INDI boundary: the property mirror. The last definition and update of every
 * property of every device, as immutable snapshots, built from def/set/del
 * messages. Answers "what does the driver currently say" without a round trip.
 */
import type {
  ElementDefinition,
  IndiMessage,
  Permission,
  PropertyKind,
  PropertyState,
  VectorDefinition,
  VectorUpdate,
} from './xml.js'

export interface Property {
  readonly device: string
  readonly name: string
  readonly kind: PropertyKind
  readonly label: string
  readonly state: PropertyState
  readonly perm: Permission
  readonly elements: ReadonlyMap<string, ElementDefinition>
  /** The driver's message with the latest definition or update, often the reason for an Alert. */
  readonly message?: string
  /** When Cria last received a definition or update of this property (epoch ms). */
  readonly receivedAt: number
}

export interface Blob {
  readonly device: string
  readonly property: string
  readonly element: string
  readonly format: string
  readonly data: Buffer
  readonly receivedAt: number
}

export type MirrorChange =
  | { readonly type: 'property'; readonly origin: 'def' | 'set'; readonly property: Property }
  | { readonly type: 'deleted'; readonly device: string; readonly name?: string }
  | { readonly type: 'blob'; readonly blob: Blob }

export class Mirror {
  private readonly devices = new Map<string, Map<string, Property>>()

  property(device: string, name: string): Property | undefined {
    return this.devices.get(device)?.get(name)
  }

  properties(device: string): ReadonlyArray<Property> {
    return [...(this.devices.get(device)?.values() ?? [])]
  }

  apply(message: IndiMessage, now: number): MirrorChange[] {
    switch (message.type) {
      case 'def':
        return [this.define(message.vector, now)]
      case 'set':
        return this.update(message.vector, now)
      case 'del':
        return [this.delete(message.device, message.name)]
      default:
        return []
    }
  }

  private define(vector: VectorDefinition, now: number): MirrorChange {
    const property: Property = {
      device: vector.device,
      name: vector.name,
      kind: vector.kind,
      label: vector.label,
      state: vector.state,
      perm: vector.perm,
      ...(vector.message === undefined ? {} : { message: vector.message }),
      elements: new Map(vector.elements.map(element => [element.name, element])),
      receivedAt: now,
    }

    this.store(property)

    return { type: 'property', origin: 'def', property }
  }

  private update(vector: VectorUpdate, now: number): MirrorChange[] {
    const current = this.property(vector.device, vector.name)

    // An update for an undefined property can't be interpreted (no kind, no limits).
    if (!current || current.kind !== vector.kind) return []

    const elements = new Map(current.elements)
    const blobs: MirrorChange[] = []

    for (const update of vector.elements) {
      const element = elements.get(update.name)

      if (!element) continue
      if (update.kind === 'blob') {
        blobs.push({
          type: 'blob',
          blob: { device: vector.device, property: vector.name, element: update.name, format: update.format, data: update.data, receivedAt: now },
        })
        continue
      }

      elements.set(update.name, merge(element, update))
    }

    const { message: _previous, ...rest } = current
    const property: Property = {
      ...rest,
      state: vector.state ?? current.state,
      ...(vector.message === undefined ? {} : { message: vector.message }),
      elements,
      receivedAt: now,
    }

    this.store(property)

    return [...blobs, { type: 'property', origin: 'set', property }]
  }

  private delete(device: string, name: string | undefined): MirrorChange {
    if (name === undefined) {
      this.devices.delete(device)

      return { type: 'deleted', device }
    }

    this.devices.get(device)?.delete(name)

    return { type: 'deleted', device, name }
  }

  private store(property: Property) {
    let properties = this.devices.get(property.device)

    if (!properties) {
      properties = new Map()
      this.devices.set(property.device, properties)
    }

    properties.set(property.name, property)
  }
}

function merge(element: ElementDefinition, update: Exclude<VectorUpdate['elements'][number], { kind: 'blob' }>): ElementDefinition {
  switch (update.kind) {
    case 'number':
      return element.kind === 'number'
        ? {
            ...element,
            value: update.value,
            min: update.min ?? element.min,
            max: update.max ?? element.max,
            step: update.step ?? element.step,
          }
        : element
    case 'switch':
      return element.kind === 'switch' ? { ...element, on: update.on } : element
    case 'text':
      return element.kind === 'text' ? { ...element, value: update.value } : element
    case 'light':
      return element.kind === 'light' ? { ...element, state: update.state } : element
  }
}

/** The name of the switch that is on, for OneOfMany switches like TELESCOPE_TRACK_MODE. */
export function selectedSwitch(property: Property | undefined): string | undefined {
  if (property?.kind !== 'switch') return undefined

  for (const element of property.elements.values()) {
    if (element.kind === 'switch' && element.on) return element.name
  }

  return undefined
}
