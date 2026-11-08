/**
 * INDI boundary: the property mirror. The last definition and update of every
 * property of every device, as immutable snapshots, built from def/set/del
 * messages. Answers "what does the driver currently say" without a round trip.
 */
import type {
  ElementDefinition,
  ElementUpdate,
  IndiMessage,
  Permission,
  PropertyKind,
  PropertyState,
  SwitchRule,
  VectorDefinition,
  VectorUpdate,
} from './xml.ts'

export interface Property {
  readonly device: string
  readonly name: string
  readonly kind: PropertyKind
  readonly state: PropertyState
  readonly perm: Permission
  readonly rule?: SwitchRule
  readonly elements: ReadonlyMap<string, ElementDefinition>
}

export class Mirror {
  private readonly devices = new Map<string, Map<string, Property>>()

  property(device: string, name: string): Property | undefined {
    return this.devices.get(device)?.get(name)
  }

  properties(device: string): ReadonlyArray<Property> {
    return [...(this.devices.get(device)?.values() ?? [])]
  }

  apply(message: IndiMessage) {
    switch (message.type) {
      case 'def':
        this.define(message.vector)
        break
      case 'set':
        this.update(message.vector)
        break
      case 'del':
        this.delete(message.device, message.name)
        break
    }
  }

  private define(vector: VectorDefinition) {
    const property: Property = {
      device: vector.device,
      name: vector.name,
      kind: vector.kind,
      state: vector.state,
      perm: vector.perm,
      ...(vector.rule === undefined ? {} : { rule: vector.rule }),
      elements: new Map(vector.elements.map(element => [element.name, element])),
    }

    this.store(property)
  }

  private update(vector: VectorUpdate) {
    const current = this.property(vector.device, vector.name)

    if (!current || current.kind !== vector.kind) return

    const elements = new Map(current.elements)

    for (const update of vector.elements) {
      const element = elements.get(update.name)

      if (!element) continue
      elements.set(update.name, merge(element, update))
    }

    const property: Property = { ...current, state: vector.state ?? current.state, elements }

    this.store(property)
  }

  private delete(device: string, name: string | undefined) {
    if (name === undefined) this.devices.delete(device)
    else this.devices.get(device)?.delete(name)
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

function merge(element: ElementDefinition, update: ElementUpdate): ElementDefinition {
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
