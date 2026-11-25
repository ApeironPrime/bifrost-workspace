import * as Y from 'yjs'

export type CrdtDataEnvelope =
  | { type: 'crdt:sync-request'; stateVector?: string }
  | { type: 'crdt:update'; update: string; full?: boolean }
  | { type: 'crdt:cursor'; anchor: string | null; head: string | null }

export interface RemoteCrdtCursor {
  peerId: string
  userId: string
  name: string
  anchor: number
  head: number
  line: number
  column: number
  updatedAt: number
}

export interface CapturedRelativeSelection {
  anchor: Y.RelativePosition
  head: Y.RelativePosition
}

export function encodeBytesBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

export function decodeBytesBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i)
  }
  return out
}

export function applyTextDiff(
  ytext: Y.Text,
  nextValue: string,
  origin: unknown = 'local',
): boolean {
  const prevValue = ytext.toString()
  if (prevValue === nextValue) return false

  let prefixLen = 0
  const minLen = Math.min(prevValue.length, nextValue.length)
  while (prefixLen < minLen && prevValue.charCodeAt(prefixLen) === nextValue.charCodeAt(prefixLen)) {
    prefixLen += 1
  }

  let prevSuffix = prevValue.length
  let nextSuffix = nextValue.length
  while (
    prevSuffix > prefixLen &&
    nextSuffix > prefixLen &&
    prevValue.charCodeAt(prevSuffix - 1) === nextValue.charCodeAt(nextSuffix - 1)
  ) {
    prevSuffix -= 1
    nextSuffix -= 1
  }

  const deleteCount = prevSuffix - prefixLen
  const insertText = nextValue.slice(prefixLen, nextSuffix)

  const doc = ytext.doc
  const apply = () => {
    if (deleteCount > 0) {
      ytext.delete(prefixLen, deleteCount)
    }
    if (insertText.length > 0) {
      ytext.insert(prefixLen, insertText)
    }
  }

  if (doc) {
    doc.transact(apply, origin)
  } else {
    apply()
  }
  return true
}

export function captureRelativeSelection(
  ytext: Y.Text,
  start: number,
  end: number,
): CapturedRelativeSelection {
  const len = ytext.length
  const clampedStart = Math.max(0, Math.min(start, len))
  const clampedEnd = Math.max(0, Math.min(end, len))
  return {
    anchor: Y.createRelativePositionFromTypeIndex(ytext, clampedStart),
    head: Y.createRelativePositionFromTypeIndex(ytext, clampedEnd),
  }
}

export function restoreRelativeSelection(
  doc: Y.Doc,
  captured: CapturedRelativeSelection,
): { start: number; end: number } | null {
  const startAbs = Y.createAbsolutePositionFromRelativePosition(captured.anchor, doc)
  const endAbs = Y.createAbsolutePositionFromRelativePosition(captured.head, doc)
  if (!startAbs || !endAbs) return null
  return {
    start: startAbs.index,
    end: endAbs.index,
  }
}

export function encodeRelativeCursor(
  ytext: Y.Text,
  anchor: number,
  head: number,
): { anchor: string; head: string } {
  const captured = captureRelativeSelection(ytext, anchor, head)
  return {
    anchor: encodeBytesBase64(Y.encodeRelativePosition(captured.anchor)),
    head: encodeBytesBase64(Y.encodeRelativePosition(captured.head)),
  }
}

export function computeLineAndColumn(text: string, index: number): { line: number; column: number } {
  const clamped = Math.max(0, Math.min(index, text.length))
  let line = 1
  let lastNewline = -1
  for (let i = 0; i < clamped; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1
      lastNewline = i
    }
  }
  return {
    line,
    column: clamped - lastNewline,
  }
}

export function decodeRelativeCursor(
  doc: Y.Doc,
  ytext: Y.Text,
  anchorB64: string | null | undefined,
  headB64: string | null | undefined,
): { anchor: number; head: number; line: number; column: number } | null {
  if (!anchorB64 || !headB64) return null
  try {
    const anchorRel = Y.decodeRelativePosition(decodeBytesBase64(anchorB64))
    const headRel = Y.decodeRelativePosition(decodeBytesBase64(headB64))
    const anchorAbs = Y.createAbsolutePositionFromRelativePosition(anchorRel, doc)
    const headAbs = Y.createAbsolutePositionFromRelativePosition(headRel, doc)
    if (!anchorAbs || !headAbs) return null
    const content = ytext.toString()
    const { line, column } = computeLineAndColumn(content, headAbs.index)
    return {
      anchor: anchorAbs.index,
      head: headAbs.index,
      line,
      column,
    }
  } catch {
    return null
  }
}

export class CrdtRoomController {
  readonly doc: Y.Doc
  readonly ytext: Y.Text

  constructor() {
    this.doc = new Y.Doc()
    this.ytext = this.doc.getText('content')
  }

  getText(): string {
    return this.ytext.toString()
  }

  applyLocalEdit(nextText: string): string | null {
    let emittedUpdate: Uint8Array | null = null
    const listener = (update: Uint8Array, origin: unknown) => {
      if (origin === 'local') {
        emittedUpdate = update
      }
    }
    this.doc.on('update', listener)
    try {
      const changed = applyTextDiff(this.ytext, nextText, 'local')
      if (!changed || !emittedUpdate) return null
      return encodeBytesBase64(emittedUpdate)
    } finally {
      this.doc.off('update', listener)
    }
  }

  applyRemoteUpdate(updateBase64: string): string {
    const bytes = decodeBytesBase64(updateBase64)
    Y.applyUpdate(this.doc, bytes, 'remote')
    return this.ytext.toString()
  }

  encodeStateAsUpdateBase64(targetStateVectorBase64?: string): string {
    if (targetStateVectorBase64) {
      try {
        const sv = decodeBytesBase64(targetStateVectorBase64)
        return encodeBytesBase64(Y.encodeStateAsUpdate(this.doc, sv))
      } catch {
        // Fallback to full state when remote state vector is invalid
      }
    }
    return encodeBytesBase64(Y.encodeStateAsUpdate(this.doc))
  }

  encodeStateVectorBase64(): string {
    return encodeBytesBase64(Y.encodeStateVector(this.doc))
  }

  destroy(): void {
    this.doc.destroy()
  }
}
