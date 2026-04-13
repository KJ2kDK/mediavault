import { useState, useRef, useEffect } from 'react';

export default function ChatPanel({ onNavigate }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'assistant', text: 'Hey! Ask me about live TV, new releases, your bookmarks, or system status.' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const send = async () => {
    const msg = input.trim();
    if (!msg || loading) return;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', text: msg }]);
    setLoading(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();
      setMessages((prev) => [...prev, { role: 'assistant', text: data.answer || 'No response.', items: data.items || null, buttons: data.buttons || null }]);
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', text: 'Connection error. Is the server running?' }]);
    } finally {
      setLoading(false);
    }
  };

  const sendAction = async (action, label) => {
    setMessages((prev) => [...prev, { role: 'user', text: label }]);
    setLoading(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: action }),
      });
      const data = await res.json();
      setMessages((prev) => [...prev, { role: 'assistant', text: data.answer || 'No response.', items: data.items || null, buttons: data.buttons || null }]);
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', text: 'Connection error.' }]);
    } finally { setLoading(false); }
  };

  // Render markdown-lite: **bold** and newlines
  const renderText = (text) => {
    return text.split('\n').map((line, i) => (
      <span key={i}>
        {i > 0 && <br />}
        {line.split(/(\*\*.*?\*\*)/g).map((part, j) =>
          part.startsWith('**') && part.endsWith('**')
            ? <strong key={j} className="text-vault-text font-medium">{part.slice(2, -2)}</strong>
            : <span key={j}>{part}</span>
        )}
      </span>
    ));
  };

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setOpen(!open)}
        className={`fixed bottom-20 right-6 z-50 w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-all ${
          open ? 'bg-vault-border text-vault-muted rotate-0' : 'bg-vault-accent text-white hover:bg-vault-accentHover'
        }`}
      >
        {open ? (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-[7.5rem] right-6 z-50 w-96 h-[500px] bg-vault-surface border border-vault-border rounded-xl shadow-2xl flex flex-col overflow-hidden animate-fade-in">
          {/* Header */}
          <div className="px-4 py-3 border-b border-vault-border flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-sm font-medium text-vault-text">MediaVault Assistant</span>
            <span className="text-[10px] text-vault-muted ml-auto">powered by local DB</span>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] px-3 py-2 rounded-lg text-xs leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-vault-accent/20 text-vault-text'
                    : 'bg-vault-card border border-vault-border text-vault-muted'
                }`}>
                  {renderText(m.text)}
                  {m.items && (
                    <div className="mt-2 space-y-1">
                      {m.items.map((item, j) => (
                        item.nav ? (
                          <button
                            key={j}
                            onClick={() => { onNavigate(item.nav.page, { search: item.nav.search }); setOpen(false); }}
                            className="block w-full text-left px-2 py-1.5 rounded bg-vault-bg/50 hover:bg-vault-accent/15 hover:text-vault-text transition-colors text-[11px] leading-snug"
                          >
                            {renderText(item.text)}
                            <span className="text-vault-teal text-[9px] ml-1">→ Go</span>
                          </button>
                        ) : (
                          <div key={j} className="text-[11px] pt-1">{renderText(item.text)}</div>
                        )
                      ))}
                    </div>
                  )}
                  {m.buttons && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {m.buttons.map((btn, j) => (
                        <button
                          key={j}
                          onClick={() => sendAction(btn.action, btn.label)}
                          className="px-2.5 py-1.5 rounded-md bg-vault-accent/15 text-vault-teal text-[10px] font-medium hover:bg-vault-accent/25 transition-colors"
                        >
                          {btn.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-vault-card border border-vault-border rounded-lg px-3 py-2 text-xs text-vault-muted">
                  <span className="animate-pulse">Thinking...</span>
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-vault-border p-3">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
                placeholder="Ask about TV, releases, bookmarks..."
                className="flex-1 px-3 py-2 rounded-lg bg-vault-bg border border-vault-border text-xs text-vault-text placeholder:text-vault-muted/50 focus:outline-none focus:border-vault-accent/50"
              />
              <button
                onClick={send}
                disabled={!input.trim() || loading}
                className="px-3 py-2 rounded-lg bg-vault-accent text-white text-xs font-medium hover:bg-vault-accentHover disabled:opacity-40 disabled:cursor-default transition-colors"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
