/**
 * Loopback trust fence for this plugin's read-only route.
 *
 * The state route exposes prompt/context occupancy and token totals for a
 * session — the same class of information `dsh-usage` fences — so it accepts
 * the desktop's own browser and nothing else: a loopback socket address AND a
 * loopback `Host`, plus the browser's same-origin markers. `X-Forwarded-For`
 * is never trusted.
 *
 * Semantics follow the ecosystem's shared fence (see the copies shipped with
 * `@linxin666/dsh-usage`, `dsh-pet`, `dsh-skill-explorer`): RFC 5735 IPv4
 * 127/8, `::1`, IPv4-mapped `::ffff:127/8`, `localhost`, and an `Origin` that
 * matches the request's own authority.
 *
 * @module @hjdd14/dsh-toolong-warning/src/loopback
 */

/**
 * IPv4 127/8 predicate (four decimal octets, first equal to 127).
 * @param value - dotted-quad string.
 * @returns true for the loopback range.
 */
export function isIPv4Loopback(value) {
  const parts = value.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/**
 * Whether a socket remote address is loopback.
 * @param address - `request.socket.remoteAddress`.
 * @returns true for 127/8, `::1`, or `::ffff:127/8`.
 */
export function isLoopbackAddress(address) {
  if (typeof address !== 'string') return false
  const normalized = address.toLowerCase()
  if (normalized === '::1') return true
  if (normalized.startsWith('::ffff:')) return isIPv4Loopback(normalized.slice('::ffff:'.length))
  return isIPv4Loopback(normalized)
}

/**
 * Whether a hostname names the loopback authority.
 * @param hostname - a URL hostname.
 * @returns true for `localhost`, `[::1]`, or 127/8.
 */
export function isLoopbackHostname(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  return isIPv4Loopback(hostname)
}

/**
 * The request-level fence.
 * @param request - the incoming request.
 * @returns true only for a same-origin loopback request.
 */
export function isLoopbackRequest(request) {
  try {
    if (!isLoopbackAddress(request.socket?.remoteAddress)) return false
    const host = request.headers?.host
    if (typeof host !== 'string') return false
    let hostUrl
    try {
      hostUrl = new URL(`http://${host}`)
    } catch {
      return false
    }
    if (!isLoopbackHostname(hostUrl.hostname)) return false
    if (request.headers['sec-fetch-site'] === 'cross-site') return false
    const origin = request.headers.origin
    if (origin === undefined) return true
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}
