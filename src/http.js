/**
 * Minimal JSON response helper for this plugin's routes.
 *
 * @module @hjdd14/dsh-toolong-warning/src/http
 */

/**
 * Write one JSON response.
 * @param res - the server response.
 * @param status - HTTP status code.
 * @param body - JSON-serializable body.
 * @param headers - extra response headers.
 */
export function writeJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    ...headers,
  })
  res.end(payload)
}
