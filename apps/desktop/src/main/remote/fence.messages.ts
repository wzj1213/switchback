import { defineMessages } from "@switchback/i18n"

/** 来路检查不通过的理由（进 403 的回包和日志），以及「隧道那头的域名」填错时设置页上那句。 */
export const REMOTE_FENCE = defineMessages(
  {
    badEntry: (entry: string) => `remote: trustedHosts 里的 ${entry} 不是一个裸 host[:port]`,
    noHost: "没有 Host 头",
    badHost: (host: string) => `Host 解析不了：${host}`,
    untrusted: (host: string) => `Host 既不是回环也不在 trustedHosts 里：${host}`,
    crossSite: "标了 cross-site",
    badOrigin: (origin: string) => `Origin 对不上：${origin}`,
    unreadableOrigin: (origin: string) => `Origin 解析不了：${origin}`,
  },
  {
    badEntry: (entry) => `remote: ${entry} in trustedHosts isn't a bare host[:port]`,
    noHost: "No Host header",
    badHost: (host) => `Can't parse Host: ${host}`,
    untrusted: (host) => `Host is neither loopback nor in trustedHosts: ${host}`,
    crossSite: "Marked cross-site",
    badOrigin: (origin) => `Origin doesn't match: ${origin}`,
    unreadableOrigin: (origin) => `Can't parse Origin: ${origin}`,
  },
)
