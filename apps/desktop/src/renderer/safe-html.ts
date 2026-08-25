const POLICY = [
  "default-src 'none'",
  "img-src data: blob:",
  "media-src data: blob:",
  "font-src data:",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "navigate-to 'none'",
].join("; ")

const META = `<meta http-equiv="Content-Security-Policy" content="${POLICY}">`

/** HTML 在无同源权限的 iframe 里跑；这层 CSP 再切掉网络、表单与嵌套页面。 */
export function sandboxHtml(source: string): string {
  const head = /<head(?:\s[^>]*)?>/i.exec(source)
  if (head?.index !== undefined) {
    const at = head.index + head[0].length
    return `${source.slice(0, at)}${META}${source.slice(at)}`
  }
  const html = /<html(?:\s[^>]*)?>/i.exec(source)
  if (html?.index !== undefined) {
    const at = html.index + html[0].length
    return `${source.slice(0, at)}<head>${META}</head>${source.slice(at)}`
  }
  return `<head>${META}</head>${source}`
}
