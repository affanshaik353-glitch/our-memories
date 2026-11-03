const API_URL = (window.MEMORIES_API_URL || "http://localhost:8000").replace(/\/$/, "");

let photos = [];
let albums = [];
let theme = {};
let currentPhotoId = null;
let visitor = {};
let supabaseClient = null;

const $ = (selector) => document.querySelector(selector);

async function api(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    headers: options.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...options,
  });
  let payload;
  try { payload = await response.json(); } catch { payload = {}; }
  if (!response.ok) throw new Error(payload.detail || "Something went wrong");
  return payload;
}

function escapeHtml(value = "") {
  const node = document.createElement("span");
  node.textContent = value;
  return node.innerHTML;
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 2600);
}

function applyTheme(themeRow) {
  theme = themeRow || {};
  if (!theme.id) return;
  document.documentElement.style.setProperty("--pink", theme.colors?.accent || "#d46b9d");
  if (theme.background) document.body.style.background = theme.background_image
    ? `linear-gradient(rgba(255,255,255,.82),rgba(255,255,255,.82)), url("${theme.background_image}") center/cover fixed`
    : theme.background;
  document.body.style.fontFamily = `"${theme.font_family || "Nunito"}", sans-serif`;
}

function photoCard(photo) {
  const liked = photo.liked_by_visitor ? " liked" : "";
  const comments = photo.comment_count || 0;
  return `<article class="photo-card" data-id="${photo.id}" tabindex="0">
    <img class="photo-image" src="${escapeHtml(photo.public_url)}" alt="${escapeHtml(photo.title)}" loading="lazy">
    <div class="photo-body">
      <div class="photo-title-row"><h4>${escapeHtml(photo.title)}</h4></div>
      <p>${escapeHtml(photo.caption || "")}</p>
      <p class="photo-date">${formatDate(photo.uploaded_at)}</p>
      <div class="photo-actions">
        <button class="card-like${liked}" data-action="like" aria-label="Like ${escapeHtml(photo.title)}">♥ <span>${photo.like_count || 0}</span></button>
        <button data-action="open">💬 ${comments}</button>
      </div>
    </div>
  </article>`;
}

function renderGallery() {
  const term = $("#searchInput").value.trim().toLowerCase();
  const albumId = $("#albumFilter").value;
  const filtered = photos.filter(photo =>
    (!term || photo.title.toLowerCase().includes(term)) &&
    (!albumId || photo.album_id === albumId)
  );
  $("#galleryGrid").innerHTML = filtered.map(photoCard).join("");
  $("#recentGrid").innerHTML = filtered.slice(0, 6).map(photoCard).join("");
  $("#favoritesGrid").innerHTML = filtered.filter(photo => photo.featured).map(photoCard).join("");
  $("#favoritesSection").classList.toggle("hidden", !filtered.some(photo => photo.featured));
  $("#emptyGallery").classList.toggle("hidden", filtered.length > 0);
  $("#photoCount").textContent = `${filtered.length} memories`;
  $("#stats").innerHTML = `<span>📷 ${photos.length} memories</span><span>📚 ${albums.length} albums</span><span>♡ ${photos.reduce((sum, photo) => sum + (photo.like_count || 0), 0)} likes</span>`;
}

async function loadGallery() {
  const data = await api("/api/gallery");
  photos = data.photos || [];
  albums = data.albums || [];
  visitor = data.visitor || {};
  $("#visitorName").value = visitor.display_name || "";
  $("#albumFilter").innerHTML = `<option value="">All albums</option>` +
    albums.map(album => `<option value="${album.id}">${escapeHtml(album.name)}</option>`).join("");
  applyTheme(data.theme);
  renderGallery();
}

function openPhoto(photoId) {
  const visible = filteredPhotos();
  currentPhotoId = photoId;
  const photo = photos.find(item => item.id === photoId);
  if (!photo) return;
  $("#lightboxImage").src = photo.public_url;
  $("#lightboxImage").alt = photo.title;
  $("#lightboxTitle").textContent = photo.title;
  $("#lightboxCaption").textContent = photo.caption || "";
  $("#lightboxDate").textContent = formatDate(photo.uploaded_at);
  $("#lightboxLike").className = photo.liked_by_visitor ? "liked" : "";
  $("#lightboxLike").innerHTML = `${photo.liked_by_visitor ? "♥" : "♡"} <span>${photo.like_count || 0}</span>`;
  $("#lightboxCommentCount").textContent = `💬 ${photo.comment_count || 0}`;
  $("#lightboxComments").innerHTML = (photo.comments || []).map(comment => `
    <div class="comment"><strong>${escapeHtml(comment.display_name)}</strong>
      <time>${formatDate(comment.created_at)}</time><p>${escapeHtml(comment.body)}</p></div>`).join("");
  $("#commentName").value = visitor.display_name || "";
  $("#lightbox").hidden = false;
  document.body.style.overflow = "hidden";
}

function filteredPhotos() {
  const term = $("#searchInput").value.trim().toLowerCase();
  const albumId = $("#albumFilter").value;
  return photos.filter(photo => (!term || photo.title.toLowerCase().includes(term)) && (!albumId || photo.album_id === albumId));
}

function closeLightbox() {
  $("#lightbox").hidden = true;
  document.body.style.overflow = "";
  currentPhotoId = null;
}

async function toggleLike(photoId) {
  await api(`/api/photos/${photoId}/like`, { method: "POST" });
  await loadGallery();
  if (currentPhotoId) openPhoto(currentPhotoId);
}

async function setupRealtime() {
  try {
    const config = await api("/api/config");
    if (!config.supabase_url || !config.supabase_anon_key || !window.supabase) return;
    supabaseClient = window.supabase.createClient(config.supabase_url, config.supabase_anon_key);
    supabaseClient.channel("memory-events").on("postgres_changes", { event: "*", schema: "public" }, () => loadGallery()).subscribe();
  } catch (error) {
    console.warn("Realtime unavailable:", error.message);
  }
}

document.addEventListener("click", async event => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    const view = viewButton.dataset.view;
    document.querySelectorAll(".view").forEach(section => section.classList.toggle("active", section.id === view));
    document.querySelectorAll("[data-view]").forEach(button => button.classList.toggle("active", button.dataset.view === view));
    document.getElementById(view)?.scrollIntoView({ behavior: "smooth" });
  }

  const card = event.target.closest(".photo-card");
  if (card && event.target.closest("[data-action]")) {
    const action = event.target.closest("[data-action]").dataset.action;
    if (action === "like") toggleLike(card.dataset.id).catch(error => toast(error.message));
    else openPhoto(card.dataset.id);
  } else if (card && (event.target.classList.contains("photo-image") || event.target.closest(".photo-body"))) {
    openPhoto(card.dataset.id);
  }
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && currentPhotoId) closeLightbox();
});

$("#searchInput").addEventListener("input", renderGallery);
$("#albumFilter").addEventListener("change", renderGallery);
$("#saveName").addEventListener("click", async () => {
  try {
    await api("/api/visitor", { method: "POST", body: JSON.stringify({ display_name: $("#visitorName").value }) });
    visitor.display_name = $("#visitorName").value;
    toast("Your display name is saved");
  } catch (error) { toast(error.message); }
});

$("#lightboxClose").addEventListener("click", closeLightbox);
$("#lightboxLike").addEventListener("click", () => toggleLike(currentPhotoId).catch(error => toast(error.message)));
$("#previousPhoto").addEventListener("click", () => navigatePhoto(-1));
$("#nextPhoto").addEventListener("click", () => navigatePhoto(1));
function navigatePhoto(direction) {
  const visible = filteredPhotos();
  const index = visible.findIndex(photo => photo.id === currentPhotoId);
  if (!visible.length) return;
  openPhoto(visible[(index + direction + visible.length) % visible.length].id);
}

$("#commentForm").addEventListener("submit", async event => {
  event.preventDirty = true;
  event.preventDefault();
  try {
    await api(`/api/photos/${currentPhotoId}/comments`, { method: "POST", body: JSON.stringify({
      display_name: $("#commentName").value, body: $("#commentBody").value
    }) });
    $("#commentBody").value = "";
    await loadGallery();
    openPhoto(currentPhotoId);
    toast("Comment posted");
  } catch (error) { toast(error.message); }
});

window.addEventListener("load", async () => {
  try {
    await loadGallery();
    await setupRealtime();
  } catch (error) { toast(error.message); }
  $("#loader").classList.add("done");
});
