import { promises as fs } from 'node:fs';
import path from 'node:path';

export type AgentMemoryType = 'correction' | 'trade_outcome' | 'lesson';
export type TradeOutcome = 'profit' | 'loss' | 'breakeven' | 'not_applicable';

export interface AgentMemoryItem {
  id: string;
  type: AgentMemoryType;
  summary: string;
  details: string;
  outcome: TradeOutcome;
  setupId: string;
  createdAt: string;
  approved: true;
}

export interface KnowledgeChunk {
  source: string;
  startLine: number;
  endLine: number;
  content: string;
  score: number;
}

export interface TradeMemorySummary {
  total: number;
  profit: number;
  loss: number;
  breakeven: number;
  observedProfitRate: number | null;
}

const MEMORY_PATH = path.resolve(process.cwd(), 'data', 'ai-agent-memory.json');
const KNOWLEDGE_ROOTS = ['src', 'tests'];
const KNOWLEDGE_FILES = [
  'README.md',
  'PROJECT_STATUS.md',
  'OANDA_CHART_SETUP.md',
  'HOW TO OPEN DASHBOARD FROM BEGINNING.txt',
  'server.ts',
  'package.json',
];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.md', '.txt']);
const CHUNK_LINES = 70;
const CHUNK_OVERLAP = 10;

function terms(value: string): string[] {
  return Array.from(new Set(value.toLowerCase().split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 2)));
}

async function listFiles(directory: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listFiles(fullPath);
      return SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) ? [fullPath] : [];
    }));
    return nested.flat();
  } catch {
    return [];
  }
}

async function knowledgeFiles(): Promise<string[]> {
  const rootFiles = KNOWLEDGE_FILES.map((file) => path.resolve(process.cwd(), file));
  const nested = await Promise.all(KNOWLEDGE_ROOTS.map((root) => listFiles(path.resolve(process.cwd(), root))));
  return [...rootFiles, ...nested.flat()];
}

function chunkFile(filePath: string, content: string): KnowledgeChunk[] {
  const lines = content.split(/\r?\n/);
  const chunks: KnowledgeChunk[] = [];
  for (let start = 0; start < lines.length; start += CHUNK_LINES - CHUNK_OVERLAP) {
    const end = Math.min(lines.length, start + CHUNK_LINES);
    const chunk = lines.slice(start, end).join('\n').trim();
    if (chunk) {
      chunks.push({
        source: path.relative(process.cwd(), filePath).replaceAll('\\', '/'),
        startLine: start + 1,
        endLine: end,
        content: chunk,
        score: 0,
      });
    }
    if (end === lines.length) break;
  }
  return chunks;
}

export async function retrieveProjectKnowledge(query: string, limit: number = 12): Promise<KnowledgeChunk[]> {
  const queryTerms = terms(query);
  const files = await knowledgeFiles();
  const chunks = (await Promise.all(files.map(async (file) => {
    try {
      return chunkFile(file, await fs.readFile(file, 'utf8'));
    } catch {
      return [];
    }
  }))).flat();

  for (const chunk of chunks) {
    const source = chunk.source.toLowerCase();
    const content = chunk.content.toLowerCase();
    chunk.score = queryTerms.reduce((score, term) => {
      const sourceBoost = source.includes(term) ? 8 : 0;
      const matches = content.split(term).length - 1;
      return score + sourceBoost + Math.min(matches, 8);
    }, 0);
    if (source.includes('mtf') && queryTerms.some((term) => ['mtf', 'choch', 'qml', 'engulfing'].includes(term))) {
      chunk.score += 6;
    }
    if (source.includes('.test.') && queryTerms.some((term) => content.includes(term))) chunk.score += 3;
  }

  const ranked = chunks.sort((first, second) => second.score - first.score);
  const matching = ranked.filter((chunk) => chunk.score > 0).slice(0, limit);
  if (matching.length > 0) return matching;
  return ranked.filter((chunk) => ['README.md', 'PROJECT_STATUS.md', 'src/services/mtf.ts']
    .includes(chunk.source)).slice(0, Math.min(limit, 6));
}

export async function readAgentMemory(): Promise<AgentMemoryItem[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(MEMORY_PATH, 'utf8'));
    return Array.isArray(parsed?.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

export function summarizeTradeMemory(memory: AgentMemoryItem[]): TradeMemorySummary {
  const trades = memory.filter((item) => item.type === 'trade_outcome');
  const profit = trades.filter((item) => item.outcome === 'profit').length;
  const loss = trades.filter((item) => item.outcome === 'loss').length;
  const breakeven = trades.filter((item) => item.outcome === 'breakeven').length;
  const decided = profit + loss;
  return {
    total: trades.length,
    profit,
    loss,
    breakeven,
    observedProfitRate: decided === 0 ? null : profit / decided,
  };
}

export async function saveAgentMemory(
  item: Omit<AgentMemoryItem, 'id' | 'createdAt' | 'approved'>,
): Promise<AgentMemoryItem> {
  const memory = await readAgentMemory();
  const saved: AgentMemoryItem = {
    ...item,
    id: `memory-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    approved: true,
  };
  await fs.mkdir(path.dirname(MEMORY_PATH), { recursive: true });
  await fs.writeFile(MEMORY_PATH, `${JSON.stringify({ items: [...memory, saved].slice(-500) }, null, 2)}\n`, 'utf8');
  return saved;
}
