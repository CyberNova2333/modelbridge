// VitePress 官方文档配置（Tier B 三阶段渐进式导航 + 中英双语支持）
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
      title: "模桥 ModelBridge 官方文档",
      description: "基于 Cloudflare Workers 与自建 Node.js 24 SQLite 状态服务的多协议 LLM API 网关（OpenAI / Anthropic / Gemini）。",
      themeConfig: {
        siteTitle: "模桥 ModelBridge",
        nav: [
          { text: '首页', link: '/' },
          { text: '起步与部署', link: '/docs/' },
          { text: '契约与扩展', link: '/docs/contracts' },
          { text: 'API 与组件', link: '/api-reference/' },
          { text: '原理与源码', link: '/docs/architecture' },
        ],
        socialLinks: [
          { icon: 'github', link: 'https://github.com/CyberNova2333/modelbridge' },
        ],
        sidebar: [
          {
            text: '起步与配置部署',
            items: [
              { text: '项目全貌与多平台部署', link: '/docs/' },
              { text: '部署运维与排错 FAQ', link: '/docs/deployment-faq' },
            ]
          },
          {
            text: '接口与扩展契约',
            items: [
              { text: '接口、安全与路由契约', link: '/docs/contracts' },
              { text: 'API 与组件参考', link: '/api-reference/' },
              { text: '上游容错与扩展指南', link: '/docs/adapters' },
            ]
          },
          {
            text: '原理与源码导览',
            items: [
              { text: '架构全景与模块交互', link: '/docs/architecture' },
              { text: '关键架构决策与迁移', link: '/docs/migrations' },
              { text: '源码走读：一次完整请求', link: '/walkthroughs/one-real-run' },
              { text: '代码地图（Code Map）', link: '/code-map' },
              { text: '模块：访问与配置存储', link: '/modules/access-and-config' },
              { text: '模块：路由与协议转换', link: '/modules/routing-and-protocols' },
              { text: '模块：上游、OAuth 与配额', link: '/modules/upstream-and-quota' },
              { text: '模块：边缘平台与自建状态', link: '/modules/platform-adapters' },
              { text: '核心术语表与证据索引', link: '/glossary' },
              { text: '源码证据与质量审查', link: '/references/source-evidence' },
              { text: '文档校准与验证记录', link: '/change-log' },
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
      description: "Multi-protocol LLM API proxy across OpenAI, Anthropic, and Gemini on Cloudflare Workers, EdgeOne Makers, Alibaba Cloud ESA, and Node.js 24 + SQLite.",
      themeConfig: {
        siteTitle: "ModelBridge",
        nav: [
          { text: 'Home', link: '/en/' },
          { text: 'Deployment', link: '/en/docs/' },
          { text: 'Contracts', link: '/en/docs/contracts' },
          { text: 'API & Endpoints', link: '/en/api-reference/' },
          { text: 'Architecture', link: '/en/docs/architecture' },
        ],
        socialLinks: [
          { icon: 'github', link: 'https://github.com/CyberNova2333/modelbridge' },
        ],
        sidebar: [
          {
            text: 'Getting Started & Deployment',
            items: [
              { text: 'Overview & Multi-Platform Matrix', link: '/en/docs/' },
              { text: 'Deployment & Operations FAQ', link: '/en/docs/deployment-faq' },
            ]
          },
          {
            text: 'Contracts & Extension',
            items: [
              { text: 'API, Security & Routing Contracts', link: '/en/docs/contracts' },
              { text: 'API & Component Reference', link: '/en/api-reference/' },
              { text: 'Failover, Adapters & Extensions', link: '/en/docs/adapters' },
            ]
          },
          {
            text: 'Architecture & Code Tour',
            items: [
              { text: 'Architecture & Module Overview', link: '/en/docs/architecture' },
              { text: 'Architecture Decisions & Migrations', link: '/en/docs/migrations' },
              { text: 'Source Guide Index (repo-docs)', link: '/en/walkthroughs/one-real-run' },
              { text: 'Code Map & Module Reference', link: '/en/code-map' },
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
