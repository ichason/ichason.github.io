import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  base: '/chason.github.io/',
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
            { text: '文章列表', link: '/posts/' }
          ]
        }
      ],
      '/notes/': [
        {
          text: '学习笔记',
          items: [
            { text: '笔记列表', link: '/notes/' }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/chason' }
    ]
  }
})
