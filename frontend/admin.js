const API_URL = (window.MEMORIES_API_URL || "http://localhost:8000").replace(/\/$/, "");
const $ = selector => document.querySelector(selector);
let photos = [];
let albums = [];

async function api(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    headers: options.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...options,
  });
  let body;
  try { body = await response.json(); } catch { body = {}; }
  if (!response.ok) throw new Error(body.detail || "Request failed");
  return body;
}
function escapeHtml(value = "") { const node = document.createElement("span"); node.textContent = value; return node.innerHTML; }
function toast(message) {
  $("#adminToast").textContent = message;
  $("#adminToast").classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("#adminToast").classList.remove("show"), 2800);
}

async function checkSession() {
  try { await api("/api/auth/session"); showDashboard(); }
  catch { showLogin(); }
}
function showLogin() {
  $("#loginScreen").classList.remove("hidden");
  $("#dashboard").classList.add("hidden");
}
function showDashboard() {
  $("#loginScreen").classList.add("hidden");
  $("#dashboard").classList.remove("hidden");
  loadAdmin();
}

$("#loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  $("#loginError").textContent = "";
  const form = new FormData(event.target);
  try {
    await api("/api/auth/login", { method: "POST", body: JSON.stringify(Object.fromEntries(form)) });
    showDashboard();
  } catch (error) { $("#loginError").textContent = error.message; }
});
$("#logoutButton").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" }).catch(() => {});
  showLogin();
});
document.querySelectorAll(".side-link").forEach(button => button.addEventListener("click", () => {
  document.querySelectorAll(".side-link").forEach(item => item.classList.remove("active"));
  document.querySelectorAll(".panel").forEach(panel => panel.classList.remove("active"));
  button.classList.add("active");
  $(`#${button.dataset.panel}Panel`).classList.add("active");
}));

async function loadAdmin() {
  const data = await api("/api/gallery");
  photos = data.photos || [];
  albums = data.albums || [];
  renderPhotos();
  renderAlbums();
  fillAlbumSelects();
  const theme = data.theme || {};
  if (theme.theme_name) $("#themeForm [name=theme_name]").value = theme.theme_name;
  if (theme.background) $("#themeForm [name=background]").value = theme.background;
  if (theme.colors?.accent) $("#themeForm [name=accent]").value = theme.colors.accent;
  if (theme.font_family) $("#themeForm [name=font_family]").value = theme.font_family;
  if (theme.background_image) $("#themeForm [name=background_image]").value = theme.background_image;
}
function fillAlbumSelects() {
  const options = albums.map(album => `<option value="${album.id}">${escapeHtml(album.name)}</option>`).join("");
  $("#uploadAlbum").innerHTML = `<option value="">No album</option>${options}`;
}
function renderPhotos() {
  $("#adminPhotoCount").textContent = `${photos.length} photographs`;
  $("#adminPhotoGrid").innerHTML = photos.map(photo => `
    <article class="admin-photo" data-id="${photo.id}">
      <img src="${escapeHtml(photo.public_url)}" alt="">
      <div class="admin-photo-body">
        <h3>${escapeHtml(photo.title)}</h3>
        <button class="featured-toggle" title="Toggle favourite">${photo.featured ? "★ Favourite" : "☆ Favourite"}</button>
        <select class="move-photo" aria-label="Move photo">
          <option value="">No album</option>
          ${albums.map(album => `<option value="${album.id}" ${album.id === photo.album_id ? "selected" : ""}>${escapeHtml(album.name)}</option>`).join("")}
        </select>
        <div class="admin-photo-actions">
          <button class="edit-photo">Edit</button><button class="danger delete-photo">Delete</button>
        </div>
      </div>
    </article>`).join("");
}
function renderAlbums() {
  $("#albumList").innerHTML = albums.map(album => `<div class="album-item"><strong>${escapeHtml(album.name)}</strong><button data-delete="${album.id}">Delete</button></div>`).join("");
}

$("#photoFile").addEventListener("change", event => {
  const file = event.target.files[0];
  if (!file) return;
  $("#uploadPreview").src = URL.createObjectURL(file);
  $("#uploadPreview").style.display = "block";
  $(".image-picker span").style.display = "none";
});
$("#uploadForm").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    await api("/api/photos", { method: "POST", body: new FormData(event.target) });
    event.target.reset();
    $("#uploadPreview").removeAttribute("src");
    $("#uploadPreview").style.display = "none";
    $(".image-picker span").style.display = "";
    await loadAdmin();
    toast("Memory uploaded");
  } catch (error) { toast(error.message); }
});

$("#albumForm").addEventListener("submit", async event => {
  event.preventDefault();
  const name = new FormData(event.target).get("name");
  try {
    await api("/api/albums", { method: "POST", body: JSON.stringify({ name }) });
    event.target.reset();
    await loadAdmin();
    toast("Album created");
  } catch (error) { toast(error.message); }
});
$("#albumList").addEventListener("click", async event => {
  if (!event.target.dataset.delete) return;
  if (!confirm("Delete this album? Its photographs will remain without an album.")) return;
  try {
    await api(`/api/albums/${event.target.dataset.delete}`, { method: "DELETE" });
    await loadAdmin();
    toast("Album deleted");
  } catch (error) { toast(error.message); }
});

$("#adminPhotoGrid").addEventListener("change", async event => {
  if (!event.target.classList.contains("move-photo")) return;
  const id = event.target.closest(".admin-photo").dataset.id;
  try {
    await api(`/api/photos/${id}`, { method: "PATCH", body: JSON.stringify({ album_id: event.target.value || null }) });
    await loadAdmin();
    toast("Photo moved");
  } catch (error) { toast(error.message); }
});
$("#adminPhotoGrid").addEventListener("click", async event => {
  const card = event.target.closest(".admin-photo");
  if (!card) return;
  const photo = photos.find(item => item.id === card.dataset.id);
  if (event.target.classList.contains("delete-photo")) {
    if (!confirm(`Delete "${photo.title}"? This cannot be undone.`)) return;
    try { await api(`/api/photos/${photo.id}`, { method: "DELETE" }); await loadAdmin(); toast("Photo deleted"); }
    catch (error) { toast(error.message); }
  } else if (event.target.classList.contains("edit-photo")) {
    const title = prompt("Photo title", photo.title);
    if (title === null) return;
    const caption = prompt("Photo caption", photo.caption || "") ?? photo.caption;
    try {
      await api(`/api/photos/${photo.id}`, { method: "PATCH", body: JSON.stringify({ title, caption }) });
      await loadAdmin(); toast("Photo updated");
    } catch (error) { toast(error.message); }
  } else if (event.target.classList.contains("featured-toggle")) {
    try {
      await api(`/api/photos/${photo.id}`, { method: "PATCH", body: JSON.stringify({ featured: !photo.featured }) });
      await loadAdmin();
    } catch (error) { toast(error.message); }
  }
});

$("#themeForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = new FormData(event.target);
  const payload = Object.fromEntries(form);
  const backgroundFile = $("#backgroundFile").files[0];
  if (backgroundFile) {
    const upload = new FormData();
    upload.append("file", backgroundFile);
    const uploaded = await api("/api/theme/background", { method: "POST", body: upload });
    payload.background_image = uploaded.url;
  }
  payload.colors = { accent: payload.accent };
  delete payload.accent;
  try { await api("/api/theme", { method: "PUT", body: JSON.stringify(payload) }); toast("Theme saved"); }
  catch (error) { toast(error.message); }
});

checkSession();
