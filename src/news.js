// 东方财富新闻搜索：个股/关键字相关资讯（标题/时间/来源/摘要/链接）。
import { quote } from './eastmoney.js'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

async function rawText(url, timeoutMs = 10000) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: '*/*', Referer: 'https://so.eastmoney.com/' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

/** 解析 JSONP 返回体（cb({...}) → {...}）。 */
function parseJsonp(text) {
  const start = text.indexOf('(')
  const end = text.lastIndexOf(')')
  if (start === -1 || end === -1 || end <= start) throw new Error('非 JSONP 响应')
  return JSON.parse(text.slice(start + 1, end))
}

/**
 * 搜索某关键字的相关新闻。
 * @param {string} keyword 关键字（股票名或代码）
 * @param {number} limit 条数
 */
async function searchNews(keyword, limit = 10) {
  const param = encodeURIComponent(JSON.stringify({
    uid: '',
    keyword,
    type: ['cmsArticleWebOld'],
    client: 'web',
    clientType: 'web',
    clientVersion: 'curr',
    param: {
      cmsArticleWebOld: { searchScope: 'default', sort: 'time', pageIndex: 1, pageSize: limit, preTag: '', postTag: '' },
    },
  }))
  const url = `https://search-api-web.eastmoney.com/search/jsonp?cb=cb&param=${param}`
  const text = await rawText(url)
  const data = parseJsonp(text)
  const articles = (data && data.result && data.result.cmsArticleWebOld) || []
  return articles.map((a) => ({
    title: a.title,
    date: a.date,
    source: a.mediaName,
    content: (a.content || '').replace(/<[^>]+>/g, '').slice(0, 200),
    url: a.url,
  }))
}

/**
 * 个股新闻：按代码查名称后，用名称检索相关资讯（名称检索命中率更高）。
 */
export async function stockNews(code, limit = 10) {
  const c = String(code).trim()
  let name = ''
  try {
    name = (await quote(c)).name
  } catch {
    name = ''
  }
  const keyword = name || c
  const list = await searchNews(keyword, Math.max(1, Math.min(limit, 30)))
  return { code: c, name, keyword, list }
}
