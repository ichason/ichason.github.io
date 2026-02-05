import { defineConfig } from 'vitepress'

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

    sidebar: {
      '/posts/': [
        {
          text: '博客文章',
          items: [
            { text: '文章列表', link: '/posts/' },
            { text: '我的第一篇博客', link: '/posts/example-post-1' },
            { text: '如何搭建个人博客', link: '/posts/example-post-2' }
          ]
        }
      ],
      '/notes/': [
        {
          text: '学习笔记',
          items: [
            { text: '笔记列表', link: '/notes/' },
            { text: 'JavaScript 学习笔记', link: '/notes/example-note-1' }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/ichason' }
    ]
  }
})
