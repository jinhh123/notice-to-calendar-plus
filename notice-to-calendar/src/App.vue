<script setup>
/**
 * 应用根组件：只负责渲染路由出口。
 *
 * 页面结构：
 *   /           -> views/HomeView.vue（原来的日历主页面，含侧边栏）
 *   /knowledge  -> components/knowledge/KnowledgeView.vue（独立知识栏目，懒加载）
 *
 * 之前放在这里的「知识库开关 / localStorage / defineAsyncComponent」已全部移除，
 * 改由 vue-router 管理：不访问 /knowledge 就不会下载对应 JS，也不会发请求。
 */
</script>

<template>
  <RouterView />
</template>
