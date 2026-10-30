
import { Readability } from '@mozilla/readability'
import DOMPurify from 'dompurify'

const API_BASE_URL = 'http://127.0.0.1:8000'

export async function extractArticle(url) {
  const endpoint = new URL(`${API_BASE_URL}/fetch`)
  endpoint.searchParams.set('url', url)

  const response = await fetch(endpoint)

  if (!response.ok) {
    let message = `Could not fetch article (${response.status})`

    try {
      const error = await response.json()
      if (error.detail) message = error.detail
    } catch {
      // Keep the default error message.
    }

    throw new Error(message)
  }

  const contentType = response.headers.get('content-type') || ''

  if (!contentType.toLowerCase().includes('text/html')) {
    throw new Error('This page did not return HTML article content.')
  }

  const html = await response.text()
  const document = new DOMParser().parseFromString(html, 'text/html')

  const parsed = new Readability(document).parse()

  if (!parsed || !parsed.content) {
    throw new Error('Could not extract readable content from this page.')
  }

  const safeContent = DOMPurify.sanitize(parsed.content)

  return {
    id: url,
    url,
    title: parsed.title || document.title || 'Untitled article',
    byline: parsed.byline || '',
    excerpt: parsed.excerpt || '',
    content: safeContent,
    siteName: parsed.siteName || new URL(url).hostname,
    extractedAt: Date.now(),
  }
}
