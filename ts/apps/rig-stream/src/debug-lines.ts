const commandOrReply = /^<message device="([^"]+)"[^>]*message="\[DEBUG\] (CMD|RES) &lt;(.*?)&gt;"/

export function makeDebugChangeFilter() {
  const lastReply = new Map<string, string>()
  let waiting: { readonly key: string; readonly xml: string } | undefined

  const flushWaiting = () => {
    const held = waiting ? [waiting.xml] : []

    waiting = undefined

    return held
  }

  return {
    pass(xml: string): ReadonlyArray<string> {
      const line = commandOrReply.exec(xml)

      if (!line) return [...flushWaiting(), xml]

      const [, device, kind, value] = line

      if (kind === 'CMD') {
        const held = flushWaiting()

        waiting = { key: `${device} ${value}`, xml }

        return held
      }

      if (!waiting) return [xml]

      const { key, xml: command } = waiting

      waiting = undefined
      if (lastReply.get(key) === value) return []
      lastReply.set(key, value ?? '')

      return [command, xml]
    },
    forget() {
      lastReply.clear()
      waiting = undefined
    },
  }
}
