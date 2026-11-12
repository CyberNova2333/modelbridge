// VitePress 官方文档配置 (Coolify 架构风格 + 中英双语支持)
import { defineConfig } from 'vitepress'
import { guideLinks } from './guide-links.mts'

const pages: Record<string, string> = {
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

export default defineConfig({
  markdown: { config: guideLinks(pages) },
  vite: {
    plugins: [{
      name: 'vitepress-local-search-vite6-compat',
      enforce: 'pre',
      resolveId(id: string) {
        if (localSearchIds.includes(id)) return id
      },
    }],
  },
  cleanUrls: true,
  locales: {
    root: {
      label: '简体中文',
      lang: 'zh-CN',
      title: "ModelBridge 官方文档",
      description: "ModelBridge 是统一的大语言模型协议桥接与流式分发中间件。",
      themeConfig: {
        siteTitle: "ModelBridge 适配总线",
        nav: [
          { text: '官网首页', link: '/' },
          { text: '快速入门', link: '/docs/' },
          { text: '系统架构', link: '/docs/architecture' },
          { text: '配置指南', link: '/docs/configuration' },
          { text: '常见问题', link: '/docs/faq' },
          { text: 'GitHub', link: 'https://github.com/CyberNova2333/modelbridge' },
        ],
        sidebar: [
          {
            text: '快速入门',
            items: [
              { text: '项目概览与上手', link: '/docs/' },
            ]
          },
          {
            text: '系统架构',
            items: [
              { text: '架构设计与全景图', link: '/docs/architecture' },
            ]
          },
          {
            text: '配置与实践',
            items: [
              { text: '配置与使用指南', link: '/docs/configuration' },
            ]
          },
          {
            text: '运维与支持',
            items: [
              { text: '常见问题与排错', link: '/docs/faq' },
            ]
          }
        ],
        outline: { level: [2, 3], label: '本页目录' },
        docFooter: { prev: '上一页', next: '下一页' },
      }
    },
    en: {
      label: 'English',
      lang: 'en-US',
      link: '/en/',
      title: "ModelBridge Documentation",
      description: "ModelBridge is a unified Large Language Model protocol bridge and streaming distribution middleware.",
      themeConfig: {
        siteTitle: "ModelBridge Bus",
        nav: [
          { text: 'Home', link: '/en/' },
          { text: 'Quick Start', link: '/en/docs/' },
          { text: 'Architecture', link: '/en/docs/architecture' },
          { text: 'Configuration', link: '/en/docs/configuration' },
          { text: 'FAQ', link: '/en/docs/faq' },
          { text: 'GitHub', link: 'https://github.com/CyberNova2333/modelbridge' },
        ],
        sidebar: [
          {
            text: 'Quick Start',
            items: [
              { text: 'Overview & Getting Started', link: '/en/docs/' },
            ]
          },
          {
            text: 'Architecture',
            items: [
              { text: 'Architecture Design', link: '/en/docs/architecture' },
            ]
          },
          {
            text: 'Configuration & Practice',
            items: [
              { text: 'Configuration Guide', link: '/en/docs/configuration' },
            ]
          },
          {
            text: 'Operations & Support',
            items: [
              { text: 'FAQ & Diagnostics', link: '/en/docs/faq' },
            ]
          }
        ],
        outline: { level: [2, 3], label: 'On this page' },
        docFooter: { prev: 'Previous page', next: 'Next page' },
      }
    }
  },
  themeConfig: {
    search: { provider: 'local' },
  }
})
