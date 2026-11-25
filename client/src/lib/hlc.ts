export interface ParsedHlc {
  wallMs: number;
  counter: number;
  nodeId: string;
}

export function formatHlc(wallMs: number, counter: number, nodeId: string): string {
  const safeWall = Math.max(0, Math.floor(Number.isFinite(wallMs) ? wallMs : 0));
  const safeCounter = Math.max(0, Math.floor(Number.isFinite(counter) ? counter : 0));
  const safeNode = nodeId.trim() || 'anon';
  return `${String(safeWall).padStart(15, '0')}:${String(safeCounter).padStart(4, '0')}:${safeNode}`;
}

export function parseHlc(raw: unknown): ParsedHlc | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const firstColon = trimmed.indexOf(':');
  if (firstColon <= 0) return null;
  const secondColon = trimmed.indexOf(':', firstColon + 1);
  if (secondColon <= firstColon + 1) return null;

  const wallMs = Number(trimmed.slice(0, firstColon));
  const counter = Number(trimmed.slice(firstColon + 1, secondColon));
  const nodeId = trimmed.slice(secondColon + 1).trim();
  if (!Number.isFinite(wallMs) || wallMs < 0 || !Number.isFinite(counter) || counter < 0 || !nodeId) {
    return null;
  }
  return { wallMs, counter, nodeId };
}

export function compareHlc(a: string | undefined, b: string | undefined): number {
  const pa = parseHlc(a);
  const pb = parseHlc(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  if (pa.wallMs !== pb.wallMs) return pa.wallMs - pb.wallMs;
  if (pa.counter !== pb.counter) return pa.counter - pb.counter;
  return pa.nodeId < pb.nodeId ? -1 : pa.nodeId > pb.nodeId ? 1 : 0;
}

/**
 * Determines whether an incoming update should win over the current state.
 * Prefers Hybrid Logical Clock causal ordering when both sides carry valid HLCs,
 * falling back gracefully to wall-clock millisecond timestamps for legacy payloads.
 */
export function isIncomingNewer(
  currentHlc: string | undefined,
  currentTs: number | undefined,
  incomingHlc: string | undefined,
  incomingTs: number | undefined,
): boolean {
  const curParsed = parseHlc(currentHlc);
  const incParsed = parseHlc(incomingHlc);
  if (curParsed && incParsed) {
    return compareHlc(incomingHlc, currentHlc) >= 0;
  }
  const curMs = typeof currentTs === 'number' && Number.isFinite(currentTs) ? currentTs : 0;
  const incMs = typeof incomingTs === 'number' && Number.isFinite(incomingTs) ? incomingTs : 0;
  return incMs >= curMs;
}

/**
 * Monotonic Hybrid Logical Clock (HLC) tolerant of client clock skew and backward jumps.
 * Combines physical wall time with a logical counter + node tie-breaker so concurrent
 * edits across peers always converge deterministically.
 */
export class HybridLogicalClock {
  private wallMs: number;
  private counter = 0;
  private nodeId: string;

  constructor(nodeId: string, initialWallMs = 0) {
    this.nodeId = nodeId.trim() || 'anon';
    this.wallMs = Math.max(0, Math.floor(initialWallMs));
  }

  setNodeId(nodeId: string) {
    const trimmed = nodeId.trim();
    if (trimmed) this.nodeId = trimmed;
  }

  now(physicalMs = Date.now()): string {
    const pt = Math.max(0, Math.floor(physicalMs));
    if (pt > this.wallMs) {
      this.wallMs = pt;
      this.counter = 0;
    } else {
      this.counter += 1;
    }
    return formatHlc(this.wallMs, this.counter, this.nodeId);
  }

  receive(remoteHlc: string | undefined, physicalMs = Date.now()): string {
    const parsed = parseHlc(remoteHlc);
    if (!parsed) return this.now(physicalMs);

    const pt = Math.max(0, Math.floor(physicalMs));
    const maxWall = Math.max(this.wallMs, parsed.wallMs, pt);

    if (maxWall === this.wallMs && maxWall === parsed.wallMs) {
      this.counter = Math.max(this.counter, parsed.counter) + 1;
    } else if (maxWall === this.wallMs) {
      this.counter += 1;
    } else if (maxWall === parsed.wallMs) {
      this.counter = parsed.counter + 1;
    } else {
      this.counter = 0;
    }

    this.wallMs = maxWall;
    return formatHlc(this.wallMs, this.counter, this.nodeId);
  }
}
