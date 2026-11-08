const base = 'http://viewer'

export function requestUrl(target: string | undefined): URL | undefined {
  const path = target ?? '/'

  return URL.canParse(path, base) ? new URL(path, base) : undefined
}
