// VitePress default theme; content lives in repo-docs.
import { guideLinks } from './guide-links.mts'

const pages = {
  "change-log.md": "change-log",
  "code-map.md": "code-map",
  "README.md": "",
  "glossary.md": "glossary",
  "modules/access-and-config.md": "modules/access-and-config",
  "modules/platform-adapters.md": "modules/platform-adapters",
  "modules/routing-and-protocols.md": "modules/routing-and-protocols",
  "modules/upstream-and-quota.md": "modules/upstream-and-quota",
  "references/quality-review.md": "references/quality-review",
  "references/source-evidence.md": "references/source-evidence",
  "walkthroughs/one-real-run.md": "walkthroughs/one-real-run"
}

const localSearchIds = ['/@localSearchIndex', '/@localSearchIndexroot']

export default {
  lang: 'zh-CN',
  title: "模桥 · ModelBridge 源码指南",
  cleanUrls: true,
  markdown: { config: guideLinks(pages) },
  vite: {
    plugins: [{
      // VitePress 1.x accepts this URL in its client HMR handler, but only
      // resolves the bare import. Vite 6 also resolves accepted HMR dependencies.
      name: 'vitepress-local-search-vite6-compat',
      enforce: 'pre',
      resolveId(id) {
        if (localSearchIds.includes(id)) return id
      },
    }],
  },
  themeConfig: {
    siteTitle: "ModelBridge",
    nav: [{ text: '阅读路径', link: '/' }],
    sidebar: [{ text: '源码指南', items: [
  {
    "text": "阅读路径",
    "link": "/"
  },
  {
    "text": "一次真实主流程",
    "link": "/walkthroughs/one-real-run"
  },
  {
    "text": "代码地图",
    "link": "/code-map"
  },
  {
    "text": "访问与配置",
    "link": "/modules/access-and-config"
  },
  {
    "text": "多平台部署",
    "link": "/modules/platform-adapters"
  },
  {
    "text": "路由与协议",
    "link": "/modules/routing-and-protocols"
  },
  {
    "text": "上游与配额",
    "link": "/modules/upstream-and-quota"
  },
  {
    "text": "术语表",
    "link": "/glossary"
  },
  {
    "text": "源码证据",
    "link": "/references/source-evidence"
  },
  {
    "text": "文档质量复核",
    "link": "/references/quality-review"
  },
  {
    "text": "同步记录",
    "link": "/change-log"
  }
] }],
    search: { provider: 'local' },
    outline: { level: [2, 3], label: '本页目录' },
    docFooter: { prev: '上一页', next: '下一页' },
  },
}
