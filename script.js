/* ═══════════════════════════════════════════════════
   Beben & Babby — Photo Album Script (Fixed Responsive)
   ═══════════════════════════════════════════════════ */

// ────────────────────────────────────────────────────
// ☁️ Cloudinary Configuration
// ────────────────────────────────────────────────────
const CLOUD_NAME = "dhwqvozky";
const UPLOAD_PRESET = "benbbyDB";
const UPLOAD_TAG = "benbby-photobook";
const UPLOAD_FOLDER = "benbby-photobook";

const CLOUDINARY_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;
const CLOUDINARY_LIST_URL = `https://res.cloudinary.com/${CLOUD_NAME}/image/list/${UPLOAD_TAG}.json`;

// ── DOM References ──
const photoInput = document.getElementById("photo-input");
const uploadBtn = document.getElementById("upload-btn");
const uploadOverlay = document.getElementById("upload-overlay");
const uploadStatus = document.getElementById("upload-status");
const progressBar = document.getElementById("progress-bar");
const emptyState = document.getElementById("empty-state");
const flipbookWrapper = document.getElementById("flipbook-wrapper");
const flipbookEl = document.getElementById("flipbook");
const prevBtn = document.getElementById("prev-btn");
const nextBtn = document.getElementById("next-btn");
const pageIndicator = document.getElementById("page-indicator"); // Safe reference if exists

let pageFlip = null;
let photos = [];
let isRendering = false; // Render lock to prevent concurrent renders

// ── Constants ──
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const COMPRESS_MAX_DIM = 2000;
const COMPRESS_QUALITY = 0.85;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

// ═══════════════════════════════════════════════════
// Image Compression
// ═══════════════════════════════════════════════════
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > COMPRESS_MAX_DIM || height > COMPRESS_MAX_DIM) {
          const ratio = Math.min(COMPRESS_MAX_DIM / width, COMPRESS_MAX_DIM / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Compression failed")), "image/jpeg", COMPRESS_QUALITY);
      };
      img.onerror = () => reject(new Error("Image load failed"));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

// ═══════════════════════════════════════════════════
// Upload
// ═══════════════════════════════════════════════════
function uploadToCloudinary(blob, filename) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append("file", blob, filename);
    formData.append("upload_preset", UPLOAD_PRESET);
    formData.append("folder", UPLOAD_FOLDER);
    formData.append("tags", UPLOAD_TAG);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", CLOUDINARY_UPLOAD_URL);
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) xhr._progressPercent = (e.loaded / e.total) * 100;
    });
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); } catch { reject(new Error("Invalid JSON")); }
      } else {
        let msg = `Upload failed (${xhr.status})`;
        try { const d = JSON.parse(xhr.responseText); if (d.error?.message) msg = d.error.message; } catch { }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(formData);
    xhr._resolve = resolve;
  });
}

// ═══════════════════════════════════════════════════
// Logic
// ═══════════════════════════════════════════════════
const CACHE_KEY = "benbby_photos_v2"; // New cache key to ensure consistency

function getLocalCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || []; } catch { return []; }
}
function setLocalCache(data) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(data));
}

photoInput.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files);
  if (!files.length) return;

  showOverlay();
  let uploaded = 0;

  for (const file of files) {
    uploadStatus.textContent = `Uploading ${uploaded + 1}/${files.length}…`;
    try {
      if (!ALLOWED_TYPES.includes(file.type)) throw new Error("Not an image");
      if (file.size > MAX_FILE_SIZE) throw new Error("Too large (>10MB)");

      const blob = await compressImage(file);
      const filename = `${Date.now()}_${file.name.replace(/[^a-z0-9._-]/gi, "")}`;
      const res = await uploadToCloudinary(blob, filename);

      const newPhoto = {
        url: res.secure_url,
        public_id: res.public_id,
        created_at: res.created_at || new Date().toISOString()
      };

      // Update local array and cache immediately
      photos.push(newPhoto);
      setLocalCache(photos);

      uploaded++;
      progressBar.style.width = `${(uploaded / files.length) * 100}%`;
    } catch (err) {
      console.error(err);
      alert(`Error: ${err.message}`);
    }
  }

  progressBar.style.width = "100%";
  setTimeout(() => {
    hideOverlay();
    isRendering = false; // Reset flag to allow fresh render
    loadPhotos();
  }, 500);
  photoInput.value = "";
});

async function loadPhotos() {
  // 1. Load from cache first
  const cached = getLocalCache();
  if (cached.length) {
    photos = cached;
    renderBook();
  }

  // 2. Fetch fresh list (bypass cache)
  try {
    const res = await fetch(`${CLOUDINARY_LIST_URL}?t=${Date.now()}`);
    if (res.ok) {
      const data = await res.json();
      if (data.resources) {
        const fresh = data.resources
          .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
          .map(r => ({
            url: `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/${r.public_id}.${r.format}`,
            public_id: r.public_id,
            created_at: r.created_at
          }));

        // Only update and re-render if data actually changed
        const hasChanged = JSON.stringify(photos) !== JSON.stringify(fresh);
        if (hasChanged) {
          console.log("Fresh data differs from cache, updating...");
          photos = fresh;
          setLocalCache(photos);
          renderBook();
        } else {
          console.log("Fresh data matches cache, skipping render");
        }
      }
    }
  } catch (e) {
    console.warn("List API unavailable", e);
    if (!photos.length) renderBook(); // Still render (empty state)
  }
}

// ═══════════════════════════════════════════════════
// Render Book (2 Photos Per Page)
// ═══════════════════════════════════════════════════
function chunkArray(arr, n) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += n) chunks.push(arr.slice(i, i + n));
  return chunks;
}

const TAPE_STYLES = ['tape-pink', 'tape-blue', 'tape-yellow', 'tape-green'];

function renderBook() {
  // Prevent concurrent renders
  if (isRendering) {
    console.log("Render already in progress, skipping...");
    return;
  }

  isRendering = true;

  if (!photos.length) {
    emptyState.classList.remove("hidden");
    flipbookWrapper.classList.add("hidden");
    if (pageIndicator) pageIndicator.classList.add("hidden");
    isRendering = false;
    return;
  }

  emptyState.classList.add("hidden");
  flipbookWrapper.classList.remove("hidden");
  if (pageIndicator) pageIndicator.classList.remove("hidden");

  if (pageFlip) { try { pageFlip.destroy(); } catch { } pageFlip = null; }
  flipbookEl.innerHTML = "";

  // Calculate and store dimensions BEFORE creating pages
  const dims = getDimensions();
  lastDimensions = dims; // Store dimensions early
  console.log("Initial dimensions for render:", dims);

  // ── Pages ──

  // 1. Cover
  const cover = document.createElement("div");
  cover.className = "page cover-page";
  cover.setAttribute("data-density", "hard");
  cover.innerHTML = `<h2>Our Memories</h2><p>Photo Album</p><small>${photos.length} memories</small>`;
  flipbookEl.appendChild(cover);

  // 2. Photos (Responsive: 1 per page on mobile)
  const isMobile = window.innerWidth < 760;
  const itemsPerPage = isMobile ? 1 : 2;
  const chunks = chunkArray(photos, itemsPerPage);

  chunks.forEach((chunk, i) => {
    const page = document.createElement("div");
    page.className = "page";
    page.setAttribute("data-density", "soft"); // Inner pages soft

    const layout = document.createElement("div");
    layout.className = "scrapbook-layout";

    chunk.forEach((p, idx) => {
      const pol = document.createElement("div");
      pol.className = "polaroid";

      // Tape styling
      const tape = document.createElement("div");
      tape.className = `tape ${TAPE_STYLES[(i + idx) % TAPE_STYLES.length]}`;
      pol.appendChild(tape);

      const img = document.createElement("img");
      img.src = p.url;
      img.loading = "lazy";
      pol.appendChild(img);

      // Add random stickers
      addStickers(pol);

      layout.appendChild(pol);
    });

    page.appendChild(layout);
    flipbookEl.appendChild(page);
  });

  // 3. Padding (must be even total inner pages)
  if (chunks.length % 2 !== 0) {
    const blank = document.createElement("div");
    blank.className = "page blank-page";
    blank.setAttribute("data-density", "soft");
    flipbookEl.appendChild(blank);
  }

  // 4. Back Cover
  const back = document.createElement("div");
  back.className = "page cover-page";
  back.setAttribute("data-density", "hard");
  back.innerHTML = `<h2>The End 💚</h2>`;
  flipbookEl.appendChild(back);

  // Force DOM reflow before initialization
  void flipbookEl.offsetHeight;

  // Init StPageFlip after ensuring DOM is ready
  requestAnimationFrame(() => {
    setTimeout(() => {
      const pages = Array.from(flipbookEl.children).filter(el => el.classList.contains('page'));

      if (pages.length === 0) {
        console.error("No pages found for StPageFlip");
        isRendering = false;
        return;
      }

      console.log(`Initializing StPageFlip with ${pages.length} pages`);

      try {
        pageFlip = new St.PageFlip(flipbookEl, {
          width: dims.width,
          height: dims.height,
          size: "stretch",
          minWidth: 280,
          maxWidth: 2000,
          minHeight: 380,
          maxHeight: 2000,
          showCover: true,
          maxShadowOpacity: 0.5,
          autoSize: false, // Disable to prevent auto-resize triggers
          mobileScrollSupport: false
        });

        pageFlip.loadFromHTML(pages);

        // Update page indicator
        pageFlip.on("flip", (e) => {
          if (pageIndicator) pageIndicator.textContent = `Page ${e.data + 1} of ${pageFlip.getPageCount()}`;
        });

        console.log("StPageFlip initialized successfully");
        isRendering = false; // Release lock
        lastRenderTime = Date.now(); // Mark render time
        allowedAutoResizes = 1; // Reset counter for this render

        // Delay before enabling resize handling to prevent immediate triggers
        setTimeout(() => {
          hasInitialRender = true;
          console.log("Resize handling enabled");
        }, 2000); // Increased to 2 seconds

      } catch (err) {
        console.error("StPageFlip init error", err);
        console.error("Pages:", pages);
        isRendering = false; // Release lock on error
      }
    }, 150);
  });
}

function getDimensions() {
  const isMobile = window.innerWidth < 768;
  const availW = window.innerWidth;
  const availH = window.innerHeight;

  if (isMobile) {
    const w = Math.min(availW - 30, 600);
    return { width: w, height: Math.round(w * 1.4) };
  }

  // Desktop: Maximize width usage inside the flex-grown container
  // Calculate max possible page width (half spread)
  const maxSpreadW = availW - 40;
  const maxPageH = availH - 60; // Leave room for header/footer

  // Ideal ratio 3:4 (0.75)
  let pageW = maxSpreadW / 2;
  let pageH = pageW / 0.75;

  // Constrain by height
  if (pageH > maxPageH) {
    pageH = maxPageH;
    pageW = pageH * 0.75;
  }

  return { width: Math.floor(pageW), height: Math.floor(pageH) };
}

// ── Overlay ──
function showOverlay() { uploadOverlay.classList.remove("hidden"); progressBar.style.width = "0%"; }
function hideOverlay() { uploadOverlay.classList.add("hidden"); }

// ── Nav ──
prevBtn?.addEventListener("click", () => pageFlip?.flipPrev());
nextBtn?.addEventListener("click", () => pageFlip?.flipNext());

// ── Resize ──
let resizeTimeout;
let hasInitialRender = false;
let lastDimensions = null;
let lastRenderTime = 0;
let allowedAutoResizes = 1; // Allow one auto-resize after init
let lastResizeEventTime = 0;
const RENDER_COOLDOWN = 2000; // Minimum 2 seconds between renders
const RESIZE_EVENT_DEBOUNCE = 1000; // Treat resizes within 1s as same event

// Use ResizeObserver instead of window resize for better control
const resizeObserver = new ResizeObserver((entries) => {
  if (!hasInitialRender || !photos.length || isRendering) return;

  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    const now = Date.now();
    const timeSinceLastRender = now - lastRenderTime;
    const timeSinceLastResizeEvent = now - lastResizeEventTime;

    if (timeSinceLastRender < RENDER_COOLDOWN) {
      console.log(`Resize skipped (cooldown: ${timeSinceLastRender}ms < ${RENDER_COOLDOWN}ms)`);
      return;
    }

    const newDims = getDimensions();
    const dimsChanged = !lastDimensions ||
      Math.abs(lastDimensions.width - newDims.width) > 20 || // Allow 20px tolerance
      Math.abs(lastDimensions.height - newDims.height) > 20;

    if (dimsChanged) {
      // If this resize event is within 1s of last one, consider it part of same settling
      const isPartOfSameEvent = timeSinceLastResizeEvent < RESIZE_EVENT_DEBOUNCE;

      // Allow one automatic resize after initialization (StPageFlip settling)
      if (allowedAutoResizes > 0 && isPartOfSameEvent) {
        console.log(`Auto-resize (part of settling event), updating dimensions only`);
        console.log("  Old:", lastDimensions);
        console.log("  New:", newDims);
        lastDimensions = newDims;
        lastResizeEventTime = now;
        return; // Exit here, don't re-render
      }

      if (allowedAutoResizes > 0 && !isPartOfSameEvent) {
        console.log(`First auto-resize allowed, updating dimensions only`);
        console.log("  Old:", lastDimensions);
        console.log("  New:", newDims);
        allowedAutoResizes--;
        lastDimensions = newDims;
        lastRenderTime = now;
        lastResizeEventTime = now;
        return; // Exit here, don't re-render
      }

      console.log("Dimension change detected:");
      console.log("  Old:", lastDimensions);
      console.log("  New:", newDims);
      console.log("  Diff:", {
        width: newDims.width - (lastDimensions?.width || 0),
        height: newDims.height - (lastDimensions?.height || 0)
      });
      lastDimensions = newDims;
      lastRenderTime = now;
      lastResizeEventTime = now;

      console.log("Performing full re-render due to dimension change");
      renderBook();
    }
  }, 600);
});

// Observe the main container
if (flipbookWrapper) {
  resizeObserver.observe(flipbookWrapper);
}

// ── Stickers ──
function addStickers(container) {
  // Add 1-3 stickers per photo!
  const count = Math.floor(Math.random() * 2) + 1;

  for (let i = 0; i < count; i++) {
    const heart = document.createElement("div");
    heart.className = "sticker-heart";
    // Varied emojis for cuteness
    heart.textContent = ["❤️", "💕", "✨", "🌸", "💌", "🎀", "🧸"][Math.floor(Math.random() * 7)];

    // Simpler random placement logic (around edges)
    const angle = Math.random() * 360;
    const distance = 40 + Math.random() * 20; // 40-60px from center? No, center of polaroid is tricky.
    // Better: use corners logic but randomized

    const positions = [
      { top: "-25px", left: "-25px", transform: `rotate(-${15 + Math.random() * 20}deg)` },
      { top: "-30px", right: "-15px", transform: `rotate(${15 + Math.random() * 20}deg)` },
      { bottom: "90px", right: "-25px", transform: `rotate(${10 + Math.random() * 20}deg)` }, // Side
      { bottom: "-25px", left: "0px", transform: `rotate(-${10 + Math.random() * 20}deg)` },
      { top: "40%", right: "-35px", transform: `rotate(${Math.random() * 40}deg)` },
      { top: "40%", left: "-35px", transform: `rotate(-${Math.random() * 40}deg)` }
    ];

    const pos = positions[Math.floor(Math.random() * positions.length)];
    Object.assign(heart.style, pos);

    // Stagger animation
    heart.style.animationDelay = `${Math.random()}s`;

    container.appendChild(heart);
  }
}

// Start
loadPhotos();