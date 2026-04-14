const CACHE_NAME = 'lamp-map-cache-v1';
const MAP_CACHE_NAME = 'map-tiles-cache-v1';
const MAX_TILE_CACHE_SIZE = 1000; // Maximum number of tiles to cache

// Resources to cache on install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.js',
  'https://cdn.jsdelivr.net/npm/@turf/turf@6/turf.min.js'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('Service Worker: Installing');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Service Worker: Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activating');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.filter((cacheName) => {
          return cacheName !== CACHE_NAME && cacheName !== MAP_CACHE_NAME;
        }).map((cacheName) => {
          console.log('Service Worker: Deleting old cache', cacheName);
          return caches.delete(cacheName);
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event - serve from cache or network
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  
  // Handle map tile requests (works with any tile provider)
  if (requestUrl.hostname.includes('tile') || 
      requestUrl.hostname.includes('maps') ||
      requestUrl.pathname.includes('/tiles/')) {
    event.respondWith(handleTileRequest(event.request));
    return;
  }
  
  // Handle CDN library requests
  if (requestUrl.hostname.includes('unpkg.com') || 
      requestUrl.hostname.includes('cdnjs.cloudflare.com') || 
      requestUrl.hostname.includes('cdn.jsdelivr.net')) {
    event.respondWith(handleLibraryRequest(event.request));
    return;
  }
  
  // Handle HTML and other static assets
  event.respondWith(handleStaticRequest(event.request));
});

// Handle map tile caching
async function handleTileRequest(request) {
  const cache = await caches.open(MAP_CACHE_NAME);
  
  try {
    // Try to get from cache first
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      console.log('Service Worker: Serving tile from cache');
      // Update cache in background for fresh tiles
      fetchAndCacheTile(request, cache);
      return cachedResponse;
    }
    
    // If not in cache, fetch from network
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      // Clone the response before caching
      const responseToCache = networkResponse.clone();
      await cache.put(request, responseToCache);
      console.log('Service Worker: Cached new tile');
      
      // Limit cache size
      limitCacheSize(cache);
    }
    
    return networkResponse;
  } catch (error) {
    console.error('Service Worker: Tile fetch failed', error);
    // Return cached version if available, even if stale
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    // Return empty response as last resort
    return new Response('', { status: 404 });
  }
}

// Fetch and cache tile in background
async function fetchAndCacheTile(request, cache) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      await cache.put(request, networkResponse.clone());
    }
  } catch (error) {
    console.log('Service Worker: Background tile cache update failed');
  }
}

// Handle library requests (Leaflet, Turf, etc.)
async function handleLibraryRequest(request) {
  const cache = await caches.open(CACHE_NAME);
  
  try {
    // Try cache first
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      console.log('Service Worker: Serving library from cache');
      return cachedResponse;
    }
    
    // Fetch from network
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      await cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.error('Service Worker: Library fetch failed', error);
    // Return cached version if available, even if stale
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    throw error;
  }
}

// Handle static asset requests
async function handleStaticRequest(request) {
  const cache = await caches.open(CACHE_NAME);
  
  try {
    // Try cache first
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Fetch from network
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      await cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.error('Service Worker: Static asset fetch failed', error);
    // For HTML requests, try to serve from cache
    if (request.headers.get('accept').includes('text/html')) {
      const cachedResponse = await cache.match('/index.html');
      if (cachedResponse) {
        return cachedResponse;
      }
    }
    throw error;
  }
}

// Limit cache size to prevent storage issues
async function limitCacheSize(cache) {
  try {
    const keys = await cache.keys();
    if (keys.length > MAX_TILE_CACHE_SIZE) {
      // Delete oldest entries (first in the array)
      const entriesToDelete = keys.slice(0, keys.length - MAX_TILE_CACHE_SIZE);
      await Promise.all(entriesToDelete.map(key => cache.delete(key)));
      console.log(`Service Worker: Cleaned up ${entriesToDelete.length} old tiles`);
    }
  } catch (error) {
    console.error('Service Worker: Cache size limit error', error);
  }
}
