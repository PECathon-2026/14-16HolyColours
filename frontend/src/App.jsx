import { useState, useEffect, useRef } from 'react'
import './App.css'

import {
  getSubscriptions,
  saveSubscription,
  removeSubscription,
  saveArticles,
  getCachedArticles,
  setArticleRead,
  getReadingState,
  getAllReadingStates,
  setReadingProgress,
  setArticleSaved,
  getSavedArticles,
} from './db'

import {
  fetchArticlesForBlog,
  submitSubscriptions,
  fetchRecommendations,
} from './api'

import { extractArticle } from './articleReader'

const topics = [
  { name: 'Technology', icon: '⌘', description: 'Tech and the future' },
  { name: 'Artificial Intelligence', icon: '◈', description: 'AI and machine learning' },
  { name: 'Programming', icon: '</>', description: 'Code and software' },
  { name: 'Science', icon: '⚗', description: 'Discover how things work' },
  { name: 'Engineering', icon: '⚙', description: 'Build and invent' },
  { name: 'Economics', icon: '↗', description: 'Markets and society' },
  { name: 'Business', icon: '▤', description: 'Startups and strategy' },
  { name: 'Design', icon: '✳', description: 'Creativity and design' },
  { name: 'Philosophy', icon: '◎', description: 'Ideas worth exploring' },
  { name: 'History', icon: '◷', description: 'Stories from the past' },
  { name: 'Psychology', icon: '◉', description: 'The human mind' },
  { name: 'Environment', icon: '♧', description: 'Nature and our planet' },
]

const starterFeeds = [
  {
    name: 'Simon Willison’s Weblog',
    description: 'Experiments, tools and ideas in software and AI.',
    topics: ['Technology', 'Artificial Intelligence', 'Programming'],
    url: 'https://simonwillison.net/',
  },
  {
    name: 'The Pragmatic Engineer',
    description: 'Technology, software engineering and the tech industry.',
    topics: ['Technology', 'Programming', 'Engineering', 'Business'],
    url: 'https://blog.pragmaticengineer.com/',
  },
  {
    name: 'Import AI',
    description: 'A newsletter exploring developments in artificial intelligence.',
    topics: ['Artificial Intelligence', 'Science', 'Technology'],
    url: 'https://importai.substack.com/',
  },
  {
    name: 'Our World in Data',
    description: 'Research and evidence about the world’s biggest problems.',
    topics: ['Science', 'Economics', 'Environment', 'History'],
    url: 'https://ourworldindata.org/',
  },
  {
    name: 'A List Apart',
    description: 'Ideas about web design, development and digital experiences.',
    topics: ['Design', 'Programming', 'Technology'],
    url: 'https://alistapart.com/',
  },
  {
    name: 'Farnam Street',
    description: 'Mental models, decision-making and better thinking.',
    topics: ['Psychology', 'Philosophy', 'Business'],
    url: 'https://fs.blog/',
  },
]

function App() {
  const [stage, setStage] = useState('landing')
  const [selected, setSelected] = useState([])
  const [followed, setFollowed] = useState([])
  const [subscriptionsLoaded, setSubscriptionsLoaded] = useState(false)

  const [isOnline, setIsOnline] = useState(navigator.onLine)

  const [communityFeeds, setCommunityFeeds] = useState([])
  const [discoveryError, setDiscoveryError] = useState('')

  const [articles, setArticles] = useState([])
  const [loadingArticles, setLoadingArticles] = useState(false)
  const [articleError, setArticleError] = useState('')
  const [timelineFilter, setTimelineFilter] = useState('all')

  const [readingStates, setReadingStates] = useState({})
  const [savedArticleIds, setSavedArticleIds] = useState([])

  const [selectedArticle, setSelectedArticle] = useState(null)
  const [loadingReader, setLoadingReader] = useState(false)
  const [readerError, setReaderError] = useState('')

  const [readerTheme, setReaderTheme] = useState('light')
  const [fontSize, setFontSize] = useState('comfortable')
  const [readingProgress, setReadingProgressState] = useState(0)

  const progressSaveTimer = useRef(null)

  // Listen for changes in network connectivity.
  useEffect(() => {
    function updateOnlineStatus() {
      setIsOnline(navigator.onLine)
    }

    window.addEventListener('online', updateOnlineStatus)
    window.addEventListener('offline', updateOnlineStatus)

    return () => {
      window.removeEventListener('online', updateOnlineStatus)
      window.removeEventListener('offline', updateOnlineStatus)
    }
  }, [])

  // Load existing subscriptions when the application starts.
  useEffect(() => {
    async function loadSubscriptions() {
      try {
        const saved = await getSubscriptions()
        setFollowed(saved.map(feed => feed.name))

        if (saved.length > 0) {
          setStage('feeds')
        }
      } catch (error) {
        console.error('Could not load subscriptions:', error)
      } finally {
        setSubscriptionsLoaded(true)
      }
    }

    loadSubscriptions()
  }, [])

  // Restore bookmarks and reading states.
  async function refreshLocalReadingData() {
    try {
      const [states, savedArticles] = await Promise.all([
        getAllReadingStates(),
        getSavedArticles(),
      ])

      const stateMap = Object.fromEntries(
        states.map(item => [item.articleId, item])
      )

      setReadingStates(stateMap)
      setSavedArticleIds(savedArticles.map(article => article.id))
    } catch (error) {
      console.error('Could not load reading data:', error)
    }
  }

  useEffect(() => {
    refreshLocalReadingData()
  }, [])

  // Restore saved reading position and track subsequent scrolling.
  useEffect(() => {
    if (stage !== 'reader' || !selectedArticle) return

    let cancelled = false
    let trackingStarted = false

    async function restoreReadingPosition() {
      try {
        const savedState = await getReadingState(selectedArticle.id)

        if (cancelled) return

        const savedProgress = Math.min(
          100,
          Math.max(0, Number(savedState?.progress) || 0)
        )

        setReadingProgressState(savedProgress)

        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            if (cancelled) return

            const scrollableHeight =
              document.documentElement.scrollHeight - window.innerHeight

            const targetScroll = scrollableHeight > 0
              ? scrollableHeight * (savedProgress / 100)
              : 0

            window.scrollTo({
              top: targetScroll,
              behavior: 'instant',
            })

            trackingStarted = true
            updateProgress()
          })
        })
      } catch (error) {
        console.error('Could not restore reading position:', error)
      }
    }

    function updateProgress() {
      if (!trackingStarted || cancelled) return

      const scrollableHeight =
        document.documentElement.scrollHeight - window.innerHeight

      const progress = scrollableHeight <= 0
        ? 100
        : Math.min(
            100,
            Math.max(0, (window.scrollY / scrollableHeight) * 100)
          )

      setReadingProgressState(progress)

      if (progressSaveTimer.current) {
        clearTimeout(progressSaveTimer.current)
      }

      progressSaveTimer.current = setTimeout(async () => {
        try {
          await setReadingProgress(selectedArticle.id, progress)

          if (progress >= 99.5) {
            await setArticleRead(selectedArticle.id, true)
          }

          await refreshLocalReadingData()
        } catch (error) {
          console.error('Could not save reading progress:', error)
        }
      }, 350)
    }

    restoreReadingPosition()

    window.addEventListener('scroll', updateProgress, { passive: true })
    window.addEventListener('resize', updateProgress)

    return () => {
      cancelled = true

      window.removeEventListener('scroll', updateProgress)
      window.removeEventListener('resize', updateProgress)

      if (progressSaveTimer.current) {
        clearTimeout(progressSaveTimer.current)
      }
    }
  }, [stage, selectedArticle])

  function toggleTopic(topic) {
    setSelected(current =>
      current.includes(topic)
        ? current.filter(item => item !== topic)
        : [...current, topic]
    )
  }

  // Fetch recommendations using the browser's locally stored subscriptions.
  async function refreshDiscovery({ submit = false } = {}) {
    if (!navigator.onLine) return

    setDiscoveryError('')

    try {
      const subscriptions = await getSubscriptions()
      const urls = subscriptions.map(feed => feed.url)

      // Submit only after a deliberate subscription change.
      if (submit && urls.length > 0) {
        await submitSubscriptions(urls)
      }

      const result = await fetchRecommendations(urls)
      setCommunityFeeds(result.recommendations || [])
    } catch (error) {
      console.error('Discovery error:', error)
      setDiscoveryError(
        'Community recommendations are temporarily unavailable. Your local reader still works.'
      )
    }
  }

  // Load community recommendations when the publications screen opens.
  useEffect(() => {
    if (subscriptionsLoaded && stage === 'feeds' && isOnline) {
      refreshDiscovery()
    }
  }, [subscriptionsLoaded, stage, isOnline])

  async function toggleSubscription(feed) {
    const isFollowing = followed.includes(feed.name)

    try {
      if (isFollowing) {
        await removeSubscription(feed.url)

        setFollowed(current =>
          current.filter(name => name !== feed.name)
        )
      } else {
        await saveSubscription({
          name: feed.name,
          url: feed.url,
          description: feed.description,
          topics: feed.topics,
        })

        setFollowed(current => [...current, feed.name])
      }

      await refreshDiscovery({ submit: true })
    } catch (error) {
      console.error('Could not update subscription:', error)
    }
  }

  async function loadTimeline() {
    setLoadingArticles(true)
    setArticleError('')

    try {
      const subscriptions = await getSubscriptions()

      if (subscriptions.length === 0) {
        setArticles([])
        setArticleError(
          'Follow at least one publication to build your timeline.'
        )
        return
      }

      const cached = await getCachedArticles()
      setArticles(cached)

      // Do not attempt network requests while offline.
      if (!navigator.onLine) {
        if (cached.length === 0) {
          setArticleError(
            'You are offline and have no cached articles yet. Reconnect to fetch articles.'
          )
        } else {
          setArticleError(
            'You are offline. Showing your cached articles.'
          )
        }

        await refreshLocalReadingData()
        return
      }

      const results = await Promise.allSettled(
        subscriptions.map(feed => fetchArticlesForBlog(feed.url))
      )

      const freshArticles = results
        .filter(result => result.status === 'fulfilled')
        .flatMap(result => result.value)

      const failedCount = results.filter(
        result => result.status === 'rejected'
      ).length

      if (freshArticles.length > 0) {
        const uniqueArticles = [
          ...new Map(
            freshArticles.map(article => [article.id, article])
          ).values(),
        ]

        await saveArticles(uniqueArticles)
        setArticles(await getCachedArticles())
      } else if (cached.length === 0) {
        setArticleError(
          'Could not retrieve articles. Check the backend and feed availability.'
        )
      }

      if (failedCount > 0 && (freshArticles.length > 0 || cached.length > 0)) {
        setArticleError(
          `${failedCount} publication(s) could not be refreshed. Showing available articles.`
        )
      }

      await refreshLocalReadingData()
    } catch (error) {
      console.error('Could not load timeline:', error)
      setArticleError('Could not load your timeline. Please try again.')
    } finally {
      setLoadingArticles(false)
    }
  }

  async function openArticle(article) {
    setLoadingReader(true)
    setReaderError('')
    setSelectedArticle(null)

    try {
      const cachedArticles = await getCachedArticles()

      const cachedArticle = cachedArticles.find(
        item => item.id === article.id && item.content
      )

      let articleToOpen

      if (cachedArticle) {
        articleToOpen = cachedArticle
      } else {
        if (!navigator.onLine) {
          throw new Error(
            'This article has not been saved for offline reading. Reconnect to open it.'
          )
        }

        articleToOpen = await extractArticle(article.url)
        await saveArticles([articleToOpen])
      }

      const savedState = await getReadingState(article.id)

      const savedProgress = Math.min(
        100,
        Math.max(0, Number(savedState?.progress) || 0)
      )

      setReadingProgressState(savedProgress)
      setSelectedArticle(articleToOpen)
      setStage('reader')

      window.scrollTo({ top: 0, behavior: 'instant' })
    } catch (error) {
      console.error('Could not open article:', error)
      setReaderError(error.message || 'Could not extract this article.')
    } finally {
      setLoadingReader(false)
    }
  }

  async function toggleRead(articleId) {
    const currentlyRead = Boolean(readingStates[articleId]?.isRead)

    try {
      await setArticleRead(articleId, !currentlyRead)
      await refreshLocalReadingData()
    } catch (error) {
      console.error('Could not update read status:', error)
    }
  }

  async function toggleSaved(articleId) {
    const currentlySaved = savedArticleIds.includes(articleId)

    try {
      await setArticleSaved(articleId, !currentlySaved)
      await refreshLocalReadingData()
    } catch (error) {
      console.error('Could not update bookmark:', error)
    }
  }

  async function returnToTimeline() {
    setStage('timeline')
    setReaderError('')

    await refreshLocalReadingData()

    window.scrollTo({ top: 0, behavior: 'instant' })
  }

  const recommendations = starterFeeds
    .map(feed => ({
      ...feed,
      matches: feed.topics.filter(topic => selected.includes(topic)),
    }))
    .filter(feed => selected.length === 0 || feed.matches.length > 0)
    .sort((a, b) => b.matches.length - a.matches.length)

  const sortedArticles = [...articles].sort((a, b) => {
    const dateA = Date.parse(a.publishedAt || '') || 0
    const dateB = Date.parse(b.publishedAt || '') || 0
    return dateB - dateA
  })

  const visibleArticles = sortedArticles.filter(article => {
    const isRead = Boolean(readingStates[article.id]?.isRead)
    const isSaved = savedArticleIds.includes(article.id)

    if (timelineFilter === 'unread') return !isRead
    if (timelineFilter === 'saved') return isSaved

    return true
  })

  if (!subscriptionsLoaded) {
    return <main className="app-shell" />
  }

  return (
    <main className="app-shell">

      {!isOnline && (
        <div className="offline-banner" role="status">
          <span className="offline-indicator" />
          You're offline. Your saved articles are still available to read.
        </div>
      )}

      {stage !== 'reader' && (
        <header className="topbar">
          <button
            className="brand"
            onClick={() => setStage('landing')}
            aria-label="Return to Small Web home"
          >
            <span className="brand-mark">s.</span>
            <span>small web</span>
          </button>

          <div className="header-note">
            <span className="privacy-dot" />
            Independent by nature
          </div>
        </header>
      )}

      {stage === 'reader' && (
        <div
          className="reading-progress-track"
          role="progressbar"
          aria-label="Article reading progress"
          aria-valuenow={Math.round(readingProgress)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="reading-progress-fill"
            style={{ width: `${readingProgress}%` }}
          />
        </div>
      )}

      <div className="stage-content" key={stage}>

        {stage === 'landing' && (
          <section className="landing">
            <div className="landing-copy">
              <div className="welcome-label">
                <span className="welcome-line" />
                YOUR LITTLE CORNER OF THE INTERNET
              </div>

              <h1>
                Make room
                <br />
                for <em>good</em> reading.
              </h1>

              <p className="landing-description">
                Step away from the endless scroll. Find independent writers,
                follow the ideas that interest you, and make the web feel
                personal again.
              </p>

              <button
                className="primary-button landing-button"
                onClick={() => setStage('topics')}
              >
                Find your reading corner
                <span aria-hidden="true">↗</span>
              </button>

              <div className="landing-promises">
                <span><span>✳</span> No account needed</span>
                <span><span>✳</span> Your interests, your choice</span>
              </div>
            </div>

            <div className="reading-art">
              <div className="art-orbit orbit-one" />
              <div className="art-orbit orbit-two" />
              <div className="book-shadow" />

              <div className="paper-book">
                <div className="book-spine" />
                <div className="book-kicker">A NOTE TO THE READER</div>

                <div className="book-title">
                  The joy
                  <br />
                  of finding
                  <br />
                  <em>something</em>
                  <br />
                  wonderful.
                </div>

                <div className="book-rule" />

                <div className="book-lines">
                  <span />
                  <span />
                  <span />
                  <span className="short-line" />
                </div>

                <div className="book-flower">✳</div>
                <div className="book-footer">TAKE YOUR TIME · 001</div>
              </div>

              <div className="floating-note note-top">
                <span className="note-symbol">↗</span>
                <span>Follow curiosity</span>
              </div>

              <div className="floating-note note-bottom">
                <span className="note-symbol">✳</span>
                <span>Read at your pace</span>
              </div>
            </div>

            <div className="landing-bottom">
              <span>LESS FEED. MORE MEANING.</span>
              <span>MADE FOR THE CURIOUS READER ↓</span>
            </div>
          </section>
        )}

        {stage === 'topics' && (
          <section className="onboarding">
            <button
              className="back-button"
              onClick={() => setStage('landing')}
            >
              ← Back home
            </button>

            <div className="welcome-label">
              <span className="welcome-line" />
              FIRST, A LITTLE ABOUT YOUR CURIOSITY
            </div>

            <h1 className="stage-heading">
              What would you
              <br />
              like to <em>explore?</em>
            </h1>

            <p className="intro">
              Choose a few interests to find independent blogs worth your
              time. You can change your mind whenever you like.
            </p>

            <div className="section-heading">
              <div>
                <h2>Things you find interesting</h2>
                <p>Select any topics that speak to you.</p>
              </div>

              <span className="selection-count">
                {selected.length} selected
              </span>
            </div>

            <div className="topic-grid">
              {topics.map(topic => {
                const isSelected = selected.includes(topic.name)

                return (
                  <button
                    key={topic.name}
                    type="button"
                    className={`topic-card ${isSelected ? 'selected' : ''}`}
                    aria-pressed={isSelected}
                    onClick={() => toggleTopic(topic.name)}
                  >
                    <span className="topic-icon">{topic.icon}</span>

                    <span className="topic-copy">
                      <strong>{topic.name}</strong>
                      <small>{topic.description}</small>
                    </span>

                    <span className="topic-check">
                      {isSelected ? '✓' : '+'}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="onboarding-footer">
              <p>
                <span className="lock-symbol">◇</span>
                No account or personal profile is created.
              </p>

              <div className="footer-actions">
                <button
                  className="skip-button"
                  onClick={() => setStage('feeds')}
                >
                  Surprise me
                </button>

                <button
                  className="primary-button"
                  onClick={() => setStage('feeds')}
                  disabled={selected.length === 0}
                >
                  Find my reads <span>→</span>
                </button>
              </div>
            </div>
          </section>
        )}

        {stage === 'feeds' && (
          <section className="feed-stage">
            <button
              className="back-button"
              onClick={() => setStage('topics')}
            >
              ← Back to interests
            </button>

            <div className="welcome-label">
              <span className="welcome-line" />
              A FEW GOOD PLACES TO BEGIN
            </div>

            <h1 className="stage-heading">
              Follow what
              <br />
              <em>moves you.</em>
            </h1>

            <p className="intro">
              These independent publications are a starting point. Visit
              their sites, explore their writing, and follow the ones you
              want to keep close.
            </p>

            <div className="feed-grid">
              {recommendations.map(feed => (
                <article className="feed-card" key={feed.name}>
                  <div className="feed-card-top">
                    <span className="feed-monogram">
                      {feed.name.charAt(0)}
                    </span>

                    <span className="match-count">
                      {feed.matches.length > 0
                        ? `${feed.matches.length} matching ${
                            feed.matches.length === 1 ? 'topic' : 'topics'
                          }`
                        : 'A reader favourite'}
                    </span>
                  </div>

                  <h2>{feed.name}</h2>
                  <p>{feed.description}</p>

                  <div className="feed-tags">
                    {(feed.matches.length > 0
                      ? feed.matches
                      : feed.topics.slice(0, 2)
                    ).map(topic => (
                      <span className="tag" key={topic}>{topic}</span>
                    ))}
                  </div>

                  <div className="feed-actions">
                    <a href={feed.url} target="_blank" rel="noreferrer">
                      Visit publication ↗
                    </a>

                    <button
                      className={
                        followed.includes(feed.name)
                          ? 'follow-button following'
                          : 'follow-button'
                      }
                      onClick={() => toggleSubscription(feed)}
                    >
                      {followed.includes(feed.name)
                        ? '✓ Following'
                        : '+ Follow'}
                    </button>
                  </div>
                </article>
              ))}
            </div>

            {/* Community-powered recommendations */}
            <section className="community-discovery">
              <div className="welcome-label">
                <span className="welcome-line" />
                DISCOVER THROUGH THE COMMUNITY
              </div>

              <h2>Beyond your reading list.</h2>

              <p className="intro">
                Publications readers are exploring alongside their own subscriptions.
              </p>

              {discoveryError && (
                <p className="demo-note" role="status">
                  {discoveryError}
                </p>
              )}

              {communityFeeds.length > 0 ? (
                <div className="feed-grid">
                  {communityFeeds
                    .filter(feed => !followed.includes(feed.title))
                    .map(feed => (
                      <article className="feed-card" key={feed.url}>
                        <div className="feed-card-top">
                          <span className="feed-monogram">
                            {feed.title.charAt(0).toUpperCase()}
                          </span>

                          <span className="match-count">
                            {feed.score > 0
                              ? 'Community connection'
                              : 'Popular publication'}
                          </span>
                        </div>

                        <h2>{feed.title}</h2>
                        <p>{feed.reason}</p>

                        <div className="feed-actions">
                          <a href={feed.url} target="_blank" rel="noreferrer">
                            Visit publication ↗
                          </a>

                          <button
                            className="follow-button"
                            onClick={() => toggleSubscription({
                              name: feed.title,
                              url: feed.url,
                              description: feed.reason,
                              topics: [],
                            })}
                          >
                            + Follow
                          </button>
                        </div>
                      </article>
                    ))}
                </div>
              ) : (
                <p className="demo-note">
                  {discoveryError
                    ? 'Try refreshing community discovery when the connection is available.'
                    : 'Follow publications to help build community recommendations.'}
                </p>
              )}

              <button
                className="follow-button"
                onClick={() => refreshDiscovery()}
                disabled={!isOnline}
              >
                Refresh community discovery ↻
              </button>
            </section>

            <p className="demo-note">
              Follow publications to collect their latest articles in one timeline.
            </p>

            <button
              className="primary-button continue-button"
              onClick={() => setStage('topics')}
            >
              Refine my interests ↗
            </button>

            <button
              className="primary-button continue-button"
              onClick={() => {
                setStage('timeline')
                loadTimeline()
              }}
            >
              Open my reading timeline →
            </button>
          </section>
        )}

        {stage === 'timeline' && (
          <section className="feed-stage">
            <button
              className="back-button"
              onClick={() => setStage('feeds')}
            >
              ← Back to publications
            </button>

            <div className="welcome-label">
              <span className="welcome-line" />
              YOUR PERSONAL READING SPACE
            </div>

            <h1 className="stage-heading">
              My reading
              <br />
              <em>timeline.</em>
            </h1>

            <p className="intro">
              Recent writing from the publications you follow, all in one place.
            </p>

            <button
              className="primary-button"
              onClick={loadTimeline}
              disabled={loadingArticles}
            >
              {loadingArticles ? 'Refreshing…' : 'Refresh articles ↻'}
            </button>

            <div className="timeline-filters" role="group" aria-label="Filter articles">
              <button
                className={timelineFilter === 'all' ? 'active' : ''}
                onClick={() => setTimelineFilter('all')}
              >
                All ({articles.length})
              </button>

              <button
                className={timelineFilter === 'unread' ? 'active' : ''}
                onClick={() => setTimelineFilter('unread')}
              >
                Unread ({articles.filter(
                  article => !readingStates[article.id]?.isRead
                ).length})
              </button>

              <button
                className={timelineFilter === 'saved' ? 'active' : ''}
                onClick={() => setTimelineFilter('saved')}
              >
                Saved ({savedArticleIds.length})
              </button>
            </div>

            {articleError && (
              <p className="demo-note" role="status">{articleError}</p>
            )}

            {loadingArticles && articles.length === 0 && (
              <p className="intro" role="status">
                Finding the latest articles from your blogs…
              </p>
            )}

            <div className="feed-grid">
              {visibleArticles.map(article => {
                const publishedTime = Date.parse(article.publishedAt || '')
                const isRead = Boolean(readingStates[article.id]?.isRead)
                const isSaved = savedArticleIds.includes(article.id)
                const progress = readingStates[article.id]?.progress || 0

                return (
                  <article className="feed-card" key={article.id}>
                    <div className="feed-card-top">
                      <span className="feed-monogram">↗</span>
                      <span className="match-count">{article.feedUrl}</span>
                    </div>

                    <h2>{article.title}</h2>

                    <p>
                      {Number.isFinite(publishedTime)
                        ? new Date(publishedTime).toLocaleDateString()
                        : 'Publication date unavailable'}
                    </p>

                    <p>
                      {isRead ? 'Read' : 'Unread'}
                      {progress > 0 && progress < 100
                        ? ` · ${Math.round(progress)}% read`
                        : ''}
                      {isSaved ? ' · Saved' : ''}
                    </p>

                    <div className="feed-actions">
                      <button
                        className="follow-button"
                        onClick={() => openArticle(article)}
                        disabled={loadingReader}
                      >
                        Read article →
                      </button>

                      <button
                        className={isSaved ? 'follow-button following' : 'follow-button'}
                        onClick={() => toggleSaved(article.id)}
                      >
                        {isSaved ? '★ Saved' : '☆ Save'}
                      </button>
                    </div>

                    <div className="feed-actions">
                      <button
                        className="follow-button"
                        onClick={() => toggleRead(article.id)}
                      >
                        {isRead ? 'Mark unread' : 'Mark read'}
                      </button>

                      <a href={article.url} target="_blank" rel="noreferrer">
                        Original ↗
                      </a>
                    </div>
                  </article>
                )
              })}
            </div>

            {!loadingArticles && visibleArticles.length === 0 && !articleError && (
              <p className="intro">
                {timelineFilter === 'saved'
                  ? 'You have not saved any articles yet.'
                  : timelineFilter === 'unread'
                    ? 'You are all caught up.'
                    : 'No articles are available yet.'}
              </p>
            )}

            {readerError && (
              <p className="demo-note" role="alert">{readerError}</p>
            )}

            {loadingReader && (
              <p className="demo-note" role="status">
                Preparing your article…
              </p>
            )}
          </section>
        )}

        {stage === 'reader' && (
          <section className={`reader-screen reader-${readerTheme}`}>
            <header className="reader-header">
              <button className="reader-back" onClick={returnToTimeline}>
                <span>←</span> Library
              </button>

              <div className="reader-brand">
                <span className="reader-brand-mark">s.</span>
                <span>small web</span>
              </div>

              <a
                className="reader-source"
                href={selectedArticle?.url}
                target="_blank"
                rel="noreferrer"
              >
                Original ↗
              </a>
            </header>

            {readerError && (
              <p className="reader-error" role="alert">{readerError}</p>
            )}

            {selectedArticle && (
              <>
                <article className={`reader-article reader-font-${fontSize}`}>
                  <div className="reader-kicker">
                    <span className="reader-kicker-line" />
                    YOUR QUIET CORNER OF THE WEB
                  </div>

                  <h1 className="reader-title">
                    {selectedArticle.title}
                  </h1>

                  <div className="reader-byline">
                    {selectedArticle.byline && (
                      <span>{selectedArticle.byline}</span>
                    )}

                    {selectedArticle.siteName && (
                      <span>{selectedArticle.siteName}</span>
                    )}
                  </div>

                  {selectedArticle.excerpt && (
                    <p className="reader-excerpt">
                      {selectedArticle.excerpt}
                    </p>
                  )}

                  <div className="reader-divider" />

                  <div
                    className="reader-content"
                    dangerouslySetInnerHTML={{
                      __html: selectedArticle.content,
                    }}
                  />

                  <div className="reader-end">
                    <span>✳</span>
                    <p>You've reached the end.</p>
                    <button onClick={returnToTimeline}>
                      Find something else to read →
                    </button>
                  </div>
                </article>

                <div className="reader-toolbar" aria-label="Reading controls">
                  <div className="toolbar-group">
                    <button
                      onClick={() =>
                        setFontSize(current =>
                          current === 'large'
                            ? 'comfortable'
                            : current === 'comfortable'
                              ? 'small'
                              : 'small'
                        )
                      }
                      aria-label="Decrease text size"
                      title="Decrease text size"
                    >
                      A−
                    </button>

                    <button
                      onClick={() =>
                        setFontSize(current =>
                          current === 'small'
                            ? 'comfortable'
                            : current === 'comfortable'
                              ? 'large'
                              : 'large'
                        )
                      }
                      aria-label="Increase text size"
                      title="Increase text size"
                    >
                      A+
                    </button>
                  </div>

                  <span className="toolbar-divider" />

                  <button
                    className="theme-toggle"
                    onClick={() =>
                      setReaderTheme(current =>
                        current === 'light' ? 'dark' : 'light'
                      )
                    }
                    aria-label="Toggle reading theme"
                    title="Toggle reading theme"
                  >
                    {readerTheme === 'light' ? '☾' : '☀'}
                  </button>

                  <span className="toolbar-divider" />

                  <button
                    className="theme-toggle"
                    onClick={() => toggleSaved(selectedArticle.id)}
                    aria-label="Toggle bookmark"
                    title="Toggle bookmark"
                  >
                    {savedArticleIds.includes(selectedArticle.id) ? '★' : '☆'}
                  </button>

                  <button
                    className="theme-toggle"
                    onClick={() => toggleRead(selectedArticle.id)}
                    aria-label="Toggle read status"
                    title="Toggle read status"
                  >
                    {readingStates[selectedArticle.id]?.isRead ? '✓' : '○'}
                  </button>

                  <span className="toolbar-divider" />

                  <span className="toolbar-progress">
                    {Math.round(readingProgress)}%
                  </span>
                </div>
              </>
            )}
          </section>
        )}
      </div>

      {stage !== 'reader' && (
        <footer className="page-footer">
          <span>SMALL WEB READER</span>
          <span>INDEPENDENT WRITING. YOUR CURIOSITY.</span>
        </footer>
      )}
    </main>
  )
}

export default App