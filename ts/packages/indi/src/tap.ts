/**
 * INDI boundary: the traffic tap. The client reports every element it sends or
 * receives to an optional tap, in the order it saw them. This is the only
 * recording concept `@cria/indi` knows; the recorder lives in `@cria/recording`.
 */

/** `in` is indiserver to Cria, `out` is Cria to indiserver. */
export type Direction = 'in' | 'out'

export interface TappedMessage {
  /** The TCP session, counted from 1 by the client. */
  readonly conn: number
  readonly dir: Direction
  /**
   * The wire text of one top-level element as the client saw it, not
   * re-serialized from the parsed message: `IndiMessage` drops `rule`, `group`,
   * `format` and every element the parser ignores, and replay needs them. Every
   * BLOB payload is elided to a self-closing `<oneBLOB .../>`.
   */
  readonly xml: string
  /** The decoded payload of each elided `oneBLOB`, in document order. The tap owns the buffers from here. */
  readonly blobs: ReadonlyArray<Buffer>
}

export type TappedConnection =
  | { readonly conn: number; readonly status: 'connected' }
  | { readonly conn: number; readonly status: 'closed'; readonly error: string }

/**
 * Contract: returns at once, never throws, does no I/O. A broken tap must not be
 * able to slow or break the socket. The tap stamps its own times.
 */
export interface TrafficTap {
  readonly message: (message: TappedMessage) => void
  readonly connection: (connection: TappedConnection) => void
}
