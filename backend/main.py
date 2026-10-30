import ipaddress
import itertools
import os
import socket
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field


# ---------------- CONFIGURATION ----------------

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SECRET_KEY = os.getenv("SUPABASE_SECRET_KEY", "")

if not SUPABASE_URL or not SUPABASE_SECRET_KEY:
    raise RuntimeError("Missing Supabase environment variables.")

SUPABASE_REST_URL = f"{SUPABASE_URL}/rest/v1"

MAX_BYTES = 2 * 1024 * 1024
TIMEOUT = 15.0
USER_AGENT = "Mozilla/5.0 (compatible; SmallWebReader/0.1)"


app = FastAPI(title="Small Web Reader API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def supabase_headers():
    return {
        "apikey": SUPABASE_SECRET_KEY,
        "Authorization": f"Bearer {SUPABASE_SECRET_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def supabase_request(method, table, params=None, data=None):
    """Make a request to the Supabase REST API."""
    try:
        response = httpx.request(
            method,
            f"{SUPABASE_REST_URL}/{table}",
            headers=supabase_headers(),
            params=params,
            json=data,
            timeout=TIMEOUT,
        )

        if response.status_code >= 400:
            print("Supabase error:", response.status_code, response.text)
            raise HTTPException(
                status_code=502,
                detail="Database operation failed. Check the Supabase tables and configuration.",
            )

        if response.content:
            return response.json()

        return []

    except HTTPException:
        raise
    except httpx.RequestError as exc:
        print("Supabase connection error:", type(exc).__name__)
        raise HTTPException(
            status_code=503,
            detail="Could not connect to the discovery database.",
        ) from exc


# ---------------- URL VALIDATION ----------------

def validate_url(url: str) -> str:
    """Validate and normalize a public HTTP or HTTPS URL."""
    try:
        parts = urlsplit(url.strip())

        if parts.scheme.lower() not in {"http", "https"}:
            raise ValueError("Only HTTP and HTTPS URLs are supported.")

        if not parts.hostname:
            raise ValueError("The URL must contain a hostname.")

        if parts.username is not None or parts.password is not None:
            raise ValueError("URLs containing credentials are not allowed.")

        if parts.port not in (None, 80, 443):
            raise ValueError("This port is not allowed.")

        hostname = parts.hostname.rstrip(".").lower()

        if hostname == "localhost" or hostname.endswith(".localhost"):
            raise ValueError("Local addresses are not allowed.")

        try:
            ip = ipaddress.ip_address(hostname)

            if not ip.is_global:
                raise ValueError("Private or non-public IP addresses are blocked.")

        except ValueError as exc:
            if "blocked" in str(exc):
                raise

            try:
                addresses = socket.getaddrinfo(
                    hostname,
                    parts.port or (
                        443 if parts.scheme.lower() == "https" else 80
                    ),
                    type=socket.SOCK_STREAM,
                )
            except socket.gaierror as dns_error:
                raise ValueError(
                    f"Could not resolve hostname: {hostname}"
                ) from dns_error

            if not addresses:
                raise ValueError("The hostname has no usable addresses.")

            for address in addresses:
                resolved_ip = ipaddress.ip_address(address[4][0])

                if not resolved_ip.is_global:
                    raise ValueError(
                        "The hostname resolves to a private or non-public IP."
                    )

        netloc = f"[{hostname}]" if ":" in hostname else hostname

        if parts.port is not None:
            netloc = f"{netloc}:{parts.port}"

        return urlunsplit((
            parts.scheme.lower(),
            netloc,
            parts.path or "/",
            parts.query,
            "",
        ))

    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# ---------------- REMOTE FETCHING ----------------

async def fetch_remote(url: str):
    """Fetch a public URL without automatically following redirects."""
    safe_url = validate_url(url)

    try:
        async with httpx.AsyncClient(
            follow_redirects=False,
            trust_env=False,
            timeout=TIMEOUT,
            headers={
                "User-Agent": USER_AGENT,
                "Accept-Encoding": "identity",
            },
        ) as client:

            async with client.stream("GET", safe_url) as response:

                if 300 <= response.status_code < 400:
                    raise HTTPException(
                        status_code=502,
                        detail="Remote redirects are not followed by this prototype.",
                    )

                if response.status_code >= 400:
                    raise HTTPException(
                        status_code=502,
                        detail=f"Remote server returned HTTP {response.status_code}.",
                    )

                content_length = response.headers.get("content-length")

                if content_length:
                    try:
                        if int(content_length) > MAX_BYTES:
                            raise HTTPException(
                                status_code=413,
                                detail="Remote response exceeds the 2 MB limit.",
                            )
                    except ValueError:
                        pass

                chunks = []
                total = 0

                async for chunk in response.aiter_bytes():
                    total += len(chunk)

                    if total > MAX_BYTES:
                        raise HTTPException(
                            status_code=413,
                            detail="Remote response exceeds the 2 MB limit.",
                        )

                    chunks.append(chunk)

                body = b"".join(chunks)

                buffered_response = httpx.Response(
                    status_code=response.status_code,
                    headers=response.headers,
                    content=body,
                    request=response.request,
                )

                return buffered_response, body

    except HTTPException:
        raise

    except httpx.RequestError as exc:
        print("Remote request error:", type(exc).__name__)

        raise HTTPException(
            status_code=502,
            detail="Remote request failed.",
        ) from exc


# ---------------- FEED AUTODISCOVERY ----------------

class FeedLinkParser(HTMLParser):
    """Find RSS, Atom, or JSON feed links in HTML."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.feed_href = None

    def handle_starttag(self, tag, attrs):
        if tag.lower() != "link" or self.feed_href:
            return

        attributes = {
            key.lower(): value for key, value in attrs
        }

        rel = (attributes.get("rel") or "").lower().split()

        content_type = (
            attributes.get("type") or ""
        ).lower().split(";")[0].strip()

        href = attributes.get("href")

        supported_types = {
            "application/rss+xml",
            "application/atom+xml",
            "application/feed+json",
        }

        if "alternate" in rel and content_type in supported_types and href:
            self.feed_href = href.strip()


def discover_feed_url(html: str, homepage_url: str):
    parser = FeedLinkParser()

    try:
        parser.feed(html)
    except Exception:
        return None

    if not parser.feed_href:
        return None

    return urljoin(homepage_url, parser.feed_href)


# ---------------- ANONYMOUS DISCOVERY ----------------

class SubscriptionBatch(BaseModel):
    feed_urls: list[str] = Field(min_length=1, max_length=50)


@app.post("/discovery/subscribe")
def submit_subscriptions(batch: SubscriptionBatch):
    """
    Accept an anonymous batch of subscribed feeds.

    No account or persistent user identifier is stored.
    """
    normalized_urls = []

    for url in batch.feed_urls:
        normalized = validate_url(url)

        if normalized not in normalized_urls:
            normalized_urls.append(normalized)

    if not normalized_urls:
        raise HTTPException(
            status_code=400,
            detail="No valid feed URLs supplied.",
        )

    now = datetime.now(timezone.utc).isoformat()

    # Insert feeds if they do not already exist.
    feed_records = []

    for url in normalized_urls:
        hostname = urlsplit(url).hostname or url
        title = hostname.removeprefix("www.")

        feed_records.append({
            "url": url,
            "title": title,
            "updated_at": now,
        })

    supabase_request(
        "POST",
        "feeds",
        params={"on_conflict": "url"},
        data=feed_records,
    )

    # Increment aggregate popularity.
    for url in normalized_urls:
        existing = supabase_request(
            "GET",
            "feeds",
            params={
                "url": f"eq.{url}",
                "select": "popularity",
            },
        )

        if not existing:
            continue

        current_popularity = existing[0]["popularity"]

        supabase_request(
            "PATCH",
            "feeds",
            params={"url": f"eq.{url}"},
            data={
                "popularity": current_popularity + 1,
                "updated_at": now,
            },
        )

    # Record co-subscription pairs.
    for feed_a, feed_b in itertools.combinations(
        sorted(normalized_urls), 2
    ):
        existing = supabase_request(
            "GET",
            "feed_pairs",
            params={
                "feed_a": f"eq.{feed_a}",
                "feed_b": f"eq.{feed_b}",
                "select": "weight",
            },
        )

        current_weight = existing[0]["weight"] if existing else 0

        pair_record = {
            "feed_a": feed_a,
            "feed_b": feed_b,
            "weight": current_weight + 1,
        }

        supabase_request(
            "POST",
            "feed_pairs",
            params={"on_conflict": "feed_a,feed_b"},
            data=pair_record,
        )

    return {
        "status": "accepted",
        "feeds_received": len(normalized_urls),
        "message": "Anonymous aggregate data updated.",
    }


@app.get("/discovery/recommendations")
def get_recommendations(
    subscribed: list[str] = Query(default=[]),
    limit: int = Query(default=10, ge=1, le=30),
):
    """Recommend feeds using co-subscription and popularity."""

    normalized_subscriptions = {
        validate_url(url) for url in subscribed
    }

    feeds = supabase_request(
        "GET",
        "feeds",
        params={
            "select": "url,title,popularity",
            "order": "popularity.desc",
            "limit": "500",
        },
    )

    pairs = supabase_request(
        "GET",
        "feed_pairs",
        params={
            "select": "feed_a,feed_b,weight",
            "limit": "5000",
        },
    )

    scores = {}

    # Score feeds commonly followed alongside existing subscriptions.
    for pair in pairs:
        feed_a = pair["feed_a"]
        feed_b = pair["feed_b"]
        weight = pair["weight"]

        if feed_a in normalized_subscriptions:
            if feed_b not in normalized_subscriptions:
                scores[feed_b] = scores.get(feed_b, 0) + weight

        if feed_b in normalized_subscriptions:
            if feed_a not in normalized_subscriptions:
                scores[feed_a] = scores.get(feed_a, 0) + weight

    feed_details = {
        feed["url"]: feed for feed in feeds
    }

    # Popularity is the fallback for new users.
    for feed in feeds:
        if feed["url"] not in normalized_subscriptions:
            scores.setdefault(feed["url"], 0)

    ranked_urls = sorted(
        scores,
        key=lambda url: (
            scores[url],
            feed_details.get(url, {}).get("popularity", 0),
        ),
        reverse=True,
    )

    recommendations = []

    for url in ranked_urls:
        if url in normalized_subscriptions:
            continue

        details = feed_details.get(url)

        if not details:
            continue

        recommendations.append({
            "url": url,
            "title": details["title"],
            "score": scores[url],
            "popularity": details["popularity"],
            "reason": (
                "Frequently followed alongside your subscriptions."
                if scores[url] > 0
                else "Popular in the reader community."
            ),
        })

        if len(recommendations) >= limit:
            break

    return {
        "recommendations": recommendations,
        "count": len(recommendations),
    }


# ---------------- BASIC ENDPOINTS ----------------

@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "small-web-reader",
    }


@app.get("/fetch")
async def fetch_feed(
    url: str = Query(..., min_length=8, max_length=2048)
):
    """Return raw remote content; do not parse or store it."""
    response, body = await fetch_remote(url)

    content_type = response.headers.get(
        "content-type",
        "application/octet-stream",
    )

    return Response(
        content=body,
        headers={
            "Content-Type": content_type,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@app.get("/discover")
async def discover_feed(
    url: str = Query(..., min_length=8, max_length=2048)
):
    """Find a feed URL linked from a public HTML homepage."""
    homepage_url = validate_url(url)
    response, body = await fetch_remote(homepage_url)

    content_type = response.headers.get("content-type", "").lower()

    if (
        "text/html" not in content_type
        and "application/xhtml+xml" not in content_type
    ):
        raise HTTPException(
            status_code=415,
            detail="The supplied URL did not return an HTML page.",
        )

    html = body.decode("utf-8", errors="replace")
    feed_url = discover_feed_url(html, homepage_url)

    if not feed_url:
        raise HTTPException(
            status_code=404,
            detail="No supported RSS, Atom, or JSON feed link was found.",
        )

    feed_url = validate_url(feed_url)

    return {
        "homepage": homepage_url,
        "feed_url": feed_url,
    }