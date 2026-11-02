// Cloudflare Pages Function
// 路由：POST /api/deepseek
// 部署时在 Pages 项目设置里配置环境变量 DEEPSEEK_API_KEY

const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions'

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  })
}

export async function onRequestPost(context) {
  // POST /api/deepseek，密钥来自 Pages 环境变量
  const apiKey = context.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    return json({ error: '服务端未配置 DEEPSEEK_API_KEY' }, 500)
  }

  let payload
  try {
    payload = await context.request.json()
  } catch (err) {
    return json({ error: '请求体不是合法的 JSON' }, 400)
  }

  if (!payload || !Array.isArray(payload.messages) || payload.messages.length === 0) {
    return json({ error: '缺少 messages 字段' }, 400)
  }

  try {
    const upstream = await fetch(DEEPSEEK_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: payload.model || 'deepseek-chat',
        messages: payload.messages,
        response_format: payload.response_format || { type: 'json_object' },
        temperature: payload.temperature ?? 0.1,
        stream: false
      })
    })

    // 原样透传上游响应，前端仍按 OpenAI 格式解析
    const text = await upstream.text()
    return new Response(text, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    })
  } catch (err) {
    return json({ error: '转发到 DeepSeek 失败: ' + err.message }, 502)
  }
}
