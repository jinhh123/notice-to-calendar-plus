// 导出为图片，替代原本的 ICS 导出
import html2canvas from 'html2canvas'

/**
 * 把指定 DOM 节点渲染成 PNG 并触发下载
 * @param {string} elementId 要导出的容器 id
 * @param {string} fileName 下载的文件名
 */
export async function exportToImage(elementId, fileName = '我的日程.png') {
  const element = document.getElementById(elementId)
  if (!element) {
    alert('找不到要导出的内容')
    return
  }

  try {
    const canvas = await html2canvas(element, {
      backgroundColor: '#ffffff', // 白色背景，避免透明
      scale: 2, // 2 倍分辨率，图片更清晰
      useCORS: true,
      logging: false
    })

    // canvas 转图片链接，用 <a> 触发下载
    const url = canvas.toDataURL('image/png')
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)

    alert('图片已下载！')
  } catch (err) {
    console.error('导出图片失败:', err)
    alert('导出失败，请重试')
  }
}
