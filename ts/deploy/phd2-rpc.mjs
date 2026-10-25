#!/usr/bin/env node
// phd2-rpc: one step at a time against PHD2's event server, for the supervised
// night. Run it on errai; it prints every line PHD2 sends and sends only the step
// you name, nothing else, nothing on its own:
//
//   node phd2-rpc.mjs state | connect | loop | find-star | guide | dither | stop | disconnect
//   node phd2-rpc.mjs watch [SECONDS]        send nothing, print events
//
// Options: --port N (4400), --host H (127.0.0.1), --wait SECONDS (how long to wait
// for the answer), --pixels N (dither size, 3), --recalibrate (guide).
// `guide` and `dither` return once PHD2 reports SettleDone, so the exit code says
// whether it settled. `stop` returns once get_app_state, a read, says Stopped.
// Exiting never undoes a step, and a timeout leaves the outcome unknown: PHD2 may
// still be calibrating or guiding, so check with `state` and do not run the step
// again blindly. Exit 0 worked, 1 bad arguments, 2 PHD2 said no, timed out or
// could not be reached.
//
// The wire format is in docs/runtime.md ("PHD2 on errai"): requests are one JSON
// object per line, replies and events are JSON lines ending in CRLF. Node built-ins only.
import { connect } from 'node:net'
import { fileURLToPath } from 'node:url'

/** The settle tolerance Chris chose in the rig-guiding spec (2026-10-24). */
export const settle = { pixels: 1.5, time: 10, timeout: 90 }

export const ditherPixels = 3

const defaults = { host: '127.0.0.1', port: 4400 }

/**
 * Each subcommand is one JSON-RPC call. `done` says what counts as finished:
 * `reply`, the JSON-RPC reply; `settle`, PHD2 answers at once and reports the
 * outcome later in a SettleDone event; `stopped`, PHD2 answers once it has been
 * asked, and get_app_state is read until it says Stopped.
 * @typedef {{ method: string, params?: object, done: 'reply' | 'settle' | 'stopped', waitSeconds: number }} Step
 * @type {Record<string, (options: { pixels: number, recalibrate: boolean }) => Step>}
 */
export const steps = {
  state: () => ({ method: 'get_app_state', done: 'reply', waitSeconds: 10 }),
  connect: () => ({ method: 'set_connected', params: { connected: true }, done: 'reply', waitSeconds: 120 }),
  disconnect: () => ({ method: 'set_connected', params: { connected: false }, done: 'reply', waitSeconds: 60 }),
  loop: () => ({ method: 'loop', done: 'reply', waitSeconds: 10 }),
  'find-star': () => ({ method: 'find_star', done: 'reply', waitSeconds: 30 }),
  // PHD2 starts the settle clock after calibration, which takes minutes the first time.
  guide: ({ recalibrate }) => ({ method: 'guide', params: { settle, recalibrate }, done: 'settle', waitSeconds: 900 }),
  dither: ({ pixels }) => ({ method: 'dither', params: { amount: pixels, raOnly: false, settle }, done: 'settle', waitSeconds: settle.timeout + 30 }),
  stop: () => ({ method: 'stop_capture', done: 'stopped', waitSeconds: 30 }),
}

/** @param {number} id @param {Step} step */
export function encodeRequest(id, { method, params }) {
  return `${JSON.stringify({ method, ...(params && { params }), id })}\r\n`
}

/** Splits a byte stream into lines; a line may arrive in pieces, and PHD2 ends each with CRLF. */
export class LineReader {
  #pending = ''

  /** @param {string} chunk @returns {string[]} */
  push(chunk) {
    this.#pending += chunk
    const lines = this.#pending.split('\n')
    this.#pending = lines.pop()
    return lines.map(line => line.replace(/\r$/, '')).filter(line => line !== '')
  }
}

/**
 * @param {string} line
 * @returns {{ kind: 'reply', id: unknown, result?: unknown, error?: string } | { kind: 'event', name: string, body: Record<string, unknown> } | { kind: 'other' }}
 */
export function classify(line) {
  let body
  try {
    body = JSON.parse(line)
  } catch {
    return { kind: 'other' }
  }
  if (typeof body !== 'object' || body === null) return { kind: 'other' }
  if (typeof body.Event === 'string') return { kind: 'event', name: body.Event, body }
  if ('id' in body && ('result' in body || 'error' in body)) {
    return { kind: 'reply', id: body.id, result: body.result, ...(body.error && { error: String(body.error.message ?? JSON.stringify(body.error)) }) }
  }
  return { kind: 'other' }
}

/**
 * @param {{ host: string, port: number, step: Step | null, watchSeconds?: number, waitSeconds: number, pollMs?: number }} request
 * @param {{ out: (line: string) => void, err: (line: string) => void }} io
 * @returns {Promise<number>} the exit code
 */
export function runStep({ host, port, step, watchSeconds, waitSeconds, pollMs = 1000 }, { out, err }) {
  const requestId = 1
  const stateId = 2
  return new Promise(resolve => {
    const socket = connect({ host, port })
    const reader = new LineReader()
    let replied = false
    let done = false
    const finish = (code, message) => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (message) err(`phd2-rpc: ${message}`)
      socket.destroy()
      resolve(code)
    }
    const waiting = () => (step.done === 'settle' && replied ? 'SettleDone' : step.done === 'stopped' && replied ? 'Stopped state' : 'reply')
    const timer = setTimeout(
      () => (step ? finish(2, `no ${waiting()} within ${waitSeconds} s. The outcome is unknown: PHD2 may still be working. Run \`state\`; do not repeat the step blindly`) : finish(0)),
      (step ? waitSeconds : watchSeconds) * 1000,
    )
    const askState = () => socket.write(encodeRequest(stateId, { method: 'get_app_state', waitSeconds: 0, done: 'reply' }))

    socket.setEncoding('utf8')
    socket.on('connect', () => {
      if (step) socket.write(encodeRequest(requestId, step))
    })
    socket.on('error', error => finish(2, `${host}:${port}: ${error.message}`))
    socket.on('close', () => finish(2, 'PHD2 closed the connection'))
    socket.on('data', chunk => {
      for (const line of reader.push(chunk)) {
        out(line)
        const message = classify(line)
        if (!step) continue
        if (message.kind === 'reply' && message.id === requestId) {
          if (message.error) return finish(2, `${step.method}: ${message.error}`)
          replied = true
          if (step.done === 'reply') return finish(0)
          if (step.done === 'stopped') askState()
        }
        if (message.kind === 'reply' && message.id === stateId) {
          if (message.result === 'Stopped') return finish(0, 'stopped')
          setTimeout(() => !done && askState(), pollMs)
        }
        if (message.kind === 'event' && message.name === 'SettleDone' && replied && step.done === 'settle') {
          return message.body.Status === 0 ? finish(0, 'settled') : finish(2, `did not settle: ${message.body.Error ?? 'no reason given'}`)
        }
      }
    })
  })
}

/** @param {string[]} args @returns {{ name: string, options: Record<string, string | boolean> } | null} */
export function parseArgs(args) {
  const [name, ...rest] = args
  const options = {}
  const flags = { '--port': true, '--host': true, '--wait': true, '--pixels': true, '--recalibrate': false }
  const positional = []
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index]
    if (!(arg in flags)) {
      positional.push(arg)
      continue
    }
    if (!flags[arg]) options[arg.slice(2)] = true
    else if (rest[++index] === undefined) return null
    else options[arg.slice(2)] = rest[index]
  }
  if (!name || (name !== 'watch' && !(name in steps)) || positional.length > (name === 'watch' ? 1 : 0)) return null
  if (positional.length === 1) options.seconds = positional[0]
  return { name, options }
}

function main() {
  const parsed = parseArgs(process.argv.slice(2))
  const number = (value, fallback) => (value === undefined ? fallback : Number(value))
  const port = number(parsed?.options.port, defaults.port)
  const pixels = number(parsed?.options.pixels, ditherPixels)
  const seconds = number(parsed?.options.seconds, 30)
  const wait = number(parsed?.options.wait, undefined)
  if (!parsed || ![port, pixels, seconds].every(Number.isFinite) || (wait !== undefined && !Number.isFinite(wait)) || pixels <= 0) {
    console.error(`usage: phd2-rpc.mjs ${[...Object.keys(steps), 'watch [SECONDS]'].join(' | ')} [--port N] [--host H] [--wait SECONDS] [--pixels N] [--recalibrate]`)
    process.exit(1)
  }
  const step = parsed.name === 'watch' ? null : steps[parsed.name]({ pixels, recalibrate: parsed.options.recalibrate === true })
  void runStep(
    { host: parsed.options.host ?? defaults.host, port, step, watchSeconds: seconds, waitSeconds: wait ?? step?.waitSeconds ?? 0 },
    { out: line => console.log(line), err: line => console.error(line) },
  ).then(code => process.exit(code))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
