<script setup>
defineProps(['schedule'])
defineEmits(['remove'])
</script>

<template>
  <div class="card">
    <div class="card-head">
      <h3>{{ schedule.title || '未命名日程' }}</h3>
      <button class="del" @click="$emit('remove', schedule.id)">删除</button>
    </div>
    <p v-if="schedule.time">🕐 {{ schedule.time }}</p>
    <p v-if="schedule.location">📍 {{ schedule.location }}</p>
    <p v-if="schedule.items.length">🎒 {{ schedule.items.join('、') }}</p>
    <p v-if="schedule.unit">🏢 {{ schedule.unit }}</p>
    <p v-if="schedule.credit">📚 {{ schedule.credit }} 学分</p>
    <details>
      <summary>查看原文</summary>
      <pre>{{ schedule.source }}</pre>
    </details>
  </div>
</template>

<style scoped>
.card { background: #fff; border-radius: 8px; padding: 12px; margin-bottom: 8px; }
.card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
h3 { font-size: 15px; }
.del { background: none; border: none; color: #f5222d; font-size: 13px; }
p { font-size: 13px; color: #555; margin: 2px 0; }
pre { white-space: pre-wrap; font-size: 12px; color: #666; background: #f7f7f7; padding: 8px; border-radius: 4px; }
</style>