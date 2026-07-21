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

// ---- ユーザー名（表示用。認証ではなく単なる名札。入室ゲートで確定する） ----
let currentUser = null;

// ---- 管理者モード：名前としてこの値を入力すると管理者になる ----
// 表示上は常に「管理者」と表示され、名前を変えない限り管理者は終了しない。
const ADMIN_SECRET = "23042";
let isAdmin = false;

function displayName(name) {
  return name === ADMIN_SECRET ? "管理者" : name;
}

// ============================================================
// 接続ステータス表示 & 名前登録
// ============================================================
let realtimeConnected = false;

function setConnected(ok) {
  realtimeConnected = ok;
  const dot = document.getElementById("status-dot");
  const label = document.getElementById("status-label");
  dot.classList.toggle("connected", ok);
  label.textContent = ok ? `接続中: ${displayName(currentUser)}` : "接続待機中...";
}

const usernameLabel = document.getElementById("username-label");
const usernameEditBtn = document.getElementById("username-edit-btn");
const taskAssigneeInput = document.getElementById("task-assignee");
const adminBadge = document.getElementById("admin-badge");
const adminTrashBtn = document.getElementById("admin-trash-btn");

function renderUsername() {
  usernameLabel.textContent = displayName(currentUser);
  taskAssigneeInput.placeholder = `担当者（未入力なら「${displayName(currentUser)}」）`;
  setConnected(realtimeConnected);
}

// 名前が確定・変更されるたびに呼ぶ。管理者かどうかを判定し直し、
// 管理者しか見えないボタンや表示を持つ箇所を再描画する。
function refreshAdminStatus() {
  const wasAdmin = isAdmin;
  isAdmin = currentUser === ADMIN_SECRET;
  adminBadge.classList.toggle("hidden", !isAdmin);
  adminTrashBtn.classList.toggle("hidden", !isAdmin);
  const chatClearAllBtn = document.getElementById("chat-clear-all-btn");
  if (chatClearAllBtn) chatClearAllBtn.classList.toggle("hidden", !isAdmin);
  // 管理者かどうかが切り替わった場合のみ、削除・編集ボタンの表示を反映するため再読込する
  if (isAdmin !== wasAdmin) {
    applyFormulaFilter();
    loadTasks();
    loadLogHistory();
    loadChatMessages();
  }
}

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

  // Enterキーとblur（フォーカス喪失）の両方からcommitが呼ばれ得るため、
  // 二重実行を防ぐフラグを持たせる。
  let settled = false;

  const commit = () => {
    if (settled) return;
    settled = true;
    const newName = input.value.trim() || "匿名";
    const nameChanged = newName !== currentUser;
    currentUser = newName;
    localStorage.setItem("cockpit_username", currentUser);
    if (input.isConnected) input.replaceWith(usernameLabel);
    renderUsername();
    if (nameChanged) {
      refreshAdminStatus(); // 名前が変わったら管理者かどうかを判定し直す
      joinPresence(currentUser); // 名前を変えたら同一人物と分かる名前で再接続
    }
  };
  const cancel = () => {
    if (settled) return;
    settled = true;
    if (input.isConnected) input.replaceWith(usernameLabel);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") cancel();
  });
  input.addEventListener("blur", commit);
});

// ============================================================
// 入室ゲート：名前を入力するまでアプリを開始しない
// ============================================================
const entryGateOverlay = document.getElementById("entry-gate-overlay");
const entryNameInput = document.getElementById("entry-name-input");
const entrySubmitBtn = document.getElementById("entry-submit-btn");

const savedUsername = localStorage.getItem("cockpit_username");
if (savedUsername) entryNameInput.value = savedUsername;
entryNameInput.focus();

function enterApp() {
  currentUser = entryNameInput.value.trim() || "匿名";
  localStorage.setItem("cockpit_username", currentUser);
  entryGateOverlay.classList.add("hidden");
  isAdmin = currentUser === ADMIN_SECRET;
  adminBadge.classList.toggle("hidden", !isAdmin);
  adminTrashBtn.classList.toggle("hidden", !isAdmin);
  document.getElementById("chat-clear-all-btn").classList.toggle("hidden", !isAdmin);
  renderUsername();
  init();
}

entrySubmitBtn.addEventListener("click", enterApp);
entryNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    enterApp();
  }
});

// ============================================================
// 接続中メンバー一覧（Supabase Realtime Presence）
// 同じ名前で入室した場合は同一人物として1件にまとめられる
// ============================================================
let presenceChannel = null;
const onlineUsers = new Map();

const onlineUsersBtn = document.getElementById("online-users-btn");
const onlineUsersPanel = document.getElementById("online-users-panel");
const onlineUsersList = document.getElementById("online-users-list");
const onlineCountEl = document.getElementById("online-count");

function renderOnlineUsers() {
  const names = Array.from(onlineUsers.keys()).sort((a, b) => a.localeCompare(b, "ja"));
  onlineCountEl.textContent = names.length;
  onlineUsersList.innerHTML =
    names.map((n) => `<li>${escapeHtml(displayName(n))}${n === currentUser ? "（自分）" : ""}</li>`).join("") ||
    "<li>誰も接続していません</li>";
}

async function joinPresence(name) {
  if (presenceChannel) {
    // 古いチャンネルの離脱が完了してから新しい名前で再接続しないと、
    // 同じトピック名のチャンネルが使い回されて名前（key）が切り替わらない。
    await db.removeChannel(presenceChannel);
    presenceChannel = null;
  }
  const channel = db.channel("cockpit-presence", {
    config: { presence: { key: name } },
  });
  presenceChannel = channel;
  channel
    .on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      onlineUsers.clear();
      Object.keys(state).forEach((key) => onlineUsers.set(key, state[key].length));
      renderOnlineUsers();
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ online_at: new Date().toISOString() });
      }
    });
}

onlineUsersBtn.addEventListener("click", () => {
  onlineUsersPanel.classList.toggle("hidden");
});
document.addEventListener("click", (e) => {
  if (!onlineUsersPanel.classList.contains("hidden") && !e.target.closest(".online-users-widget")) {
    onlineUsersPanel.classList.add("hidden");
  }
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

// ------------------------------------------------------------
// ゴミ箱（管理者のみ）: 4テーブルの論理削除済みデータをまとめて表示・復元
// ------------------------------------------------------------
const TRASH_TABLES = [
  { table: "tasks", label: "タスク", text: (r) => r.title },
  { table: "formulas", label: "公式", text: (r) => r.name },
  { table: "research_logs", label: "研究ログ", text: (r) => r.content },
  { table: "chat_messages", label: "チャット", text: (r) => r.content },
];

async function loadTrash() {
  const trashList = document.getElementById("admin-trash-list");
  const results = await Promise.all(
    TRASH_TABLES.map(async ({ table }) => {
      const { data, error } = await db
        .from(table)
        .select("*")
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false })
        .limit(20);
      if (error) {
        console.error(error);
        return [];
      }
      return data.map((row) => ({ table, row }));
    })
  );
  const items = results
    .flat()
    .sort((a, b) => new Date(b.row.deleted_at) - new Date(a.row.deleted_at))
    .slice(0, 30);

  if (items.length === 0) {
    trashList.innerHTML = "<li>ゴミ箱は空です。</li>";
    return;
  }
  trashList.innerHTML = items
    .map(({ table, row }) => {
      const meta = TRASH_TABLES.find((t) => t.table === table);
      const preview = (meta.text(row) || "").slice(0, 40);
      const when = new Date(row.deleted_at).toLocaleString("ja-JP");
      return `
        <li>
          <span class="trash-type">${meta.label}</span>
          <span class="trash-preview">${escapeHtml(preview)}</span>
          <span class="trash-time">${when}</span>
          <button class="link-btn trash-restore-btn" data-table="${table}" data-id="${row.id}">復元</button>
        </li>
      `;
    })
    .join("");
}

// トリガーとなるボタン自体が管理者以外には表示されないため、
// リスナー登録そのものは常時行ってよい。
{
  const trashPanel = document.getElementById("admin-trash-panel");
  adminTrashBtn.addEventListener("click", () => {
    const willOpen = trashPanel.classList.contains("hidden");
    trashPanel.classList.toggle("hidden");
    if (willOpen) loadTrash();
  });
  document.addEventListener("click", (e) => {
    if (!trashPanel.classList.contains("hidden") && !e.target.closest("#admin-trash-btn") && !e.target.closest("#admin-trash-panel")) {
      trashPanel.classList.add("hidden");
    }
  });
  document.getElementById("admin-trash-list").addEventListener("click", async (e) => {
    const btn = e.target.closest(".trash-restore-btn");
    if (!btn) return;
    const { error } = await db
      .from(btn.dataset.table)
      .update({ deleted_at: null })
      .eq("id", btn.dataset.id);
    if (error) return alert("復元に失敗しました: " + error.message);
    loadTrash();
  });

  document.getElementById("admin-trash-restore-all-btn").addEventListener("click", async () => {
    const ok = await showConfirm("ゴミ箱の中身を全て復元しますか？");
    if (!ok) return;
    const results = await Promise.all(
      TRASH_TABLES.map(({ table }) =>
        db.from(table).update({ deleted_at: null }).not("deleted_at", "is", null)
      )
    );
    const failed = results.find((r) => r.error);
    if (failed) alert("一部の復元に失敗しました: " + failed.error.message);
    loadTrash();
  });

  document.getElementById("admin-trash-empty-btn").addEventListener("click", async () => {
    const ok = await showConfirm("ゴミ箱を空にします。完全に削除され、復元できなくなります。よろしいですか？");
    if (!ok) return;
    const results = await Promise.all(
      TRASH_TABLES.map(({ table }) => db.from(table).delete().not("deleted_at", "is", null))
    );
    const failed = results.find((r) => r.error);
    if (failed) alert("一部の完全削除に失敗しました: " + failed.error.message);
    loadTrash();
  });
}

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
      const deleteBtn = isAdmin
        ? `<button class="icon-btn chat-delete-btn" data-id="${msg.id}" title="このメッセージを削除（管理者）">✕</button>`
        : "";
      div.innerHTML = `<span class="chat-author">${escapeHtml(displayName(msg.author))}</span>${escapeHtml(
        msg.content
      )}<span class="chat-time">${when}</span>${deleteBtn}`;
      chatMessagesEl.appendChild(div);
    });
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

async function loadChatMessages() {
  const { data, error } = await db
    .from("chat_messages")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return console.error(error);
  renderChatMessages(data);
}

// チャットは最新50件程度に保つ。上限を超えた分は古いものから論理削除する
// （ゴミ箱から復元は可能）。新規投稿のたびに呼び出せば十分で、
// DBスキーマの変更は不要（anonキーの既存RLSの範囲内で完結する）。
const CHAT_MESSAGE_LIMIT = 50;

async function trimChatMessages() {
  const { data, error } = await db
    .from("chat_messages")
    .select("id")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range(CHAT_MESSAGE_LIMIT, CHAT_MESSAGE_LIMIT + 200);
  if (error || !data || data.length === 0) return;
  const overflowIds = data.map((row) => row.id);
  const { error: trimError } = await db
    .from("chat_messages")
    .update({ deleted_at: new Date().toISOString() })
    .in("id", overflowIds);
  if (trimError) console.error(trimError);
}

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const content = chatInput.value.trim();
  if (!content) return;
  chatInput.value = "";
  const { error } = await db.from("chat_messages").insert({ author: currentUser, content });
  if (error) alert("メッセージの送信に失敗しました: " + error.message);
  else trimChatMessages();
});

chatMessagesEl.addEventListener("click", async (e) => {
  const btn = e.target.closest(".chat-delete-btn");
  if (!btn) return;
  const ok = await showConfirm("このチャットメッセージを削除しますか？（管理者操作・ゴミ箱から復元できます）");
  if (!ok) return;
  const { error } = await db
    .from("chat_messages")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", btn.dataset.id);
  if (error) alert("削除に失敗しました: " + error.message);
});

document.getElementById("chat-clear-all-btn").addEventListener("click", async () => {
  const ok = await showConfirm("チームチャットを全て削除しますか？（管理者操作・ゴミ箱から復元できます）");
  if (!ok) return;
  const { error } = await db
    .from("chat_messages")
    .update({ deleted_at: new Date().toISOString() })
    .is("deleted_at", null);
  if (error) alert("全消去に失敗しました: " + error.message);
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
      const deleteCell = isAdmin
        ? `<td><button class="icon-btn task-delete-btn" data-id="${task.id}" title="削除（管理者）">✕</button></td>`
        : "<td></td>";
      // タスク名・担当者は全員がその場で直接編集できる（削除は管理者のみ）。
      // 担当者欄は表示名に変換してから値を埋める（管理者の名札文字列をそのまま出さないため）。
      const titleCell = `<input type="text" class="task-edit-input" data-id="${task.id}" data-field="title" value="${escapeAttr(task.title)}" />`;
      const assigneeCell = `<input type="text" class="task-edit-input" data-id="${task.id}" data-field="assignee" value="${escapeAttr(displayName(task.assignee || ""))}" placeholder="未定" />`;
      tr.innerHTML = `
        <td>${titleCell}</td>
        <td>${assigneeCell}</td>
        <td>
          <select class="status-select" data-id="${task.id}">
            <option value="未着手" ${task.status === "未着手" ? "selected" : ""}>未着手</option>
            <option value="進行中" ${task.status === "進行中" ? "selected" : ""}>進行中</option>
            <option value="完了"   ${task.status === "完了" ? "selected" : ""}>完了</option>
          </select>
        </td>
        ${deleteCell}
      `;
      taskTableBody.appendChild(tr);
    });
}

async function loadTasks() {
  const { data, error } = await db.from("tasks").select("*").is("deleted_at", null);
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
  if (e.target.classList.contains("status-select")) {
    const id = e.target.dataset.id;
    const status = e.target.value;
    const { error } = await db.from("tasks").update({ status }).eq("id", id);
    if (error) alert("更新に失敗しました: " + error.message);
    return;
  }

  if (e.target.classList.contains("task-edit-input")) {
    const id = e.target.dataset.id;
    const field = e.target.dataset.field;
    const value = e.target.value.trim();
    if (field === "title" && !value) {
      alert("タスク名は空にできません。");
      loadTasks();
      return;
    }
    const { error } = await db
      .from("tasks")
      .update({ [field]: field === "assignee" ? value || null : value })
      .eq("id", id);
    if (error) alert("更新に失敗しました: " + error.message);
  }
});

// 管理者用のタスク名・担当者編集欄はEnterキーでも確定できるようにする
taskTableBody.addEventListener("keydown", (e) => {
  if (e.target.classList.contains("task-edit-input") && e.key === "Enter") {
    e.target.blur();
  }
});

taskTableBody.addEventListener("click", async (e) => {
  const btn = e.target.closest(".task-delete-btn");
  if (!btn) return;
  const ok = await showConfirm("このタスクを削除しますか？（管理者操作・ゴミ箱から復元できます）");
  if (!ok) return;
  const { error } = await db
    .from("tasks")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", btn.dataset.id);
  if (error) alert("削除に失敗しました: " + error.message);
});

// ============================================================
// 2. 公式検索・登録・コピペエリア
// ============================================================
const formulaList = document.getElementById("formula-list");
const formulaSearch = document.getElementById("formula-search");
const formulaCategoryFilter = document.getElementById("formula-category-filter");
const formulaForm = document.getElementById("formula-form");
const formulaNameInput = document.getElementById("formula-name");
const formulaDuplicateWarning = document.getElementById("formula-duplicate-warning");
const copyModeCheckbox = document.getElementById("copy-mode-sheet");

let allFormulas = [];
const expandedFormulaIds = new Set();
// カテゴリ見出しの開閉状態。公式が増えても一覧が縦に伸び続けないよう、
// 既定では各カテゴリを畳んでおき、検索・絞り込み中のみ自動で開く。
const expandedCategories = new Set();
let editingFormulaId = null;

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

// 1件分の公式カード（表示 or 管理者編集フォーム）のDOM要素を組み立てる
function buildFormulaCard(f) {
  const isOpen = expandedFormulaIds.has(f.id);
  const card = document.createElement("div");
  card.className = "formula-card" + (isOpen ? " open" : "");

  if (isAdmin && editingFormulaId === f.id) {
    card.innerHTML = `
      <button type="button" class="formula-card-toggle" data-id="${f.id}">
        <span class="chevron">▶</span>
        <span class="name">${escapeHtml(f.name)}</span>
        <span class="category">${escapeHtml(f.category || "未分類")}</span>
      </button>
      <div class="formula-card-body">
        <form class="formula-edit-form" data-id="${f.id}">
          <input type="text" class="formula-edit-name" value="${escapeAttr(f.name)}" required />
          <textarea class="formula-edit-latex" rows="2" required>${escapeHtml(f.latex)}</textarea>
          <input type="text" class="formula-edit-category" value="${escapeAttr(f.category || "")}" />
          <div class="formula-actions">
            <button type="submit" class="primary-btn">保存</button>
            <button type="button" class="secondary-btn formula-edit-cancel">キャンセル</button>
          </div>
        </form>
      </div>
    `;
    return card;
  }

  const adminButtons = isAdmin
    ? `<button class="secondary-btn formula-edit-btn" data-id="${f.id}">編集</button>
       <button class="secondary-btn formula-delete-btn" data-id="${f.id}">削除</button>`
    : "";
  card.innerHTML = `
    <button type="button" class="formula-card-toggle" data-id="${f.id}">
      <span class="chevron">▶</span>
      <span class="name">${escapeHtml(f.name)}</span>
      <span class="category">${escapeHtml(f.category || "未分類")}</span>
    </button>
    <div class="formula-card-body" ${isOpen ? "" : "hidden"}>
      <div class="formula-preview"><span class="katex-target"></span></div>
      <div class="formula-actions">
        <button class="copy-btn" data-latex="${escapeAttr(f.latex)}">コピー</button>
        ${adminButtons}
      </div>
    </div>
  `;
  const target = card.querySelector(".katex-target");
  try {
    katex.render(f.latex, target, { throwOnError: false, displayMode: true });
  } catch (err) {
    target.textContent = f.latex;
  }
  return card;
}

// カテゴリごとに折りたたみ可能な見出しでグループ化して表示する。
// forceOpen が true の場合（検索・カテゴリ絞り込み中）は全グループを強制的に開く。
function renderFormulas(list, forceOpen) {
  formulaList.innerHTML = "";
  if (list.length === 0) {
    formulaList.innerHTML = '<p style="color:#94a0bd;font-size:13px;">該当する公式が見つかりません。</p>';
    return;
  }

  const groups = new Map();
  list.forEach((f) => {
    const cat = f.category || "未分類";
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(f);
  });
  const categoryNames = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b, "ja"));

  categoryNames.forEach((cat) => {
    const items = groups.get(cat);
    const isOpen = forceOpen || expandedCategories.has(cat);
    const groupEl = document.createElement("div");
    groupEl.className = "category-group" + (isOpen ? " open" : "");
    groupEl.innerHTML = `
      <button type="button" class="category-toggle" data-category="${escapeAttr(cat)}">
        <span class="chevron">▶</span>
        <span class="cat-name">${escapeHtml(cat)}</span>
        <span class="cat-count">${items.length}</span>
      </button>
      <div class="category-body" ${isOpen ? "" : "hidden"}></div>
    `;
    const body = groupEl.querySelector(".category-body");
    items.forEach((f) => body.appendChild(buildFormulaCard(f)));
    formulaList.appendChild(groupEl);
  });
}

// 検索/カテゴリ絞り込みのプルダウンを、現在登録されているカテゴリ一覧で更新する
function populateCategoryFilterOptions() {
  const categories = Array.from(new Set(allFormulas.map((f) => f.category || "未分類"))).sort((a, b) =>
    a.localeCompare(b, "ja")
  );
  const current = formulaCategoryFilter.value;
  formulaCategoryFilter.innerHTML =
    '<option value="">カテゴリ: すべて</option>' +
    categories.map((c) => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join("");
  if (categories.includes(current)) formulaCategoryFilter.value = current;
}

async function loadFormulas() {
  const { data, error } = await db
    .from("formulas")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) return console.error(error);
  allFormulas = data;
  populateCategoryFilterOptions();
  applyFormulaFilter();
}

function applyFormulaFilter() {
  const q = formulaSearch.value.trim().toLowerCase();
  const selectedCategory = formulaCategoryFilter.value;
  let filtered = allFormulas;
  if (selectedCategory) {
    filtered = filtered.filter((f) => (f.category || "未分類") === selectedCategory);
  }
  if (q) {
    filtered = filtered.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        f.latex.toLowerCase().includes(q) ||
        (f.category || "").toLowerCase().includes(q)
    );
  }
  // 編集中の公式は、そのカテゴリが畳まれていても見失わないように開いておく
  if (editingFormulaId) {
    const editing = allFormulas.find((f) => f.id === editingFormulaId);
    if (editing) expandedCategories.add(editing.category || "未分類");
  }
  const forceOpen = Boolean(q) || Boolean(selectedCategory);
  renderFormulas(filtered, forceOpen);
}

formulaSearch.addEventListener("input", applyFormulaFilter);
formulaCategoryFilter.addEventListener("change", applyFormulaFilter);

// 登録名が既存の公式名と重複・類似していないかその場でチェックする
function findDuplicateFormulas(name) {
  const q = name.trim().toLowerCase();
  if (!q) return [];
  return allFormulas.filter((f) => {
    const existing = f.name.trim().toLowerCase();
    return existing === q || existing.includes(q) || q.includes(existing);
  });
}

formulaNameInput.addEventListener("input", () => {
  const duplicates = findDuplicateFormulas(formulaNameInput.value);
  if (duplicates.length === 0) {
    formulaDuplicateWarning.classList.add("hidden");
    formulaDuplicateWarning.textContent = "";
    return;
  }
  const names = duplicates.map((f) => f.name).join("」「");
  formulaDuplicateWarning.textContent = `⚠ 似た名前の公式が既に登録されています:「${names}」`;
  formulaDuplicateWarning.classList.remove("hidden");
});

formulaForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = formulaNameInput.value.trim();
  const rawLatex = document.getElementById("formula-latex").value.trim();
  const category = document.getElementById("formula-category").value.trim() || "未分類";
  if (!name || !rawLatex) return;
  const latex = stripDelimiters(rawLatex); // 保存時点で区切り記号を除去しておく
  const { error } = await db.from("formulas").insert({ name, latex, category });
  if (error) return alert("公式の追加に失敗しました: " + error.message);
  formulaForm.reset();
  formulaDuplicateWarning.classList.add("hidden");
});

formulaList.addEventListener("click", async (e) => {
  const catToggleBtn = e.target.closest(".category-toggle");
  if (catToggleBtn) {
    const cat = catToggleBtn.dataset.category;
    const group = catToggleBtn.closest(".category-group");
    const body = group.querySelector(".category-body");
    const nowOpen = body.hasAttribute("hidden");
    body.toggleAttribute("hidden", !nowOpen);
    group.classList.toggle("open", nowOpen);
    if (nowOpen) {
      expandedCategories.add(cat);
    } else {
      expandedCategories.delete(cat);
    }
    return;
  }

  const toggleBtn = e.target.closest(".formula-card-toggle");
  if (toggleBtn) {
    const id = toggleBtn.dataset.id;
    const card = toggleBtn.closest(".formula-card");
    const body = card.querySelector(".formula-card-body");
    const nowOpen = body.hasAttribute("hidden");
    body.toggleAttribute("hidden", !nowOpen);
    card.classList.toggle("open", nowOpen);
    if (nowOpen) {
      expandedFormulaIds.add(id);
    } else {
      expandedFormulaIds.delete(id);
    }
    return;
  }

  const editBtn = e.target.closest(".formula-edit-btn");
  if (editBtn) {
    editingFormulaId = editBtn.dataset.id;
    expandedFormulaIds.add(editingFormulaId);
    applyFormulaFilter();
    return;
  }

  const cancelBtn = e.target.closest(".formula-edit-cancel");
  if (cancelBtn) {
    editingFormulaId = null;
    applyFormulaFilter();
    return;
  }

  const deleteBtn = e.target.closest(".formula-delete-btn");
  if (deleteBtn) {
    const ok = await showConfirm("この公式を削除しますか？（管理者操作・ゴミ箱から復元できます）");
    if (!ok) return;
    const { error } = await db
      .from("formulas")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", deleteBtn.dataset.id);
    if (error) alert("削除に失敗しました: " + error.message);
    return;
  }

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

formulaList.addEventListener("submit", async (e) => {
  const form = e.target.closest(".formula-edit-form");
  if (!form) return;
  e.preventDefault();
  const name = form.querySelector(".formula-edit-name").value.trim();
  const rawLatex = form.querySelector(".formula-edit-latex").value.trim();
  const category = form.querySelector(".formula-edit-category").value.trim() || "未分類";
  if (!name || !rawLatex) return;
  const latex = stripDelimiters(rawLatex);
  const { error } = await db
    .from("formulas")
    .update({ name, latex, category })
    .eq("id", form.dataset.id);
  if (error) return alert("公式の更新に失敗しました: " + error.message);
  editingFormulaId = null;
  applyFormulaFilter();
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
  draftMeta.textContent = `最終更新: ${data.updated_by ? displayName(data.updated_by) : "-"}`;
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
      const deleteBtn = isAdmin
        ? `<button class="icon-btn log-delete-btn" data-id="${log.id}" title="このログを削除（管理者）">✕</button>`
        : "";
      div.innerHTML = `
        <div class="log-meta">
          <span>${escapeHtml(displayName(log.author))} ・ ${when}</span>
          ${deleteBtn}
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
  const { data, error } = await db
    .from("research_logs")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) return console.error(error);
  renderLogHistory(data);
}

logHistoryList.addEventListener("click", async (e) => {
  if (!e.target.classList.contains("log-delete-btn")) return;
  const ok = await showConfirm("この研究ログを削除しますか？（管理者操作・ゴミ箱から復元できます）");
  if (!ok) return;
  const id = e.target.dataset.id;
  const { error } = await db
    .from("research_logs")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
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
      draftMeta.textContent = `最終更新: ${payload.new.updated_by ? displayName(payload.new.updated_by) : "-"}`;
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
// 初期化（入室ゲートで名前が確定してから呼ばれる）
// ============================================================
async function init() {
  await Promise.all([loadChatMessages(), loadTasks(), loadFormulas(), loadDraft(), loadLogHistory()]);
  subscribeRealtime();
  joinPresence(currentUser);
  trimChatMessages(); // 既に50件を超えて溜まっている分があれば起動時にも掃除する
}
