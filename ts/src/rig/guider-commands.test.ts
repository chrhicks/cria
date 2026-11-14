import { describe, expect, it } from 'vitest'
import type { CommandAnswer } from './commands.ts'
import { createGuiderCommands } from './guider-commands.ts'

function guider(connected: boolean) {
  const sent: Array<string> = []
  const answers: Array<CommandAnswer> = []
  const commands = createGuiderCommands({ send: line => (connected ? (sent.push(line), true) : false), answer: answer => void answers.push(answer), log: () => undefined })

  return { sent, answers, receive: commands.receive }
}

describe('guider commands', () => {
  it('passes the method, its params and the command id to PHD2 unread, and answers written', () => {
    const { sent, answers, receive } = guider(true)

    receive(JSON.stringify({ id: 'vela-1', by: 'vela', method: 'guide', params: { settle: { pixels: 1.5, time: 10, timeout: 90 }, recalibrate: false } }))
    receive(JSON.stringify({ id: 'vela-2', by: 'vela', method: 'stop_capture' }))

    expect(sent).toEqual(['{"method":"guide","params":{"settle":{"pixels":1.5,"time":10,"timeout":90},"recalibrate":false},"id":"vela-1"}', '{"method":"stop_capture","id":"vela-2"}'])
    expect(answers).toEqual([
      { id: 'vela-1', by: 'vela', device: 'phd2', property: 'guide', result: 'written' },
      { id: 'vela-2', by: 'vela', device: 'phd2', property: 'stop_capture', result: 'written' },
    ])
  })

  it('refuses while PHD2 is not connected, and refuses what is not a guider command', () => {
    const away = guider(false)

    away.receive(JSON.stringify({ id: 'vela-1', by: 'vela', method: 'guide' }))

    const here = guider(true)

    here.receive(JSON.stringify({ id: 'vela-2', by: 'vela' }))
    here.receive('not json')

    expect(away.answers).toEqual([{ id: 'vela-1', by: 'vela', device: 'phd2', property: 'guide', result: 'refused', reason: 'PHD2 is not connected' }])
    expect(here.sent).toEqual([])
    expect(here.answers.map(answer => answer.result)).toEqual(['refused', 'refused'])
  })
})
