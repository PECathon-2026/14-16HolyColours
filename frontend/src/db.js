
import { openDB } from 'idb'

const DB_NAME = 'small-web-reader'
const DB_VERSION = 2

export const dbPromise = openDB(DB_NAME, DB_VERSION, {
  upgrade(db) {
    // Stores followed blogs
    if (!db.objectStoreNames.contains('subscriptions')) {
      db.createObjectStore('subscriptions', {
        keyPath: 'url',
      })
    }

    // Stores fetched and extracted articles
    if (!db.objectStoreNames.contains('articles')) {
      db.createObjectStore('articles', {
        keyPath: 'id',
      })
    }

    // Stores read/unread status and reading progress
    if (!db.objectStoreNames.contains('readingState')) {
      db.createObjectStore('readingState', {
        keyPath: 'articleId',
      })
    }

    // Stores bookmarked article references
    if (!db.objectStoreNames.contains('savedArticles')) {
      db.createObjectStore('savedArticles', {
        keyPath: 'articleId',
      })
    }
  },
})

// ------------------------------------
// SUBSCRIPTIONS
// ------------------------------------

export async function getSubscriptions() {
  const db = await dbPromise
  return db.getAll('subscriptions')
}

export async function saveSubscription(feed) {
  const db = await dbPromise

  await db.put('subscriptions', {
    ...feed,
    followedAt: Date.now(),
  })
}

export async function removeSubscription(url) {
  const db = await dbPromise
  await db.delete('subscriptions', url)
}

export async function isSubscribed(url) {
  const db = await dbPromise
  return Boolean(await db.get('subscriptions', url))
}

// ------------------------------------
// ARTICLE CACHE
// ------------------------------------

export async function saveArticles(articles) {
  const db = await dbPromise
  const tx = db.transaction('articles', 'readwrite')

  await Promise.all([
    ...articles.map(article => tx.store.put(article)),
    tx.done,
  ])
}

export async function getCachedArticles() {
  const db = await dbPromise
  return db.getAll('articles')
}

export async function getCachedArticle(articleId) {
  const db = await dbPromise
  return db.get('articles', articleId)
}

// ------------------------------------
// READING STATE
// ------------------------------------

export async function setArticleRead(articleId, isRead = true) {
  const db = await dbPromise
  const existing = await db.get('readingState', articleId)

  await db.put('readingState', {
    ...existing,
    articleId,
    isRead,
    updatedAt: Date.now(),
  })
}

export async function getReadingState(articleId) {
  const db = await dbPromise
  return db.get('readingState', articleId)
}

export async function getAllReadingStates() {
  const db = await dbPromise
  return db.getAll('readingState')
}

// Save the reader's scroll progress as a percentage (0–100)
export async function setReadingProgress(articleId, progress) {
  const db = await dbPromise
  const existing = await db.get('readingState', articleId)

  await db.put('readingState', {
    ...existing,
    articleId,
    progress: Math.min(100, Math.max(0, progress)),
    updatedAt: Date.now(),
  })
}

// ------------------------------------
// SAVED ARTICLES / BOOKMARKS
// ------------------------------------

export async function setArticleSaved(articleId, isSaved = true) {
  const db = await dbPromise

  if (isSaved) {
    await db.put('savedArticles', {
      articleId,
      savedAt: Date.now(),
    })
  } else {
    await db.delete('savedArticles', articleId)
  }
}

export async function isArticleSaved(articleId) {
  const db = await dbPromise
  return Boolean(await db.get('savedArticles', articleId))
}

export async function getSavedArticles() {
  const db = await dbPromise
  const saved = await db.getAll('savedArticles')
  const articles = await db.getAll('articles')

  const articleMap = new Map(
    articles.map(article => [article.id, article])
  )

  return saved
    .map(item => ({
      ...articleMap.get(item.articleId),
      savedAt: item.savedAt,
    }))
    .filter(article => article.id)
}
