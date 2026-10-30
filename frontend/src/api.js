import { parseFeed } from './feedParser'

const API_BASE_URL = 'http://127.0.0.1:8000'

export async function fetchFeedXml(feedUrl) {
  const endpoint = new URL(`${API_BASE_URL}/fetch`)
  endpoint.searchParams.set('url', feedUrl)

  const response = await fetch(endpoint)

  if (!response.ok) {
    let message = `Feed request failed (${response.status})`
    try {
      const error = await response.json()
      if (error.detail) message = error.detail
    } catch {}
    throw new Error(message)
  }

  return response.text()
}

export async function fetchArticlesFromFeed(feedUrl) {
  const xml = await fetchFeedXml(feedUrl)
  return parseFeed(xml, feedUrl)
}

export async function fetchArticlesForBlog(homepageUrl) {
  const endpoint = new URL(`${API_BASE_URL}/discover`)
  endpoint.searchParams.set('url', homepageUrl)

  const discoveryResponse = await fetch(endpoint)

  if (!discoveryResponse.ok) {
    const error = await discoveryResponse.json().catch(() => ({}))
    throw new Error(error.detail || 'Could not discover the feed')
  }

  const { feed_url } = await discoveryResponse.json()
  return fetchArticlesFromFeed(feed_url)
}

// Send the browser's current subscription snapshot anonymously.
export async function submitSubscriptions(feedUrls) {
  if (!feedUrls.length) return

  const response = await fetch(`${API_BASE_URL}/discovery/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feed_urls: feedUrls }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || 'Could not update anonymous discovery data')
  }

  return response.json()
}

// Retrieve recommendations based on the browser's local subscriptions.
export async function fetchRecommendations(feedUrls = []) {
  const endpoint = new URL(`${API_BASE_URL}/discovery/recommendations`)

  feedUrls.forEach(url => endpoint.searchParams.append('subscribed', url))

  const response = await fetch(endpoint)

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || 'Could not load recommendations')
  }

  return response.json()
}