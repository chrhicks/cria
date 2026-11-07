export async function until<A>(what: string, probe: () => A | undefined | false | Promise<A | undefined | false>, timeoutMs = 15_000): Promise<A> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const found = await probe()

    if (found !== undefined && found !== false) return found
    await new Promise(resolve => setTimeout(resolve, 25))
  }

  throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}`)
}
