const commandOrReply = /^<message device="([^"]+)"[^>]*message="\[DEBUG\] (CMD|RES) &lt;(.*?)&gt;"/

export function makeDebugChangeFilter() {
  const lastReply = new Map<string, string>()
  const waitingByDevice = new Map<string, { readonly command: string; readonly xml: string }>()

  return {
    pass(xml: string): ReadonlyArray<string> {
      const line = commandOrReply.exec(xml)

      if (!line) return [xml]

      const [, device = '', kind, value = ''] = line
      const waiting = waitingByDevice.get(device)

      if (kind === 'CMD') {
        waitingByDevice.set(device, { command: value, xml })

        return waiting ? [waiting.xml] : []
      }

      if (!waiting) return [xml]

      waitingByDevice.delete(device)
      const key = `${device} ${waiting.command}`

      if (lastReply.get(key) === value) return []
      lastReply.set(key, value)

      return [waiting.xml, xml]
    },
    forget() {
      lastReply.clear()
      waitingByDevice.clear()
    },
  }
}
