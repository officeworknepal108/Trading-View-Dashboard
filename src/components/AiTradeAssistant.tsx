import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Check, LoaderCircle, Maximize2, MessageCircle, Send, Trash2, X } from 'lucide-react';

export interface ChartAgentContext {
  symbol: string;
  chartTimeframe: string;
  replayActive: boolean;
  replayBar: number | null;
  structureTrend: string;
  currentCandle: Record<string, unknown> | null;
  recentCandles: Array<Record<string, unknown>>;
  activeZones: Array<Record<string, unknown>>;
  mtfSetups: Array<Record<string, unknown>>;
  timeframeTrends: Array<Record<string, unknown>>;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
}

interface MemoryProposal {
  type: 'correction' | 'trade_outcome' | 'lesson';
  summary: string;
  details: string;
  outcome: 'profit' | 'loss' | 'breakeven' | 'not_applicable';
  setupId: string;
}

interface AiTradeAssistantProps {
  context: ChartAgentContext;
}

const CHAT_STORAGE_KEY = 'xauusd-code-agent-chat-v1';
const WELCOME: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content: 'I am your XAUUSD dashboard knowledge assistant. Ask me about any rule in the code, the current chart, an MTF setup, replay behaviour, or a completed trade.',
};

function loadMessages(): ChatMessage[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CHAT_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) && parsed.length > 0 ? parsed.slice(-40) : [WELCOME];
  } catch {
    return [WELCOME];
  }
}

export const AiTradeAssistant: React.FC<AiTradeAssistantProps> = ({ context }) => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(loadMessages);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [memoryProposal, setMemoryProposal] = useState<MemoryProposal | null>(null);
  const [memoryMessage, setMemoryMessage] = useState<string | null>(null);
  const [memoryCount, setMemoryCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    window.localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages.slice(-40)));
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, open]);

  useEffect(() => {
    fetch('/api/ai/memory')
      .then((response) => response.json())
      .then((payload) => setMemoryCount(Number(payload?.count || 0)))
      .catch(() => undefined);
  }, []);

  const contextLabel = useMemo(() => (
    `${context.symbol} · ${context.chartTimeframe}${context.replayActive ? ` · Replay bar ${context.replayBar ?? '—'}` : ' · Live'}`
  ), [context.chartTimeframe, context.replayActive, context.replayBar, context.symbol]);

  const sendQuestion = async () => {
    const content = question.trim();
    if (!content || loading) return;
    const userMessage: ChatMessage = { id: `user-${Date.now()}`, role: 'user', content };
    const nextMessages = [...messages, userMessage].slice(-40);
    setMessages(nextMessages);
    setQuestion('');
    setLoading(true);
    setMemoryProposal(null);
    setMemoryMessage(null);
    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: content,
          history: nextMessages.slice(-16).map(({ role, content: text }) => ({ role, content: text })),
          chartContext: context,
        }),
      });
      const payload = await response.json();
      if (!response.ok || typeof payload?.answer !== 'string') {
        throw new Error(payload?.error || 'The chart assistant is unavailable.');
      }
      setMessages((current) => [...current, {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: payload.answer,
        sources: Array.isArray(payload.sources) ? payload.sources : [],
      }].slice(-40));
      if (payload.memoryProposal) setMemoryProposal(payload.memoryProposal);
    } catch (error) {
      setMessages((current) => [...current, {
        id: `assistant-error-${Date.now()}`,
        role: 'assistant',
        content: error instanceof Error ? error.message : 'The chart assistant is unavailable.',
      }].slice(-40));
    } finally {
      setLoading(false);
    }
  };

  const approveMemory = async () => {
    if (!memoryProposal) return;
    try {
      const response = await fetch('/api/ai/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(memoryProposal),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Could not save this lesson.');
      setMemoryCount(Number(payload.count || memoryCount + 1));
      setMemoryProposal(null);
      setMemoryMessage('Approved and saved. Future answers will use this lesson.');
    } catch (error) {
      setMemoryMessage(error instanceof Error ? error.message : 'Could not save this lesson.');
    }
  };

  const clearChat = () => {
    setMessages([WELCOME]);
    setMemoryProposal(null);
    setMemoryMessage(null);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pointer-events-auto absolute bottom-3 left-3 z-30 flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-600 px-3 py-2 text-[10px] font-black text-white shadow-lg hover:bg-indigo-700"
      >
        <MessageCircle className="h-4 w-4" /> ASK CHART AI
      </button>
    );
  }

  return (
    <section className="pointer-events-auto absolute bottom-3 left-3 z-30 flex h-[440px] w-[390px] max-w-[calc(100%_-_24px)] flex-col overflow-hidden rounded-xl border border-indigo-200 bg-white/98 shadow-2xl">
      <header className="flex items-center justify-between border-b border-indigo-100 bg-indigo-50 px-3 py-2">
        <div>
          <div className="flex items-center gap-1.5 text-[11px] font-black text-indigo-800"><Bot className="h-4 w-4" /> CHART KNOWLEDGE AGENT</div>
          <div className="mt-0.5 text-[8px] font-bold text-slate-500">{contextLabel} · {memoryCount} approved memories</div>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={clearChat} title="Clear conversation" className="rounded p-1 text-slate-500 hover:bg-white"><Trash2 className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={() => setOpen(false)} title="Minimize chat" className="rounded p-1 text-slate-500 hover:bg-white"><X className="h-4 w-4" /></button>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto bg-slate-50/60 p-3">
        {messages.map((message) => (
          <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[88%] rounded-xl px-3 py-2 text-[10px] leading-relaxed ${
              message.role === 'user'
                ? 'bg-indigo-600 text-white'
                : 'border border-slate-200 bg-white text-slate-700'
            }`}>
              <div className="whitespace-pre-wrap">{message.content}</div>
              {message.sources && message.sources.length > 0 && (
                <div className="mt-1.5 border-t border-slate-100 pt-1 text-[8px] font-bold text-slate-400">
                  Sources: {message.sources.join(' · ')}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-bold text-slate-500">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Reading code, tests and chart…
            </div>
          </div>
        )}
        {memoryProposal && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-[9px] text-amber-900">
            <div className="font-black uppercase">Save this as learned knowledge?</div>
            <div className="mt-1 font-bold">{memoryProposal.summary}</div>
            <div className="mt-1 text-amber-800">{memoryProposal.details}</div>
            <div className="mt-2 flex gap-1">
              <button type="button" onClick={() => void approveMemory()} className="flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 font-black text-white hover:bg-emerald-700"><Check className="h-3 w-3" /> APPROVE & LEARN</button>
              <button type="button" onClick={() => setMemoryProposal(null)} className="rounded border border-amber-300 bg-white px-2 py-1 font-black text-amber-800">REJECT</button>
            </div>
          </div>
        )}
        {memoryMessage && <div className="text-center text-[8px] font-bold text-slate-500">{memoryMessage}</div>}
      </div>

      <footer className="border-t border-slate-200 bg-white p-2">
        <div className="flex items-end gap-2">
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void sendQuestion();
              }
            }}
            rows={2}
            placeholder="Ask about code rules, this chart, or record a trade result…"
            className="min-h-[48px] flex-1 resize-none rounded-lg border border-slate-300 px-2 py-1.5 text-[10px] outline-none focus:border-indigo-400"
          />
          <button type="button" disabled={loading || !question.trim()} onClick={() => void sendQuestion()} className="grid h-9 w-9 place-items-center rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"><Send className="h-4 w-4" /></button>
        </div>
        <div className="mt-1 flex items-center justify-between text-[8px] font-bold text-slate-400">
          <span>Code + tests + live chart + approved learning</span>
          <span className="flex items-center gap-1"><Maximize2 className="h-2.5 w-2.5" /> Advisory only</span>
        </div>
      </footer>
    </section>
  );
};
