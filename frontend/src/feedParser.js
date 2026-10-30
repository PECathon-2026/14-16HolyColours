
import { XMLParser } from 'fast-xml-parser'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
})

function getText(value) {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value)
  }

  if (value && typeof value === 'object') {
    return value['#text'] ?? ''
  }

  return ''
}

function getLink(entry) {
  // RSS usually uses a link string.
  if (typeof entry.link === 'string') {
    return entry.link
  }

  // Atom may contain several link objects.
  const links = Array.isArray(entry.link)
    ? entry.link
    : entry.link
      ? [entry.link]
      : []

  const alternate = links.find(
    link => !link['@_rel'] || link['@_rel'] === 'alternate'
  )

  return alternate?.['@_href'] ?? links[0]?.['@_href'] ?? ''
}

export function parseFeed(xml, feedUrl) {
  const document = parser.parse(xml)

  // Support both RSS and Atom document structures.
  const rssItems = document.rss?.channel?.item
  const atomItems = document.feed?.entry

  const rawItems = rssItems ?? atomItems ?? []
  const items = Array.isArray(rawItems) ? rawItems : [rawItems]

  return items
    .map(item => {
      const title = getText(item.title)
      const link = getLink(item)
      const published =
        getText(item.pubDate) ||
        getText(item.published) ||
        getText(item.updated) ||
        getText(item['dc:date'])

      if (!title || !link) return null

      let absoluteLink

      try {
        absoluteLink = new URL(link, feedUrl).href
      } catch {
        return null
      }

      return {
        id: absoluteLink,
        title,
        url: absoluteLink,
        publishedAt: published || null,
        feedUrl,
      }
    })
    .filter(Boolean)
}

export async function fetchAndParseFeed(feedUrl) {
  const response = await fetch(feedUrl)

  if (!response.ok) {
    throw new Error(`Feed request failed: HTTP ${response.status}`)
  }

  const xml = await response.text()
  return parseFeed(xml, feedUrl)
}
