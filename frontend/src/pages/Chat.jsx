import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";

const MAX_FILE_MB = 10;
const ALLOWED_EXT = ["pdf", "docx", "txt", "md", "png", "jpg", "jpeg", "webp"];

export default function Chat() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const { conversationId } = useParams();

    const handleLogout = () => {
        logout();
        navigate("/", { replace: true });
    };

    const [conversations, setConversations] = useState([]);
    const [activeConvo, setActiveConvo] = useState(null);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState("");
    const [sending, setSending] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState("");
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [renamingId, setRenamingId] = useState(null);
    const [renameValue, setRenameValue] = useState("");

    // mobile drawers (sidebar + documents panel); ignored at md+ where both are static
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [docsOpen, setDocsOpen] = useState(false);

    const openConvo = (id) => {
        navigate(`/chat/${id}`);
        setSidebarOpen(false);
    };

    // editing a previously-sent user message
    const [editingId, setEditingId] = useState(null);
    const [editValue, setEditValue] = useState("");
    const [editSaving, setEditSaving] = useState(false);

    const startEdit = (m) => {
        setEditingId(m.id);
        setEditValue(m.content);
    };
    const cancelEdit = () => {
        setEditingId(null);
        setEditValue("");
    };
    const submitEdit = async () => {
        const content = editValue.trim();
        if (!content || !activeConvo) return;
        setEditSaving(true);
        try {
            await api.post(`/chat/conversations/${activeConvo.id}/messages/${editingId}/edit`, { content });
            const { data } = await api.get(`/chat/conversations/${activeConvo.id}/messages`);
            setMessages(data);
            cancelEdit();
            loadConversations();
        } catch (err) {
            alert(err.response?.data?.detail || "Edit failed");
        } finally {
            setEditSaving(false);
        }
    };

    const deleteConvo = async (id) => {
        if (!confirm("Delete this chat? This can't be undone.")) return;
        try {
            await api.delete(`/chat/conversations/${id}`);
            await loadConversations();
            if (conversationId === id) navigate("/chat", { replace: true });
        } catch (err) {
            alert(err.response?.data?.detail || "Delete failed");
        }
    };

    const prevConvoIdRef = useRef(null);

    // quiz launcher
    const [quizPhase, setQuizPhase] = useState("idle");
    const [quizSize, setQuizSize] = useState(10);
    const [quizProgress, setQuizProgress] = useState({ current: 0, total: 0, topic: "", phase: "" });
    const [quizSessionId, setQuizSessionId] = useState(null);
    const [quizError, setQuizError] = useState("");
    const eventSourceRef = useRef(null);

    const scrollRef = useRef(null);
    const fileInputRef = useRef(null);

    useEffect(() => {
        api.get("/chat/conversations").then(({ data }) => setConversations(data));
    }, []);

    // The URL (/chat/:conversationId) is the source of truth for which
    // conversation is open, so a refresh restores the same page.
    useEffect(() => {
        if (!conversationId) {
            setActiveConvo(null);
            setMessages([]);
            return;
        }
        // Skip refetch if this conversation is already loaded (e.g. after an
        // optimistic update like upload/rename set it directly).
        if (activeConvo?.id === conversationId) return;

        let cancelled = false;
        (async () => {
            try {
                const [{ data: convo }, { data: msgs }] = await Promise.all([
                    api.get(`/chat/conversations/${conversationId}`),
                    api.get(`/chat/conversations/${conversationId}/messages`),
                ]);
                if (cancelled) return;
                setActiveConvo(convo);
                setMessages(msgs);
            } catch {
                if (!cancelled) navigate("/chat", { replace: true });
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [conversationId]);

    // reset quiz only when the conversation actually changes
    useEffect(() => {
        const newId = conversationId || null;
        if (prevConvoIdRef.current !== newId) {
            prevConvoIdRef.current = newId;
            if (newId) {
                cancelQuiz();
            }
        }
    }, [conversationId]);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: 9e9, behavior: "smooth" });
    }, [messages, quizPhase, quizProgress]);

    useEffect(() => () => eventSourceRef.current?.close(), []);

    const loadConversations = async () => {
        const { data } = await api.get("/chat/conversations");
        setConversations(data);
    };

    const newChat = async () => {
        const { data: convo } = await api.post("/chat/conversations", { title: "New chat" });
        await loadConversations();
        navigate(`/chat/${convo.id}`);
        setSidebarOpen(false);
    };

    const startRename = (convo) => {
        setRenamingId(convo.id);
        setRenameValue(convo.title);
    };
    const submitRename = async () => {
        if (!renameValue.trim()) {
            setRenamingId(null);
            return;
        }
        try {
            const { data } = await api.patch(`/chat/conversations/${renamingId}`, { title: renameValue.trim() });
            if (activeConvo?.id === renamingId) setActiveConvo(data);
            await loadConversations();
        } catch (err) {
            alert(err.response?.data?.detail || "Rename failed");
        } finally {
            setRenamingId(null);
        }
    };

    const validateFile = (file) => {
        const ext = file.name.split(".").pop()?.toLowerCase();
        if (!ALLOWED_EXT.includes(ext)) return `Unsupported file: .${ext}`;
        if (file.size > MAX_FILE_MB * 1024 * 1024) return `File too big (max ${MAX_FILE_MB} MB)`;
        if (file.size === 0) return "Empty file";
        return null;
    };

    const handleUpload = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        setUploadError("");
        const err = validateFile(file);
        if (err) {
            setUploadError(err);
            return;
        }
        setUploading(true);
        try {
            let convo = activeConvo;
            const isNewConvo = !convo;
            if (!convo) {
                const { data } = await api.post("/chat/conversations", { title: "New chat" });
                convo = data;
            }
            const form = new FormData();
            form.append("file", file);
            form.append("title", file.name);
            const { data: material } = await api.post("/materials/upload", form);
            const { data: updated } = await api.post(`/chat/conversations/${convo.id}/materials`, { material_id: material.id });
            setActiveConvo(updated);
            await loadConversations();
            if (isNewConvo) navigate(`/chat/${updated.id}`);
        } catch (err) {
            setUploadError(err.response?.data?.detail || "Upload failed");
        } finally {
            setUploading(false);
        }
    };

    const removeMaterial = async (materialId) => {
        if (!activeConvo) return;
        if (!confirm("Remove this document from the chat?")) return;
        try {
            const { data } = await api.delete(`/chat/conversations/${activeConvo.id}/materials/${materialId}`);
            setActiveConvo(data);
        } catch (err) {
            alert(err.response?.data?.detail || "Failed to remove");
        }
    };

    const send = async () => {
        if (!activeConvo) return;
        const content = input.trim();
        if (!content) return;
        if (!activeConvo.materials?.length) {
            setUploadError("Add at least one document first");
            return;
        }
        const tempId = `temp-${Date.now()}`;
        setMessages((m) => [
            ...m,
            {
                id: tempId,
                role: "user",
                content,
                is_mcq: false,
                mcq_payload: null,
                created_at: new Date().toISOString(),
            },
        ]);
        setInput("");
        setSending(true);
        try {
            const { data } = await api.post(`/chat/conversations/${activeConvo.id}/messages`, {
                content,
                mode: "chat",
            });
            setMessages((m) => [...m.filter((x) => x.id !== tempId), ...data]);
            loadConversations();
        } catch (err) {
            setMessages((m) => m.filter((x) => x.id !== tempId));
            alert(err.response?.data?.detail || "Send failed");
        } finally {
            setSending(false);
        }
    };

    const openQuizPicker = () => {
        if (!activeConvo?.materials?.length) {
            setUploadError("Add at least one document first");
            return;
        }
        setQuizPhase("picking");
        setQuizError("");
    };

    const cancelQuiz = () => {
        eventSourceRef.current?.close();
        eventSourceRef.current = null;
        setQuizPhase("idle");
        setQuizProgress({ current: 0, total: 0, topic: "", phase: "" });
        setQuizSessionId(null);
        setQuizError("");
    };

    const beginGenerating = () => {
        if (!activeConvo) return;
        setQuizPhase("generating");
        setQuizProgress({ current: 0, total: quizSize, topic: "", phase: "" });
        setQuizError("");

        const token = localStorage.getItem("token");
        const url = `/api/quiz/stream?conversation_id=${activeConvo.id}&size=${quizSize}&token=${encodeURIComponent(token)}`;
        const es = new EventSource(url);
        eventSourceRef.current = es;

        es.addEventListener("progress", (e) => {
            const data = JSON.parse(e.data);
            setQuizProgress({
                current: data.current,
                total: data.total,
                topic: data.topic || "",
                phase: data.phase || "",
            });
        });
        es.addEventListener("done", (e) => {
            const data = JSON.parse(e.data);
            setQuizSessionId(data.session_id);
            setQuizPhase("ready");
            es.close();
        });
        es.addEventListener("error", (e) => {
            let msg = "Generation failed";
            try {
                msg = JSON.parse(e.data).message || msg;
            } catch {}
            setQuizError(msg);
            setQuizPhase("error");
            es.close();
        });
        es.onerror = () => {
            if (es.readyState === EventSource.CLOSED) return;
            setQuizError("Connection lost");
            setQuizPhase("error");
            es.close();
        };
    };

    const initials = (user?.name || "?")
        .split(" ")
        .map((s) => s[0])
        .slice(0, 2)
        .join("")
        .toUpperCase();

    return (
        <div className="h-screen flex bg-[#faf9f6] overflow-hidden">
            {/* Mobile backdrop for the sidebar drawer */}
            {sidebarOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-40 md:hidden"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            {/* SIDEBAR — static on md+, slide-in drawer on mobile */}
            <aside
                className={`bg-black text-gray-100 flex flex-col w-64 z-50
                    fixed inset-y-0 left-0 transform transition-transform duration-200
                    md:static md:translate-x-0
                    ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
            >
                <div className="px-4 py-5 border-b border-gray-800">
                    <div className="text-lg font-bold tracking-tight">📚 studybud</div>
                    <div className="text-xs text-gray-500 mt-0.5">your study buddy</div>
                </div>

                <div className="p-3">
                    <button
                        onClick={newChat}
                        className="w-full bg-white text-black hover:bg-gray-200 rounded-lg py-2 text-sm font-medium transition"
                    >
                        + New chat
                    </button>
                </div>

                <div className="px-4 text-[11px] uppercase tracking-wider text-gray-500 mt-2">Recent</div>
                <div className="px-2 flex-1 overflow-y-auto mt-1 pb-3 space-y-0.5">
                    {conversations.length === 0 && <div className="px-2 py-4 text-xs text-gray-500">No chats yet.</div>}
                    {conversations.map((c) => (
                        <div
                            key={c.id}
                            className={`group flex items-center rounded-lg transition
                             ${conversationId === c.id ? "bg-gray-800" : "hover:bg-gray-900"}`}
                        >
                            {renamingId === c.id ? (
                                <input
                                    autoFocus
                                    className="flex-1 text-sm px-3 py-2 bg-gray-800 text-white rounded-lg outline-none border border-gray-600"
                                    value={renameValue}
                                    onChange={(e) => setRenameValue(e.target.value)}
                                    onBlur={submitRename}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") submitRename();
                                        if (e.key === "Escape") setRenamingId(null);
                                    }}
                                    maxLength={255}
                                />
                            ) : (
                                <>
                                    <button
                                        onClick={() => openConvo(c.id)}
                                        onDoubleClick={() => startRename(c)}
                                        className="flex-1 text-left text-sm px-3 py-2 truncate text-gray-200"
                                    >
                                        {c.title}
                                    </button>
                                    <button
                                        onClick={() => startRename(c)}
                                        className="px-1.5 py-1 text-gray-500 hover:text-white text-xs opacity-0 group-hover:opacity-100 transition"
                                        title="Rename"
                                    >
                                        ✎
                                    </button>
                                    <button
                                        onClick={() => deleteConvo(c.id)}
                                        className="px-1.5 py-1 text-gray-500 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition mr-1"
                                        title="Delete"
                                    >
                                        🗑
                                    </button>
                                </>
                            )}
                        </div>
                    ))}
                </div>

                <div className="border-t border-gray-800 p-3">
                    <button
                        onClick={() => setSettingsOpen(true)}
                        className="w-full flex items-center gap-3 hover:bg-gray-900 rounded-lg px-2 py-2 transition"
                    >
                        <div className="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center text-xs font-bold">{initials}</div>
                        <div className="flex-1 min-w-0 text-left">
                            <div className="text-sm font-medium truncate">{user?.name}</div>
                            <div className="text-xs text-gray-500 truncate">@{user?.username}</div>
                        </div>
                        <span className="text-gray-500 text-lg">⚙️</span>
                    </button>
                </div>
            </aside>

            {/* MAIN */}
            <main className="flex-1 flex flex-col min-w-0">
                {/* Adaptive top bar:
                    ☰ shows below md (sidebar is a drawer); the sidebar is static at md+.
                    📎 shows below lg (documents is a drawer); the panel is static at lg+. */}
                <header className="flex items-center gap-2 border-b border-gray-200 bg-white px-3 md:px-6 h-14 shrink-0">
                    <button
                        onClick={() => setSidebarOpen(true)}
                        className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg hover:bg-gray-100 text-xl"
                        aria-label="Open menu"
                    >
                        ☰
                    </button>
                    <div className="flex-1 font-semibold truncate">{activeConvo ? activeConvo.title : "📚 studybud"}</div>
                    {activeConvo && (
                        <button
                            onClick={() => setDocsOpen(true)}
                            className="lg:hidden w-9 h-9 flex items-center justify-center rounded-lg hover:bg-gray-100 text-lg"
                            aria-label="Documents"
                        >
                            📎
                        </button>
                    )}
                </header>

                {!activeConvo ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
                        <div className="text-5xl mb-3">📖</div>
                        <div className="text-2xl font-semibold">Pick a chat or start a new one</div>
                        <p className="text-gray-500 mt-2 max-w-sm">Upload your notes, then ask questions or get quizzed.</p>
                    </div>
                ) : (
                    <>
                        {uploadError && (
                            <div className="max-w-3xl mx-auto w-full px-6 mt-3">
                                <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-lg flex items-center justify-between">
                                    <span>{uploadError}</span>
                                    <button
                                        className="text-red-700 hover:text-red-900"
                                        onClick={() => setUploadError("")}
                                    >
                                        ✕
                                    </button>
                                </div>
                            </div>
                        )}

                        <div
                            ref={scrollRef}
                            className="flex-1 overflow-y-auto"
                        >
                            <div className="max-w-3xl mx-auto px-6 py-4 space-y-4">
                                {messages.length === 0 && (!activeConvo.materials || activeConvo.materials.length === 0) && (
                                    <div className="text-center text-gray-500 mt-10">
                                        📎 Use the <span className="font-medium">+</span> button to add a document.
                                    </div>
                                )}
                                {messages.map((m) =>
                                    editingId === m.id ? (
                                        <EditMessageBox
                                            key={m.id}
                                            value={editValue}
                                            onChange={setEditValue}
                                            onSave={submitEdit}
                                            onCancel={cancelEdit}
                                            saving={editSaving}
                                        />
                                    ) : (
                                        <MessageBubble
                                            key={m.id}
                                            msg={m}
                                            navigate={navigate}
                                            onEdit={m.role === "user" && !m.is_mcq ? () => startEdit(m) : null}
                                        />
                                    )
                                )}
                                {sending && <div className="text-gray-400 text-sm italic">studybud is thinking…</div>}

                                {quizPhase !== "idle" && (
                                    <QuizCard
                                        phase={quizPhase}
                                        size={quizSize}
                                        setSize={setQuizSize}
                                        progress={quizProgress}
                                        sessionId={quizSessionId}
                                        error={quizError}
                                        onGenerate={beginGenerating}
                                        onCancel={cancelQuiz}
                                        onStart={() => navigate(`/quiz/${quizSessionId}`)}
                                    />
                                )}
                            </div>
                        </div>

                        <div className="border-t border-gray-200 bg-white">
                            <div className="max-w-3xl mx-auto p-3 flex gap-2 items-center">
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={uploading}
                                    title="Add document"
                                    className="w-10 h-10 flex items-center justify-center bg-gray-100 hover:bg-gray-200 rounded-lg text-xl disabled:opacity-50 transition"
                                >
                                    {uploading ? "⏳" : "+"}
                                </button>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    className="hidden"
                                    onChange={handleUpload}
                                    accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp"
                                />

                                <input
                                    className="flex-1 border border-gray-300 rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-gray-400"
                                    placeholder="Ask something about your notes…"
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && !sending && send()}
                                    disabled={sending}
                                    maxLength={4000}
                                />
                                <button
                                    onClick={send}
                                    disabled={sending || !input.trim()}
                                    className="bg-black hover:bg-gray-800 text-white rounded-lg px-3 sm:px-4 py-2.5 font-medium disabled:opacity-50 transition shrink-0"
                                >
                                    Send
                                </button>
                                <button
                                    onClick={openQuizPicker}
                                    disabled={sending || quizPhase !== "idle"}
                                    title="Start quiz"
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-3 sm:px-4 py-2.5 font-medium disabled:opacity-50 transition shrink-0"
                                >
                                    🎯<span className="hidden sm:inline"> Start quiz</span>
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </main>

            {/* Backdrop for the documents drawer (phones + iPad portrait) */}
            {activeConvo && docsOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-40 lg:hidden"
                    onClick={() => setDocsOpen(false)}
                />
            )}

            {/* RIGHT PANEL — static on lg+, slide-in drawer from the right below lg */}
            {activeConvo && (
                <aside
                    className={`bg-white border-l border-gray-200 flex flex-col w-72 z-50
                        fixed inset-y-0 right-0 transform transition-transform duration-200
                        lg:static lg:translate-x-0
                        ${docsOpen ? "translate-x-0" : "translate-x-full"}`}
                >
                    <div className="px-4 py-4 border-b border-gray-200 flex items-center justify-between">
                        <div>
                            <div className="text-sm font-semibold">📎 Documents</div>
                            <div className="text-xs text-gray-500 mt-0.5">{activeConvo.materials?.length || 0} attached</div>
                        </div>
                        <button
                            onClick={() => setDocsOpen(false)}
                            className="lg:hidden w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 text-lg"
                            aria-label="Close documents"
                        >
                            ✕
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 space-y-2">
                        {(!activeConvo.materials || activeConvo.materials.length === 0) && (
                            <div className="text-sm text-gray-500 px-2 py-4 text-center">
                                No documents yet.
                                <br />
                                Use <span className="font-medium">+</span> next to the input.
                            </div>
                        )}
                        {activeConvo.materials?.map((m) => (
                            <div
                                key={m.id}
                                className="border border-gray-200 rounded-lg p-3 group hover:border-black transition"
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="text-sm font-medium truncate">
                                            {fileIcon(m.file_type)} {m.title}
                                        </div>
                                        <div className="text-xs text-gray-500 mt-0.5">
                                            {m.file_type.toUpperCase()} · {(m.char_count / 1000).toFixed(1)}k chars
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => removeMaterial(m.id)}
                                        className="text-xs text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition"
                                    >
                                        ✕
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </aside>
            )}

            {settingsOpen && (
                <SettingsModal
                    user={user}
                    onClose={() => setSettingsOpen(false)}
                    onLogout={handleLogout}
                />
            )}
        </div>
    );
}

function QuizCard({ phase, size, setSize, progress, error, onGenerate, onCancel, onStart }) {
    return (
        <div className="max-w-2xl bg-emerald-50 border border-emerald-300 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-semibold text-emerald-900">🎯 Quiz</div>
                <button
                    onClick={onCancel}
                    className="text-xs text-emerald-700 hover:text-emerald-900 underline"
                >
                    cancel
                </button>
            </div>

            {phase === "picking" && (
                <>
                    <div className="text-sm text-emerald-900 mb-3">how many questions?</div>
                    <div className="grid grid-cols-3 gap-2 mb-4">
                        {[5, 10, 20].map((n) => (
                            <button
                                key={n}
                                onClick={() => setSize(n)}
                                className={`py-3 rounded-xl border-2 transition
                                  ${size === n ? "border-emerald-700 bg-white" : "border-emerald-200 hover:border-emerald-400"}`}
                            >
                                <div className="text-xl font-bold">{n}</div>
                                <div className="text-[10px] text-emerald-700">questions</div>
                            </button>
                        ))}
                    </div>
                    <button
                        onClick={onGenerate}
                        className="w-full bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg py-2.5 font-medium"
                    >
                        generate quiz →
                    </button>
                </>
            )}

            {phase === "generating" && (
                <>
                    <div className="text-sm text-emerald-900 mb-2">
                        generating questions…{" "}
                        <span className="font-semibold">
                            {progress.current}/{progress.total}
                        </span>
                    </div>
                    <div className="w-full bg-emerald-100 rounded-full h-2 overflow-hidden">
                        <div
                            className="bg-emerald-700 h-2 transition-all duration-300"
                            style={{ width: `${(progress.current / progress.total) * 100}%` }}
                        />
                    </div>
                    {progress.phase && <div className="text-xs text-emerald-700 mt-2 italic">{progress.phase}</div>}
                    {progress.topic && !progress.phase && <div className="text-xs text-emerald-700 mt-2 italic">latest topic: {progress.topic}</div>}
                </>
            )}

            {phase === "ready" && (
                <>
                    <div className="text-sm text-emerald-900 mb-3">✓ {progress.current} questions ready.</div>
                    <button
                        onClick={onStart}
                        className="w-full bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg py-2.5 font-medium"
                    >
                        start quiz →
                    </button>
                </>
            )}

            {phase === "error" && (
                <div className="text-sm text-red-700">
                    {error || "Something went wrong."}
                    <button
                        onClick={onCancel}
                        className="ml-2 underline"
                    >
                        close
                    </button>
                </div>
            )}
        </div>
    );
}

function SettingsModal({ user, onClose, onLogout }) {
    const initials = (user?.name || "?")
        .split(" ")
        .map((s) => s[0])
        .slice(0, 2)
        .join("")
        .toUpperCase();
    return (
        <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="bg-black text-white px-6 py-5 flex items-center justify-between">
                    <div className="font-semibold">Profile</div>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white text-xl leading-none"
                    >
                        ×
                    </button>
                </div>
                <div className="p-6 space-y-6">
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-full bg-black text-white flex items-center justify-center text-lg font-bold">{initials}</div>
                        <div>
                            <div className="font-semibold text-lg">{user?.name}</div>
                            <div className="text-sm text-gray-500">@{user?.username}</div>
                            <div className="text-sm text-gray-500">{user?.email}</div>
                        </div>
                    </div>
                    <div className="border-t pt-4 flex justify-between items-center">
                        <button
                            onClick={onLogout}
                            className="text-sm text-red-600 hover:underline"
                        >
                            Log out
                        </button>
                        <button
                            onClick={onClose}
                            className="bg-black text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-gray-800"
                        >
                            Done
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function fileIcon(type) {
    if (type === "pdf") return "📕";
    if (type === "docx") return "📘";
    if (type === "image") return "🖼️";
    return "📄";
}

function MessageBubble({ msg, navigate, onEdit }) {
    const isUser = msg.role === "user";

    // Quiz report — full
    if (msg.mcq_payload?.type === "quiz_report") {
        const r = msg.mcq_payload.report || {};
        const pct = Math.round((msg.mcq_payload.correct_count / msg.mcq_payload.total_questions) * 100);
        return (
            <div className="max-w-2xl bg-black text-white rounded-2xl p-5">
                <div className="text-xs uppercase tracking-wider text-emerald-400 mb-1">Quiz report</div>
                <div className="flex items-baseline gap-3">
                    <div className="text-4xl font-bold">
                        {msg.mcq_payload.correct_count}/{msg.mcq_payload.total_questions}
                    </div>
                    <div className="text-gray-400 text-sm">that's {pct}%</div>
                </div>
                {r.summary && <div className="text-gray-200 mt-3 text-sm">{r.summary}</div>}

                {r.weak_topics?.length > 0 && (
                    <div className="mt-4">
                        <div className="text-xs uppercase tracking-wider text-red-400 mb-2">to review</div>
                        <div className="space-y-2">
                            {r.weak_topics.map((t, i) => (
                                <div
                                    key={i}
                                    className="bg-red-900/30 border border-red-700 rounded-lg p-3 text-sm"
                                >
                                    <div className="flex justify-between">
                                        <span className="font-semibold">{t.topic}</span>
                                        <span className="text-red-300">{t.score}</span>
                                    </div>
                                    <div className="text-gray-300 mt-1">{t.suggestion}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {r.strong_topics?.length > 0 && (
                    <div className="mt-4">
                        <div className="text-xs uppercase tracking-wider text-green-400 mb-2">solid on</div>
                        <div className="flex flex-wrap gap-2">
                            {r.strong_topics.map((t, i) => (
                                <div
                                    key={i}
                                    className="bg-green-900/30 border border-green-700 rounded-full px-3 py-1 text-xs"
                                >
                                    {t.topic} · {t.score}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <button
                    onClick={() => navigate(`/quiz/${msg.mcq_payload.quiz_session_id}`)}
                    className="mt-4 text-xs text-emerald-400 hover:text-emerald-300 underline"
                >
                    see all answers →
                </button>
            </div>
        );
    }

    // Plain text
    return (
        <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
            <div className="max-w-2xl group">
                <div
                    className={`px-4 py-2.5 rounded-2xl whitespace-pre-wrap leading-relaxed
                         ${isUser ? "bg-black text-white rounded-br-md" : "bg-white border border-gray-200 text-gray-900 rounded-bl-md"}`}
                >
                    {msg.content}
                </div>
                {isUser && onEdit && (
                    <div className="flex justify-end mt-1">
                        <button
                            onClick={onEdit}
                            className="text-xs text-gray-400 hover:text-black opacity-0 group-hover:opacity-100 transition"
                        >
                            edit
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

function EditMessageBox({ value, onChange, onSave, onCancel, saving }) {
    return (
        <div className="flex justify-end">
            <div className="max-w-2xl w-full">
                <textarea
                    autoFocus
                    rows={3}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    maxLength={4000}
                    className="w-full border border-gray-300 rounded-2xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-gray-400 resize-none"
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSave();
                        if (e.key === "Escape") onCancel();
                    }}
                />
                <div className="flex justify-end gap-2 mt-2">
                    <button
                        onClick={onCancel}
                        className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 hover:border-black transition"
                    >
                        cancel
                    </button>
                    <button
                        onClick={onSave}
                        disabled={saving || !value.trim()}
                        className="text-sm px-3 py-1.5 rounded-lg bg-black text-white hover:bg-gray-800 disabled:opacity-50 transition"
                    >
                        {saving ? "sending…" : "save & send"}
                    </button>
                </div>
            </div>
        </div>
    );
}
