import type { CommandKind } from '@cria/wire'
import { waitCapSeconds } from './tools/wait.js'

export interface Entry {
  readonly description: string
}

/**
 * The one hand-written list: which commands and routes agents see, with the words they read.
 * A command is a tool only when it is listed here. Its input schema is derived from the wire
 * (input.ts) and every limit stays in Cria, so a description says what the command does and nothing about ranges or policy.
 */
export const commands = {
  capture: {
    description:
      'Take one exposure on a camera. exposureSeconds is the exposure time in seconds; light says whether the shutter opens; frameType is optional. A confirmed outcome carries the image; fetch the frame with `image`.',
  },
  'camera-configure': {
    description: 'Change camera readout settings: binning, the subframe (startX, startY, width, height in binned pixels), gain and offset. Give at least one.',
  },
  cooling: { description: 'Switch the camera cooler on or off and set its target temperature in degrees Celsius. Give at least one of the two.' },
  'focuser-move': { description: 'Move a focuser to an absolute position in steps, inside the travel window you give with minPosition and maxPosition.' },
  'focuser-halt': { description: 'Stop the focuser.' },
  'mount-slew': { description: 'Slew the mount to a right ascension and declination in degrees, in the coordinate system you name.' },
  'mount-tracking': { description: 'Turn mount tracking on or off.' },
  'mount-axis': { description: 'Drive the mount axis at a signed rate in degrees per second for a duration in seconds.' },
  'mount-rotate': { description: 'Move the mount axis by a signed distance in degrees at a signed rate in degrees per second. It ends when the distance is covered, or when `mount-stop` or `cancel` stops it.' },
  'mount-home': { description: 'Send the mount to its home position.' },
  'mount-stop': { description: 'Stop all mount motion.' },
  'mount-park': { description: 'Park the mount.' },
  'mount-unpark': { description: 'Unpark the mount.' },
  'switch-set': { description: 'Set one channel of a switch device (for example power or dew) to a value.' },
  'device-connect': { description: 'Connect a device (connected: true) or disconnect it (connected: false).' },
} as const satisfies { readonly [K in CommandKind]?: Entry }

export type ExposedKind = keyof typeof commands

export const exposedKinds = Object.keys(commands) as ReadonlyArray<ExposedKind>

/** The route tools are written by hand in tools/routes.ts; a tool there reads its words from here, so a route cannot ship without a description. */
export const routes = {
  state: {
    description:
      "Cria's current state: its instanceId, every device with its id, bindingId, name, availability and readings, the holds, the operations in flight and whether commands are enabled. Read it before any command and copy the identity fields from it.",
  },
  operation: {
    description: 'One operation by id: waiting, running with its progress, or settled with its outcome (confirmed, failed, stopped or uncertain) exactly as Cria reports it.',
  },
  wait: {
    description: `Reads an operation once a second until it settles or maxSeconds (1 to ${waitCapSeconds}, default ${waitCapSeconds}) have passed, and returns the last read. An operation still running at the deadline is a normal answer: call wait again in your next call. A failed read ends the wait with that failure. wait is also the way to pause: code-mode has no setTimeout, so to act a few seconds into an operation (for example a mount-stop part way through a mount-rotate), call wait on that operation with a short maxSeconds; it returns early if the operation settles first.`,
  },
  cancel: {
    description: 'Ask Cria to cancel an operation. Returns the operation as Cria reports it. Cria may refuse it, and a refusal comes back unchanged.',
  },
  request: {
    description:
      'The operation a requestId created, for when the answer to a command was lost. Refused as not-found means Cria never admitted that request. Do not send the command again before this answers.',
  },
  recover: {
    description:
      'Clear the hold Cria keeps on a mount after an uncertain outcome. Only a mount is held: a camera, focuser, weather or switch device that ends uncertain stays usable. Only after a person has checked the equipment: externalRecoveryConfirmed must be true and note must say who checked and what they saw. Returns the device as Cria reports it; Cria may refuse it.',
  },
  image: {
    description:
      "Downloads a captured frame to a file on this host and returns the Image, the file's absolute path, its sha256 and its size. Pass the image from a confirmed capture outcome unchanged. The file is Cria's raw imagebytes, checked against the image's sha256, and is deleted after seven days.",
  },
} as const satisfies Record<string, Entry>

export type RouteName = keyof typeof routes
