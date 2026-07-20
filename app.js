// ============================================================
// 金融数学研究コックピット - フロントエンドロジック
// 依存: Supabase JS v2 (CDN), KaTeX + auto-render (CDN)
// ============================================================

const { createClient } = supabase;

if (!window.SUPABASE_CONFIG || window.SUPABASE_CONFIG.url.includes("YOUR-PROJECT-REF")) {
  document.addEventListener("DOMContentLoaded", () => {
    document.body.innerHTML =
      '<div style="padding:40px;font-family:sans-serif;color:#e6e9f2;background:#0f1420;height:100vh;">' +
      "<h2>設定が必要です</h2>" +
      "<p><code>config.example.js</code> を <code>config.js</code> にコピーし、" +
      "SupabaseプロジェクトのURLとanon keyを設定してから、<code>index.html</code> をブラウザで開いてください。</p>" +
      "</div>";
  });
  throw new Error("Supabase config missing");
}

const db = createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);

// ---- ユーザー名（表示用。認証ではなく単なる名札） ----
let currentUser = localStorage.getItem("cockpit_username") || "匿名";

// ============================================================
// 接続ステータス表示 & 名前登録
// ============================================================
let realtimeConnected = false;

function setConnected(ok) {
  realtimeConnected = ok;
  const dot = document.getElementById("status-dot");
  const label = document.getElementById("status-label");
  dot.classList.toggle("connected", ok);
  label.textContent = ok ? `接続中: ${currentUser}` : "接続待機中...";
}

const usernameLabel = document.getElementById("username-label");
const usernameEditBtn = document.getElementById("username-edit-btn");
const taskAssigneeInput = document.getElementById("task-assignee");

function renderUsername() {
  usernameLabel.textContent = currentUser;
  taskAssigneeInput.placeholder = `担当者（未入力なら「${currentUser}」）`;
  setConnected(realtimeConnected);
}
renderUsername();

usernameEditBtn.addEventListener("click", () => {
  if (document.getElementById("username-input")) return; // 編集中は多重起動しない
  const input = document.createElement("input");
  input.type = "text";
  input.id = "username-input";
  input.className = "username-input";
  input.maxLength = 20;
  input.value = currentUser === "匿名" ? "" : currentUser;
  input.placeholder = "お名前";
  usernameLabel.replaceWith(input);
  input.focus();
  input.select();

  const commit = () => {
    currentUser = input.value.trim() || "匿名";
    localStorage.setItem("cockpit_username", currentUser);
    if (input.parentNode) input.replaceWith(usernameLabel);
    renderUsername();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape" && input.parentNode) input.replaceWith(usernameLabel);
  });
  input.addEventListener("blur", commit);
});

// ============================================================
// 汎用確認モーダル（OK / いいえ）。window.confirm() は使わない。
// ============================================================
function showConfirm(message) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("confirm-modal-overlay");
    document.getElementById("confirm-modal-message").textContent = message;
    overlay.classList.remove("hidden");
    const okBtn = document.getElementById("confirm-modal-ok");
    const cancelBtn = document.getElementById("confirm-modal-cancel");

    const cleanup = (result) => {
      overlay.classList.add("hidden");
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      overlay.removeEventListener("click", onOverlayClick);
      resolve(result);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onOverlayClick = (e) => {
      if (e.target === overlay) cleanup(false);
    };
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    overlay.addEventListener("click", onOverlayClick);
  });
}

// ============================================================
// 0. チームチャットエリア
// ============================================================
const chatMessagesEl = document.getElementById("chat-messages");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");

function renderChatMessages(messages) {
  chatMessagesEl.innerHTML = "";
  messages
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .forEach((msg) => {
      const div = document.createElement("div");
      div.className = "chat-message";
      const when = new Date(msg.created_at).toLocaleTimeString("ja-JP", {
        hour: "2-digit",
        minute: "2-digit",
      });
      div.innerHTML = `<span class="chat-author">${escapeHtml(msg.author)}</span>${escapeHtml(
        msg.content
      )}<span class="chat-time">${when}</span>`;
      chatMessagesEl.appendChild(div);
    });
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

async function loadChatMessages() {
  const { data, error } = await db
    .from("chat_messages")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return console.error(error);
  renderChatMessages(data);
}

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const content = chatInput.value.trim();
  if (!content) return;
  chatInput.value = "";
  const { error } = await db.from("chat_messages").insert({ author: currentUser, content });
  if (error) alert("メッセージの送信に失敗しました: " + error.message);
});

// ============================================================
// 1. タスク管理エリア
// ============================================================
const taskTableBody = document.querySelector("#task-table tbody");
const taskForm = document.getElementById("task-form");

function renderTasks(tasks) {
  taskTableBody.innerHTML = "";
  tasks
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .forEach((task) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(task.title)}</td>
        <td>${escapeHtml(task.assignee || "未定")}</td>
        <td>
          <select class="status-select" data-id="${task.id}">
            <option value="未着手" ${task.status === "未着手" ? "selected" : ""}>未着手</option>
            <option value="進行中" ${task.status === "進行中" ? "selected" : ""}>進行中</option>
            <option value="完了"   ${task.status === "完了" ? "selected" : ""}>完了</option>
          </select>
        </td>
        <td><button class="icon-btn" data-id="${task.id}" title="削除">✕</button></td>
      `;
      taskTableBody.appendChild(tr);
    });
}

async function loadTasks() {
  const { data, error } = await db.from("tasks").select("*");
  if (error) return console.error(error);
  renderTasks(data);
}

taskForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.getElementById("task-title").value.trim();
  const assignee = document.getElementById("task-assignee").value.trim() || currentUser;
  if (!title) return;
  const { error } = await db.from("tasks").insert({ title, assignee, status: "未着手" });
  if (error) return alert("タスク追加に失敗しました: " + error.message);
  taskForm.reset();
});

taskTableBody.addEventListener("change", async (e) => {
  if (!e.target.classList.contains("status-select")) return;
  const id = e.target.dataset.id;
  const status = e.target.value;
  const { error } = await db.from("tasks").update({ status }).eq("id", id);
  if (error) alert("更新に失敗しました: " + error.message);
});

taskTableBody.addEventListener("click", async (e) => {
  if (!e.target.matches("button[data-id]")) return;
  const ok = await showConfirm("このタスクを削除しますか？");
  if (!ok) return;
  const id = e.target.dataset.id;
  const { error } = await db.from("tasks").delete().eq("id", id);
  if (error) alert("削除に失敗しました: " + error.message);
});

// ============================================================
// 2. 公式検索・登録・コピペエリア
// ============================================================
const formulaList = document.getElementById("formula-list");
const formulaSearch = document.getElementById("formula-search");
const formulaForm = document.getElementById("formula-form");
const copyModeCheckbox = document.getElementById("copy-mode-sheet");

let allFormulas = [];

// $ / $$ で囲まれた部分を剥がし、純粋なLaTeXコードのみを取り出す
function stripDelimiters(raw) {
  let s = raw.trim();
  if (s.startsWith("$$") && s.endsWith("$$") && s.length >= 4) {
    s = s.slice(2, -2);
  } else if (s.startsWith("$") && s.endsWith("$") && s.length >= 2) {
    s = s.slice(1, -1);
  }
  return s.trim();
}

function renderFormulas(list) {
  formulaList.innerHTML = "";
  if (list.length === 0) {
    formulaList.innerHTML = '<p style="color:#94a0bd;font-size:13px;">該当する公式が見つかりません。</p>';
    return;
  }
  list.forEach((f) => {
    const card = document.createElement("div");
    card.className = "formula-card";
    card.innerHTML = `
      <div class="formula-card-head">
        <span class="name">${escapeHtml(f.name)}</span>
        <span class="category">${escapeHtml(f.category || "未分類")}</span>
      </div>
      <div class="formula-preview"><span class="katex-target"></span></div>
      <div class="formula-actions">
        <button class="copy-btn" data-latex="${escapeAttr(f.latex)}">コピー</button>
      </div>
    `;
    const target = card.querySelector(".katex-target");
    try {
      katex.render(f.latex, target, { throwOnError: false, displayMode: true });
    } catch (err) {
      target.textContent = f.latex;
    }
    formulaList.appendChild(card);
  });
}

async function loadFormulas() {
  const { data, error } = await db.from("formulas").select("*").order("created_at", { ascending: true });
  if (error) return console.error(error);
  allFormulas = data;
  applyFormulaFilter();
}

function applyFormulaFilter() {
  const q = formulaSearch.value.trim().toLowerCase();
  const filtered = !q
    ? allFormulas
    : allFormulas.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          f.latex.toLowerCase().includes(q) ||
          (f.category || "").toLowerCase().includes(q)
      );
  renderFormulas(filtered);
}

formulaSearch.addEventListener("input", applyFormulaFilter);

formulaForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("formula-name").value.trim();
  const rawLatex = document.getElementById("formula-latex").value.trim();
  const category = document.getElementById("formula-category").value.trim() || "未分類";
  if (!name || !rawLatex) return;
  const latex = stripDelimiters(rawLatex); // 保存時点で区切り記号を除去しておく
  const { error } = await db.from("formulas").insert({ name, latex, category });
  if (error) return alert("公式の追加に失敗しました: " + error.message);
  formulaForm.reset();
});

formulaList.addEventListener("click", async (e) => {
  if (!e.target.classList.contains("copy-btn")) return;
  const btn = e.target;
  const pureLatex = stripDelimiters(btn.dataset.latex);
  const finalText = copyModeCheckbox.checked ? `'${pureLatex}` : pureLatex;
  try {
    await navigator.clipboard.writeText(finalText);
    btn.textContent = "コピー済み ✓";
    btn.classList.add("copied");
    setTimeout(() => {
      btn.textContent = "コピー";
      btn.classList.remove("copied");
    }, 1200);
  } catch (err) {
    alert("クリップボードへのコピーに失敗しました。ブラウザの権限設定をご確認ください。");
  }
});

// ============================================================
// 3. 作業ログ入力 & リアルタイムプレビュー
// ============================================================
const logInput = document.getElementById("log-input");
const previewPane = document.getElementById("preview-pane");
const saveLogBtn = document.getElementById("save-log-btn");
const logHistoryList = document.getElementById("log-history-list");
const draftMeta = document.getElementById("draft-meta");

let suppressNextRemoteEcho = false;
let draftDebounceTimer = null;

function renderPreview() {
  const raw = logInput.value;
  const escaped = escapeHtml(raw).replace(/\n/g, "<br>");
  previewPane.innerHTML = escaped;
  renderMathInElement(previewPane, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "$", right: "$", display: false },
    ],
    throwOnError: false,
  });
}

logInput.addEventListener("input", () => {
  renderPreview();
  clearTimeout(draftDebounceTimer);
  draftDebounceTimer = setTimeout(pushDraftToServer, 600);
});

async function pushDraftToServer() {
  suppressNextRemoteEcho = true;
  const { error } = await db
    .from("shared_draft")
    .update({ content: logInput.value, updated_by: currentUser })
    .eq("id", 1);
  if (error) console.error(error);
}

async function loadDraft() {
  const { data, error } = await db.from("shared_draft").select("*").eq("id", 1).single();
  if (error) return console.error(error);
  logInput.value = data.content || "";
  draftMeta.textContent = `最終更新: ${data.updated_by || "-"}`;
  renderPreview();
}

saveLogBtn.addEventListener("click", async () => {
  const content = logInput.value.trim();
  if (!content) return alert("保存する内容がありません。");
  const { error } = await db.from("research_logs").insert({ author: currentUser, content });
  if (error) return alert("ログ保存に失敗しました: " + error.message);
  saveLogBtn.textContent = "保存しました ✓";
  setTimeout(() => (saveLogBtn.textContent = "ログとして保存"), 1200);
});

function renderLogHistory(logs) {
  logHistoryList.innerHTML = "";
  logs
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 30)
    .forEach((log) => {
      const div = document.createElement("div");
      div.className = "log-entry";
      const when = new Date(log.created_at).toLocaleString("ja-JP");
      div.innerHTML = `
        <div class="log-meta">
          <span>${escapeHtml(log.author)} ・ ${when}</span>
          <button class="icon-btn log-delete-btn" data-id="${log.id}" title="このログを削除">✕</button>
        </div>
        <div>${escapeHtml(log.content).replace(/\n/g, "<br>")}</div>
      `;
      logHistoryList.appendChild(div);
    });
  renderMathInElement(logHistoryList, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "$", right: "$", display: false },
    ],
    throwOnError: false,
  });
}

async function loadLogHistory() {
  const { data, error } = await db.from("research_logs").select("*").order("created_at", { ascending: false }).limit(30);
  if (error) return console.error(error);
  renderLogHistory(data);
}

logHistoryList.addEventListener("click", async (e) => {
  if (!e.target.classList.contains("log-delete-btn")) return;
  const ok = await showConfirm("この研究ログを削除しますか？この操作は取り消せません。");
  if (!ok) return;
  const id = e.target.dataset.id;
  const { error } = await db.from("research_logs").delete().eq("id", id);
  if (error) alert("削除に失敗しました: " + error.message);
});

// ============================================================
// Realtime購読
// ============================================================
function subscribeRealtime() {
  const channel = db
    .channel("cockpit-realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages" }, loadChatMessages)
    .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, loadTasks)
    .on("postgres_changes", { event: "*", schema: "public", table: "formulas" }, loadFormulas)
    .on("postgres_changes", { event: "*", schema: "public", table: "research_logs" }, loadLogHistory)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "shared_draft" }, (payload) => {
      if (suppressNextRemoteEcho) {
        suppressNextRemoteEcho = false;
        return;
      }
      // 自分がまさに入力中の場合は、上書きしてカーソル位置を壊さないようにする
      if (document.activeElement === logInput) return;
      logInput.value = payload.new.content || "";
      draftMeta.textContent = `最終更新: ${payload.new.updated_by || "-"}`;
      renderPreview();
    })
    .subscribe((status) => {
      setConnected(status === "SUBSCRIBED");
    });
  return channel;
}

// ============================================================
// ユーティリティ
// ============================================================
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}

// ============================================================
// 初期化
// ============================================================
(async function init() {
  await Promise.all([loadChatMessages(), loadTasks(), loadFormulas(), loadDraft(), loadLogHistory()]);
  subscribeRealtime();
})();
