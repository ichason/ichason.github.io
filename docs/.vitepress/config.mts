import { defineConfig } from 'vitepress'
import { generateSidebar } from 'vitepress-sidebar'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  base: '/',
  title: "The journey of life",
  description: "Record the moment ",
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: '首页', link: '/' },
      { text: '博客', link: '/posts/' },
      { text: '笔记', link: '/notes/' },
      { text: '关于', link: '/about' }
    ],

    sidebar: generateSidebar([
      {
        documentRootPath: 'docs',
        scanStartPath: 'posts',
        resolvePath: '/posts/',
        useTitleFromFileHeading: true,
        useFolderTitleFromIndexFile: true,
        sortMenusByFrontmatterOrder: true,
      },
      {
        documentRootPath: 'docs',
        scanStartPath: 'notes',
        resolvePath: '/notes/',
        useTitleFromFileHeading: true,
        useFolderTitleFromIndexFile: true,
        sortMenusByFrontmatterOrder: true,
      }
    ]),

    socialLinks: [
      { icon: 'github', link: 'https://github.com/ichason' }
    ]
  }
})
